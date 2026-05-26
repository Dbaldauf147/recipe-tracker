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
import { getFirestore } from 'firebase-admin/firestore';
import { sendMail } from '../lib/mailer.js';

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

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const query = req.query?.secret;
    const ok = header === `Bearer ${secret}` || query === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }

  const { hour, dayOfWeek, dateKey } = eastern();
  const summary = { scanned: 0, foodSent: 0, weightSent: 0, errors: [] };

  try {
    const snap = await db.collection('users').get();
    for (const docSnap of snap.docs) {
      summary.scanned++;
      const uid = docSnap.id;
      const data = docSnap.data() || {};
      const s = data.reminderSettings;
      if (!s || (!s.foodLogReminder && !s.weightReminder)) continue;
      const to = parseEmails(s);
      if (to.length === 0) continue;

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
          try {
            const logSnap = await db.doc(`users/${uid}/data/dailyLog`).get();
            const log = logSnap.exists ? (logSnap.data().log || {}) : {};
            const day = log[dateKey] || {};
            mainMeals = (day.entries || []).filter(e => ['breakfast','lunch','dinner'].includes(e.mealSlot)).length;
            skipped = (day.skippedMeals || []).length;
            daySkipped = !!day.daySkipped;
          } catch { /* treat as zero */ }
          if (!daySkipped && (mainMeals + skipped) < 3) {
            const remaining = 3 - mainMeals - skipped;
            try {
              await sendMail({
                to,
                subject: 'Prep Day — log your meals',
                text:
                  `You have ${remaining} meal${remaining > 1 ? 's' : ''} left to log today.\n\n` +
                  `Log now: https://prep-day.com\n\n— Prep Day`,
              });
              await docSnap.ref.update({ 'reminderSettings.lastFoodSent': dateKey });
              summary.foodSent++;
            } catch (err) {
              summary.errors.push({ uid, type: 'food', err: err.message });
            }
          }
        }
      }

      // --- Weight reminder ---
      if (s.weightReminder && s.weightTime) {
        const targetHour = parseInt(String(s.weightTime).slice(0, 2), 10);
        const alreadySent = s.lastWeightSent === dateKey;
        if (Number.isFinite(targetHour) && hour === targetHour && !alreadySent) {
          // The client's "shouldWeigh" check lives in localStorage we can't read
          // server-side. Fall back to: always remind on the user's chosen time
          // unless they've already logged a weight today.
          let hasToday = false;
          try {
            const w = Array.isArray(data.weightLog) ? data.weightLog : [];
            hasToday = w.some(e => e?.date === dateKey);
          } catch { /* treat as missing */ }
          if (!hasToday) {
            try {
              await sendMail({
                to,
                subject: 'Prep Day — log your weight',
                text:
                  `Don't forget to log your weight today.\n\n` +
                  `Log now: https://prep-day.com\n\n— Prep Day`,
              });
              await docSnap.ref.update({ 'reminderSettings.lastWeightSent': dateKey });
              summary.weightSent++;
            } catch (err) {
              summary.errors.push({ uid, type: 'weight', err: err.message });
            }
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
