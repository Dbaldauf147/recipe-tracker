// GET /api/send-meal-prompt — hourly cron (declared in vercel.json crons).
//
// Iterates every user with reminderSettings and sends meal-log / weight
// reminders that are due THIS hour in Eastern Time, when the user is
// behind on logging. Idempotent within the day via reminderSettings.lastFoodSent
// and reminderSettings.lastWeightSent date keys on the user doc.
//
// Auth: Vercel cron requests carry an `Authorization: Bearer <CRON_SECRET>`
// header when CRON_SECRET is set on the project. Manual invocations need
// the same header or query (?secret=...).

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { sendMail } from '../lib/mailer.js';
import { renderMealReminder } from '../lib/mealReminderEmail.js';
import { sendExpoPush, deadTokensFrom } from '../lib/expoPush.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();

const ET_OPTS = { timeZone: 'America/New_York', hour12: false };

// Returns { hour, dayOfWeek, dateKey } in America/New_York. dayOfWeek is
// 0=Sun..6=Sat to match the client's foodLogDays convention.
function eastern(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    ...ET_OPTS,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    hour: parseInt(parts.hour, 10),
    dayOfWeek: dow,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function parseEmails(settings) {
  if (Array.isArray(settings?.emails) && settings.emails.length > 0) {
    return settings.emails.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  }
  if (settings?.email) return [settings.email];
  return [];
}

// Recipients due to receive a reminder on the given weekday (0=Sun..6=Sat).
// Per-email `emailSchedules` [{ email, days[] }] take precedence: an address
// only gets mail on the weekdays it lists. Falls back to the flat `emails`
// list (all days) when no schedules are configured.
function recipientsForDay(settings, dow) {
  const sched = settings?.emailSchedules;
  if (Array.isArray(sched) && sched.length > 0) {
    const out = [];
    for (const row of sched) {
      const email = (row?.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      const days = Array.isArray(row.days) ? row.days : null;
      // No days specified = every day (treat as unrestricted).
      if (!days || days.length === 0 || days.includes(dow)) out.push(email);
    }
    return out;
  }
  return parseEmails(settings);
}

// Per-device Expo push tokens registered by the mobile app. Deduped so the
// same device (re-registered across launches) only gets one push.
function getPushTokens(data) {
  const raw = Array.isArray(data?.expoPushTokens) ? data.expoPushTokens : [];
  return Array.from(new Set(raw.filter(t => typeof t === 'string' && t.length > 0)));
}

// Send a reminder push to all of a user's devices and prune any Expo reports as
// dead. Best-effort: returns true if at least the send was attempted without
// throwing. `badge` mirrors the old local-notification badge (1 = one item due).
async function pushToUser(ref, tokens, { title, body }) {
  if (tokens.length === 0) return false;
  const { tickets } = await sendExpoPush(
    tokens.map(to => ({ to, title, body, sound: 'default', badge: 1, priority: 'high', channelId: 'reminders' })),
  );
  const dead = deadTokensFrom(tokens, tickets);
  if (dead.length > 0) {
    await ref.update({ expoPushTokens: FieldValue.arrayRemove(...dead) }).catch(() => {});
  }
  return true;
}

// ── Server-side mirror of WeightTracker.jsx's weigh-schedule logic ──
// The client only prompts on scheduled weigh-in days; without this the cron
// would email "log your weight" every single day a user with a weekly/monthly
// cadence didn't log, which reads as spam even though they're on track.
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function getWeighSettings(bodyStats) {
  const s = bodyStats || {};
  return {
    repeatEvery: s.weighRepeatEvery || 1,
    repeatUnit: s.weighRepeatUnit || 'week',
    weekDays: s.weighWeekDays || ['monday'],
    monthOption: s.weighMonthOption || 'day',
    monthDay: s.weighMonthDay || 1,
    monthWeek: s.weighMonthWeek || '1st',
    monthWeekday: s.weighMonthWeekday || 'monday',
  };
}

// Day-of-week for a Y/M/D (m 1-based) computed in UTC so it's timezone-stable.
function dowOf(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysBetween(fromKey, toKey) {
  const [y1, m1, d1] = fromKey.split('-').map(Number);
  const [y2, m2, d2] = toKey.split('-').map(Number);
  return Math.floor((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Shift a Y-M-D key by n days (n may be negative), returning a zero-padded key.
function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Tolerance band: true if any weigh-in falls within the last `toleranceDays`
// days up to and including today (cron date). Used to suppress the weight
// reminder when the user has effectively already weighed in — covers same-day
// logs that land just after the reminder hour and any date-boundary off-by-one,
// so "I already logged my weight" doesn't still get nagged. Lexicographic
// compare is safe because both keys are zero-padded YYYY-MM-DD.
function weighedWithin(weightLog, dateKey, toleranceDays) {
  if (!Array.isArray(weightLog)) return false;
  const minKey = addDays(dateKey, -toleranceDays);
  return weightLog.some(e => e?.date && e.date >= minKey && e.date <= dateKey);
}

function isWeighDay(y, m, d, dow, settings) {
  const { repeatUnit, weekDays, monthOption, monthDay, monthWeek, monthWeekday } = settings;
  if (repeatUnit === 'day') return true;
  if (repeatUnit === 'week') {
    return (weekDays || ['monday']).includes(DAY_NAMES[dow]);
  }
  if (repeatUnit === 'month') {
    if (monthOption === 'day') return d === (monthDay || 1);
    const weekNum = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, last: -1 };
    const targetDow = DAY_MAP[monthWeekday || 'monday'];
    if (weekNum[monthWeek] === -1) {
      let dd = new Date(Date.UTC(y, m, 0)).getUTCDate(); // last day of month m
      while (dowOf(y, m, dd) !== targetDow) dd--;
      return d === dd;
    }
    const n = weekNum[monthWeek] || 1;
    let count = 0;
    for (let dd = 1; dd <= d; dd++) if (dowOf(y, m, dd) === targetDow) count++;
    return count === n && dow === targetDow;
  }
  if (repeatUnit === 'year') return m === 1 && d === 1;
  return false;
}

// True only if today is a scheduled weigh day AND the user is due (hasn't
// logged within the cadence). Mirrors WeightTracker.jsx shouldWeighToday.
function shouldWeighToday(weightLog, bodyStats, dateKey, dow) {
  const settings = getWeighSettings(bodyStats);
  const log = Array.isArray(weightLog)
    ? weightLog.filter(e => e?.date).sort((a, b) => a.date.localeCompare(b.date))
    : [];
  if (log.length === 0) return true; // never logged → always due
  const last = log[log.length - 1].date;
  const days = daysBetween(last, dateKey);
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!isWeighDay(y, m, d, dow, settings)) return false;
  if (settings.repeatUnit === 'day') return days >= settings.repeatEvery;
  if (settings.repeatUnit === 'week') return days >= settings.repeatEvery * 7 - 6;
  if (settings.repeatUnit === 'month') {
    return !log.some(e => e.date.startsWith(dateKey.slice(0, 7)));
  }
  return days >= 7;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const query = req.query?.secret;
    const ok = header === `Bearer ${secret}` || query === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }

  const { hour, dayOfWeek, dateKey } = eastern();
  const summary = { scanned: 0, foodSent: 0, weightSent: 0, foodPushed: 0, weightPushed: 0, errors: [] };

  try {
    const snap = await db.collection('users').get();
    for (const docSnap of snap.docs) {
      summary.scanned++;
      const uid = docSnap.id;
      const data = docSnap.data() || {};
      const s = data.reminderSettings;
      if (!s || (!s.foodLogReminder && !s.weightReminder)) continue;
      // Day-aware recipients: an address only gets mail on its selected days.
      // Push goes to the user's own devices (state-aware, so it suppresses
      // itself when they already logged on another device). Skip the user only
      // when there's no way to reach them at all today.
      const to = recipientsForDay(s, dayOfWeek);
      const pushTokens = getPushTokens(data);
      if (to.length === 0 && pushTokens.length === 0) continue;

      // --- Food log reminder ---
      if (s.foodLogReminder && s.foodLogTime) {
        const targetHour = parseInt(String(s.foodLogTime).slice(0, 2), 10);
        const daysOk = Array.isArray(s.foodLogDays) ? s.foodLogDays.includes(dayOfWeek) : true;
        const alreadySent = s.lastFoodSent === dateKey;
        if (Number.isFinite(targetHour) && hour === targetHour && daysOk && !alreadySent) {
          // Count meals logged today on this user's dailyLog
          let mainMeals = 0;
          let skipped = 0;
          let daySkipped = false;
          let log = {};
          try {
            const logSnap = await db.doc(`users/${uid}/data/dailyLog`).get();
            log = logSnap.exists ? (logSnap.data().log || {}) : {};
            const day = log[dateKey] || {};
            mainMeals = (day.entries || []).filter(e => ['breakfast','lunch','dinner'].includes(e.mealSlot)).length;
            skipped = (day.skippedMeals || []).length;
            daySkipped = !!day.daySkipped;
          } catch { /* treat as zero */ }
          if (!daySkipped && (mainMeals + skipped) < 3) {
            const remaining = 3 - mainMeals - skipped;
            const goals = data.nutritionGoals || null;
            const { subject, text, html } = renderMealReminder({ remaining, log, dateKey, goals });
            let delivered = false;
            if (to.length > 0) {
              try {
                await sendMail({ to, subject, text, html });
                summary.foodSent++;
                delivered = true;
              } catch (err) {
                summary.errors.push({ uid, type: 'food', err: err.message });
              }
            }
            if (pushTokens.length > 0) {
              try {
                await pushToUser(docSnap.ref, pushTokens, {
                  title: 'Log your meals',
                  body: remaining === 1 ? '1 meal left to log today.' : `${remaining} meals left to log today.`,
                });
                summary.foodPushed++;
                delivered = true;
              } catch (err) {
                summary.errors.push({ uid, type: 'food-push', err: err.message });
              }
            }
            // Mark the day handled only if we reached the user on some channel,
            // so a transient failure can retry next hour instead of going silent.
            if (delivered) await docSnap.ref.update({ 'reminderSettings.lastFoodSent': dateKey });
          }
        }
      }

      // --- Weight reminder ---
      if (s.weightReminder && s.weightTime) {
        const targetHour = parseInt(String(s.weightTime).slice(0, 2), 10);
        const daysOk = Array.isArray(s.weightDays) ? s.weightDays.includes(dayOfWeek) : true;
        const alreadySent = s.lastWeightSent === dateKey;
        if (Number.isFinite(targetHour) && hour === targetHour && daysOk && !alreadySent) {
          // Only remind when today is a scheduled weigh-in day AND the user is
          // due per their cadence (bodyStats is synced to Firestore). This
          // matches the client so weekly/monthly weighers aren't emailed daily.
          let due = false;
          try {
            due = shouldWeighToday(data.weightLog, data.bodyStats, dateKey, dayOfWeek);
          } catch { /* if schedule can't be evaluated, skip rather than spam */ }
          // Even if the cadence says "due", don't nag when a weigh-in already
          // landed today or yesterday — the user has effectively logged this
          // period; this absorbs same-day logs just after the reminder hour.
          if (due && weighedWithin(data.weightLog, dateKey, 1)) due = false;
          if (due) {
            let delivered = false;
            if (to.length > 0) {
              try {
                await sendMail({
                  to,
                  subject: 'Prep Day — log your weight',
                  text:
                    `Don't forget to log your weight today.\n\n` +
                    `Log now: https://prep-day.com\n\n— Prep Day`,
                });
                summary.weightSent++;
                delivered = true;
              } catch (err) {
                summary.errors.push({ uid, type: 'weight', err: err.message });
              }
            }
            if (pushTokens.length > 0) {
              try {
                await pushToUser(docSnap.ref, pushTokens, {
                  title: 'Time to weigh in',
                  body: 'Log your weight in Prep Day.',
                });
                summary.weightPushed++;
                delivered = true;
              } catch (err) {
                summary.errors.push({ uid, type: 'weight-push', err: err.message });
              }
            }
            if (delivered) await docSnap.ref.update({ 'reminderSettings.lastWeightSent': dateKey });
          }
        }
      }
    }
    return res.status(200).json({ ok: true, ...summary, hour, dayOfWeek, dateKey });
  } catch (err) {
    console.error('send-meal-prompt fatal:', err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}
