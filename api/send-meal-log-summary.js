// Meal-log summary email — one user's logged meals + macros over a date range,
// mailed to whoever the OWNER chooses. Owner-only in both directions: only the
// owner account can send one, and only the owner configures the schedule.
//
// POST /api/send-meal-log-summary — "Send now" from Admin Dashboard.
//   Body: { targetUid, start, end, emails[] }. Requires the owner's Firebase ID
//   token (checked against OWNER_EMAIL, not just "signed in").
//
// GET  /api/send-meal-log-summary — hourly cron (vercel.json). Reads the owner
//   doc's `mealLogReports` ([{ id, targetUid, emails, weekly, day, time }]) and
//   sends each weekly report at its Eastern weekday + hour, covering the last
//   complete Sun–Sat week. Idempotent via `mealLogReportsSent.<id>` = week end,
//   kept OUTSIDE the reports array so saving the list can't wipe the stamps.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { sendMail } from '../lib/mailer.js';
import { lastCompleteWeek } from '../lib/weeklySummary.js';
import { rangeDays, summarizeMealLog, renderMealLogEmail } from '../lib/mealLogSummary.js';
import { OWNER_EMAIL } from '../src/utils/pageAccess.js';

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

function eastern(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return {
    hour: parseInt(parts.hour, 10) % 24,
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

async function buildEmail(targetUid, start, end) {
  const days = rangeDays(start, end);
  if (!days) throw Object.assign(new Error('Pick a valid date range (up to 31 days).'), { status: 400 });
  const [userSnap, logSnap] = await Promise.all([
    db.doc(`users/${targetUid}`).get(),
    db.doc(`users/${targetUid}/data/dailyLog`).get(),
  ]);
  if (!userSnap.exists) throw Object.assign(new Error('That user was not found.'), { status: 404 });
  const user = userSnap.data() || {};
  const dailyLog = logSnap.exists ? (logSnap.data().log || {}) : {};
  const summary = summarizeMealLog(dailyLog, days);
  return renderMealLogEmail({
    name: user.displayName || user.email || '',
    start,
    end,
    summary,
    goals: user.nutritionGoals || null,
  });
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
  const summary = { due: 0, sent: 0, errors: [] };
  try {
    // By auth record, not the doc's `email` field — not every user doc stores one.
    const ownerUid = (await getAuth().getUserByEmail(OWNER_EMAIL)).uid;
    const ownerRef = db.doc(`users/${ownerUid}`);
    const ownerSnap = await ownerRef.get();
    const owner = ownerSnap.exists ? (ownerSnap.data() || {}) : {};
    const reports = Array.isArray(owner.mealLogReports) ? owner.mealLogReports : [];
    const sent = owner.mealLogReportsSent || {};
    const week = lastCompleteWeek(dateKey);

    for (const rep of reports) {
      if (!rep?.id || !rep.weekly || !rep.targetUid) continue;
      const targetDay = Number.isFinite(Number(rep.day)) ? Number(rep.day) : 1;
      const targetHour = parseInt(String(rep.time || '08:00').slice(0, 2), 10);
      if (dayOfWeek !== targetDay || hour !== targetHour) continue;
      if (sent[rep.id] === week.end) continue;
      const to = cleanEmails(rep.emails);
      if (to.length === 0) continue;
      summary.due++;
      try {
        const email = await buildEmail(rep.targetUid, week.start, week.end);
        await sendMail({ to, subject: email.subject, text: email.text, html: email.html });
        await ownerRef.update({ [`mealLogReportsSent.${rep.id}`]: week.end });
        summary.sent++;
      } catch (err) {
        summary.errors.push({ id: rep.id, err: err.message });
      }
    }
    return res.status(200).json({ ok: true, ...summary, hour, dayOfWeek, dateKey });
  } catch (err) {
    console.error('send-meal-log-summary fatal:', err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}

async function handleManual(req, res) {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Sign in first.' });
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(match[1]);
  } catch {
    return res.status(401).json({ error: 'Session expired — sign in again.' });
  }
  // Someone else's meals: the owner account only, verified from the token.
  if (String(decoded.email || '').trim().toLowerCase() !== OWNER_EMAIL || !decoded.email_verified) {
    return res.status(403).json({ error: 'Only the admin account can send meal-log summaries.' });
  }

  const body = req.body || {};
  const to = cleanEmails(body.emails);
  if (to.length === 0) return res.status(400).json({ error: 'Add at least one valid recipient email.' });
  const targetUid = String(body.targetUid || '').trim();
  if (!targetUid || targetUid.includes('/')) return res.status(400).json({ error: 'Pick a user.' });

  try {
    const email = await buildEmail(targetUid, String(body.start || ''), String(body.end || ''));
    await sendMail({ to, subject: email.subject, text: email.text, html: email.html });
    return res.status(200).json({ ok: true, sentTo: to, subject: email.subject });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('send-meal-log-summary manual error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
