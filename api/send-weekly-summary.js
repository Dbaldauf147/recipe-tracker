// Weekly progress summary email.
//
// GET  /api/send-weekly-summary — hourly cron (declared in vercel.json crons).
//   Sends each opted-in user their weekly summary at the weekday + hour they
//   picked in Account Settings → Email Reminders (Eastern Time). The report
//   always covers the most recently COMPLETED Sunday→Saturday week, compared
//   against the week before it. Idempotent per week via the user doc's
//   `weeklySummarySentWeek` (= the reported week's end date).
//
// POST /api/send-weekly-summary — "send me one now" from the settings page.
//   Requires a Firebase ID token; only ever sends that user's own data.
//
// Auth: the cron path accepts `Authorization: Bearer <CRON_SECRET>` (Vercel
// sends this automatically) or `?secret=`. The POST path takes a user's ID
// token in the same header instead.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { sendMail } from '../lib/mailer.js';
import { loadHabitLogAdmin } from './_data/habitLogYears.js';
import {
  lastCompleteWeek, previousWeek, summarizeWeek, isEmptyWeek, renderWeeklySummary, shiftKey,
  TREND_WEEKS,
} from '../lib/weeklySummary.js';
import { WINDOW_DAYS } from '../src/utils/exerciseProgress.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 5;

// Eastern hour / weekday / date key — matches send-meal-prompt so every
// scheduled email in the app fires against the same clock.
function eastern(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return {
    hour: parseInt(parts.hour, 10),
    dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function cleanEmails(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const e = String(raw || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

/**
 * Who gets the summary.
 *
 * A dedicated `weeklySummaryEmails` list wins; otherwise it falls back to the
 * reminder addresses. Deliberately NOT the per-weekday `emailSchedules`
 * routing: a once-a-week digest landing in whichever inbox happens to be
 * scheduled for that weekday would be surprising.
 */
function summaryRecipients(settings, fallbackEmail) {
  const own = cleanEmails(settings?.weeklySummaryEmails);
  if (own.length > 0) return own;
  const reminders = cleanEmails(settings?.emails?.length ? settings.emails : [settings?.email]);
  if (reminders.length > 0) return reminders;
  return cleanEmails([fallbackEmail]);
}

/**
 * Everything the summary needs for one user, for a date range covering both
 * the reported week and the comparison week.
 *
 * Workouts are range-queried on `date` (a single-field index Firestore keeps
 * automatically) so a user with years of history doesn't pull the whole
 * subcollection every week.
 */
async function loadUserWeekData(uid, userData, fromKey, toKey) {
  // Workouts reach further back than the other fields: the "lifts to watch"
  // trend regresses over the trailing WINDOW_DAYS, and a two-week pull would
  // silently give every exercise too few sessions to judge — reporting nothing
  // wrong rather than reporting nothing known. A few extra days of slack covers
  // a session logged just outside the window boundary. Callers can ask for more
  // than that via `fromKey` — the goals table's rolling met-rate does — so this
  // takes whichever of the two reaches back further.
  const workoutsFrom = shiftKey(toKey, -(WINDOW_DAYS + 7));
  const [logSnap, workoutSnap, habitLog] = await Promise.all([
    db.doc(`users/${uid}/data/dailyLog`).get().catch(() => null),
    db.collection(`users/${uid}/workouts`)
      .where('date', '>=', workoutsFrom < fromKey ? workoutsFrom : fromKey)
      .where('date', '<=', toKey)
      .get().catch(() => null),
    loadHabitLogAdmin(db, uid, userData).catch(() => ({})),
  ]);
  return {
    dailyLog: logSnap?.exists ? (logSnap.data().log || {}) : {},
    weightLog: Array.isArray(userData.weightLog) ? userData.weightLog : [],
    workouts: workoutSnap ? workoutSnap.docs.map(d => d.data()) : [],
    habits: Array.isArray(userData.habits) ? userData.habits : [],
    habitLog: habitLog || {},
    // Used to resolve each exercise's muscle group and the user's own
    // Strength/Stretching tag, so the email's trend agrees with the Progress tab.
    exerciseLibrary: Array.isArray(userData.exerciseLibrary) ? userData.exerciseLibrary : [],
    customExercises: Array.isArray(userData.customExercises) ? userData.customExercises : [],
    // Names of the user's stretch routines, so a logged stretch session is
    // excluded from the workout-day goal tally exactly as the Week Plan does.
    stretchRoutines: Array.isArray(userData.stretchRoutines) ? userData.stretchRoutines : [],
    // Per-region stretch target the Workout page's goal board is set to, so
    // the email's board scores against the same bar. Clamped downstream.
    stretchGoalMin: userData.stretchGoalMin,
  };
}

/** Build (but don't send) the email for one user. Returns null on an empty week
 *  unless `force` — a manual "send me one now" should always produce something
 *  rather than silently doing nothing. */
async function buildEmail(uid, userData, todayKey, { force = false } = {}) {
  const week = lastCompleteWeek(todayKey);
  const prior = previousWeek(week);
  // The goals table's rolling met-rate scores the trailing TREND_WEEKS weeks,
  // so the workout pull has to reach back that far too. dailyLog and weightLog
  // arrive whole and need no widening; workouts are the one range query.
  // Without this the older weeks come back with no sessions in them, which
  // reads as a run of missed workout goals rather than as missing data.
  const trendStart = shiftKey(week.start, -7 * (TREND_WEEKS - 1));
  const from = trendStart < prior.start ? trendStart : prior.start;
  const data = await loadUserWeekData(uid, userData, from, shiftKey(week.end, 1));
  // The Week Plan's goal tiles, recomputed for the finished week. Every input
  // is a synced user-doc field; a goal configured only in localStorage on one
  // device can't be seen from here, which is why the tally reads
  // workoutWeeklyGoals rather than the browser's copy.
  const goalsConfig = {
    workoutWeeklyGoals: userData.workoutWeeklyGoals || null,
    workoutTypeCategories: userData.workoutTypeCategories || null,
    saunaGoal: userData.saunaGoal,
    nutritionGoals: userData.nutritionGoals || null,
  };
  const stats = summarizeWeek(data, week, { withProgress: true, goalsConfig });
  if (!force && isEmptyWeek(stats)) return null;
  const priorStats = summarizeWeek(data, prior);
  const email = renderWeeklySummary({
    stats,
    priorStats,
    goals: userData.nutritionGoals || null,
    bodyStats: userData.bodyStats || null,
    weightUnit: userData.workoutWeightUnit === 'kg' ? 'kg' : 'lb',
    name: userData.displayName || '',
  });
  return { ...email, week };
}

export default async function handler(req, res) {
  if (req.method === 'POST') return handleManual(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok = (req.headers.authorization || '') === `Bearer ${secret}` || req.query?.secret === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }

  const { hour, dayOfWeek, dateKey } = eastern();
  const summary = { scanned: 0, due: 0, sent: 0, skippedEmpty: 0, errors: [] };

  try {
    // Only opted-in users. Nested map subfields are auto-indexed, but if that
    // query ever fails (index exclusion, legacy data) fall back to the full
    // scan the other crons do rather than silently sending nothing.
    let snap;
    try {
      snap = await db.collection('users').where('reminderSettings.weeklySummary', '==', true).get();
    } catch {
      snap = await db.collection('users').get();
    }
    for (const docSnap of snap.docs) {
      summary.scanned++;
      const uid = docSnap.id;
      const data = docSnap.data() || {};
      const s = data.reminderSettings || {};
      if (!s.weeklySummary) continue;

      const targetDay = Number.isFinite(Number(s.weeklySummaryDay)) ? Number(s.weeklySummaryDay) : 0;
      const targetHour = parseInt(String(s.weeklySummaryTime || '08:00').slice(0, 2), 10);
      if (dayOfWeek !== targetDay || hour !== targetHour) continue;

      const week = lastCompleteWeek(dateKey);
      // The sent-stamp lives OUTSIDE reminderSettings on purpose: saving the
      // settings form rewrites that whole map, which would wipe the stamp and
      // let the same week go out twice.
      if (data.weeklySummarySentWeek === week.end) continue;
      summary.due++;

      const to = summaryRecipients(s, data.email);
      if (to.length === 0) continue;

      try {
        const email = await buildEmail(uid, data, dateKey);
        if (!email) { summary.skippedEmpty++; continue; }
        await sendMail({ to, subject: email.subject, text: email.text, html: email.html });
        await docSnap.ref.update({ weeklySummarySentWeek: week.end });
        summary.sent++;
      } catch (err) {
        summary.errors.push({ uid, err: err.message });
      }
    }
    return res.status(200).json({ ok: true, ...summary, hour, dayOfWeek, dateKey });
  } catch (err) {
    console.error('send-weekly-summary fatal:', err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}

// POST — user-triggered preview. Authenticated so a summary of someone's meals,
// weight and habits can never be mailed by an anonymous caller.
async function handleManual(req, res) {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Sign in first.' });
  let uid;
  let tokenEmail = '';
  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    uid = decoded.uid;
    tokenEmail = decoded.email || '';
  } catch {
    return res.status(401).json({ error: 'Session expired — sign in again.' });
  }

  const body = req.body || {};
  const requested = cleanEmails(body.emails);

  try {
    const userSnap = await db.doc(`users/${uid}`).get();
    const data = userSnap.exists ? userSnap.data() : {};
    const to = requested.length > 0
      ? requested
      : summaryRecipients(data.reminderSettings || {}, tokenEmail || data.email);
    if (to.length === 0) return res.status(400).json({ error: 'No valid recipient email.' });

    const { dateKey } = eastern();
    const email = await buildEmail(uid, data, dateKey, { force: true });
    await sendMail({ to, subject: email.subject, text: email.text, html: email.html });
    return res.status(200).json({ ok: true, sentTo: to, week: email.week.label });
  } catch (err) {
    console.error('send-weekly-summary manual error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
