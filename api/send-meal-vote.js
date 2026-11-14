// The weekly meal vote email (see src/utils/mealVote.js for the whole shape).
//
//   • GET — Vercel cron, hourly. For every account with the vote switched on:
//     on its send day, from its send hour (Eastern), build next week's ballot
//     from Suggested Meals and email each voter their own link.
//   • POST with the account's Firebase ID token — "Send now" on the Recipes
//     page: the same email immediately, whatever the day.
//
// People vote by replying to the email with the numbers of the meals they
// want; api/collect-meal-vote.js reads the replies.
//
// One ballot per week. Sending again — by hand, or the cron after a "Send
// now" — reuses the ballot that is there, so nobody's votes are lost and the
// meals don't change under them. The cron claims the week (`cronSent`) in the
// same transaction that creates the ballot, before any mail goes out, so two
// overlapping runs can't both send; if every send then fails the claim is
// released and the next hourly run tries again.
//
// Auth for GET: `Authorization: Bearer <CRON_SECRET>` (or ?secret=), as the
// other crons.

import { randomBytes } from 'node:crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { sendMail, senderAddress } from '../lib/mailer.js';
import { renderMealVoteEmail, renderMealVoteAmp } from '../lib/mealVoteEmail.js';
import {
  normalizeMealVoteSettings, mealVoteDue, voteWeekOf, rankForVote,
  applyLogToSnapshot, ballotOptions, weeksToPrune, fillOptionDetails,
} from '../src/utils/mealVote.js';
import { VOTE_MAIL_HEADER, replyAddress } from '../src/utils/mealVoteReply.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const siteBase = () => (process.env.PUBLIC_SITE_URL || 'https://prep-day.com').trim();

// { hour, dayOfWeek (0=Sun), dateKey } in America/New_York, as send-meal-prompt.
export function eastern(now = new Date()) {
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

const newToken = () => randomBytes(16).toString('hex');

/**
 * Create this week's ballot, or pick up the one already there, and mark it
 * sent. Returns { ballot } or { skipped: reason }.
 *
 * Voters are matched to an existing ballot by address, so a link already in
 * someone's inbox keeps working; anyone added to the settings since gets a
 * place on it.
 */
export async function claimBallot(db, uid, { settings, dateKey, byCron, nowIso }) {
  const weekOf = voteWeekOf(dateKey);
  const dataCol = db.collection('users').doc(uid).collection('data');
  const ref = dataCol.doc('mealVote');
  // Read outside the transaction: neither is written here, and the daily log
  // is large.
  const [snapDoc, logDoc] = await Promise.all([
    dataCol.doc('mealVoteSnapshot').get(),
    dataCol.doc('dailyLog').get(),
  ]);
  const snapshot = snapDoc.exists ? snapDoc.data() : null;
  const dailyLog = logDoc.exists ? (logDoc.data().log || {}) : {};

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const weeks = (doc.exists ? doc.data().weeks : null) || {};
    const existing = weeks[weekOf] || null;
    if (byCron && existing?.cronSent) return { skipped: 'already-sent' };

    let ballot;
    if (existing) {
      ballot = { ...existing, voters: { ...(existing.voters || {}) } };
      // A ballot from before the email had its "Joanne" and "why" columns
      // gets them now; the meals and their numbers don't change.
      if (snapshot) ballot.options = fillOptionDetails(existing.options, applyLogToSnapshot(snapshot, dailyLog), dateKey);
    } else {
      if (!snapshot) return { skipped: 'no-suggestions-saved' };
      const options = rankForVote(applyLogToSnapshot(snapshot, dailyLog), dateKey);
      ballot = { weekOf, createdAt: nowIso, options, voters: {}, votes: {} };
      if (ballotOptions(ballot).length === 0) return { skipped: 'no-meals-to-suggest' };
    }
    const byEmail = new Map(Object.entries(ballot.voters).map(([id, v]) => [v.email, id]));
    for (const v of settings.voters) {
      const id = byEmail.get(v.email);
      if (id) { ballot.voters[id] = { ...ballot.voters[id], name: v.name }; continue; }
      let n = Object.keys(ballot.voters).length;
      while (ballot.voters[`v${n}`]) n++;
      ballot.voters[`v${n}`] = { name: v.name, email: v.email, token: newToken() };
    }
    ballot.lastSentAt = nowIso;
    if (byCron) ballot.cronSent = true;

    const prune = Object.fromEntries(
      weeksToPrune({ ...weeks, [weekOf]: ballot }).map(k => [k, FieldValue.delete()]),
    );
    tx.set(ref, { weeks: { ...prune, [weekOf]: ballot } }, { merge: true });
    return { ballot };
  });
}

/**
 * Build (or reuse) the ballot and email everyone on the current voter list.
 * `send` is injectable for tests. Returns a summary; never throws for a
 * failed address.
 */
export async function sendMealVote(db, uid, rawSettings, { now = new Date(), byCron = false, send = sendMail } = {}) {
  const settings = normalizeMealVoteSettings(rawSettings);
  if (settings.voters.length === 0) return { skipped: 'no-voters' };
  const { dateKey } = eastern(now);
  const claimed = await claimBallot(db, uid, { settings, dateKey, byCron, nowIso: now.toISOString() });
  if (claimed.skipped) return claimed;
  const { ballot } = claimed;

  const current = new Set(settings.voters.map(v => v.email));
  const sentTo = [];
  const failed = [];
  for (const [id, v] of Object.entries(ballot.voters)) {
    // Someone taken off the voter list keeps their link but gets no more mail.
    if (!current.has(v.email)) continue;
    try {
      const mail = renderMealVoteEmail({ base: siteBase(), uid, ballot, voter: { id, ...v } });
      // Replies come back to the sending mailbox, tagged with this voter's
      // token so api/collect-meal-vote.js knows whose vote it is.
      // The tick-box version for Gmail rides along as a third part; anything
      // that can't show it shows the HTML above instead.
      const amp = settings.interactive
        ? renderMealVoteAmp({ base: siteBase(), uid, ballot, voter: { id, ...v } })
        : null;
      await send({
        to: v.email, ...mail,
        ...(amp ? { amp } : {}),
        replyTo: `Prep Day <${replyAddress(senderAddress(), v.token)}>`,
        headers: { [VOTE_MAIL_HEADER]: 'meal-vote' },
      });
      sentTo.push(v.email);
    } catch (err) {
      console.error('send-meal-vote: mail failed', uid, err?.message || err);
      failed.push({ email: v.email, error: err?.message || 'send failed' });
    }
  }
  if (byCron && sentTo.length === 0) {
    // Nothing went out: release the claim so the next hourly run retries.
    await db.collection('users').doc(uid).collection('data').doc('mealVote')
      .set({ weeks: { [ballot.weekOf]: { cronSent: false } } }, { merge: true })
      .catch(() => {});
  }
  return { weekOf: ballot.weekOf, sentTo, failed };
}

const SKIP_MESSAGE = {
  'no-voters': 'Add at least one voter with an email address first.',
  'no-suggestions-saved': 'Prep Day hasn\'t saved your Suggested Meals yet. Leave the Recipes page open for a few seconds with the vote switched on, then try again.',
  'no-meals-to-suggest': 'There are no Suggested Meals to offer right now.',
};

async function handleSendNow(req, res, db) {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Sign in first.' });
  let uid;
  try {
    uid = (await getAuth().verifyIdToken(match[1])).uid;
  } catch {
    return res.status(401).json({ error: 'Session expired — sign in again.' });
  }
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const settings = userSnap.exists ? userSnap.data().mealVoteSettings : null;
    const result = await sendMealVote(db, uid, settings, { byCron: false });
    if (result.skipped) return res.status(409).json({ error: SKIP_MESSAGE[result.skipped] || result.skipped });
    if (result.sentTo.length === 0) {
      return res.status(502).json({ error: result.failed[0]?.error || 'The email could not be sent.' });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('send-meal-vote (send now) error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

export default async function handler(req, res) {
  const db = getFirestore();
  if (req.method === 'POST') return handleSendNow(req, res, db);

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok = (req.headers.authorization || '') === `Bearer ${secret}` || req.query?.secret === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const clock = eastern(now);
  const summary = { enabled: 0, sent: 0, skipped: {}, errors: [] };
  try {
    const snap = await db.collection('users').where('mealVoteSettings.enabled', '==', true).get();
    for (const docSnap of snap.docs) {
      summary.enabled++;
      const settings = docSnap.data().mealVoteSettings;
      if (!mealVoteDue(settings, clock)) continue;
      try {
        const result = await sendMealVote(db, docSnap.id, settings, { now, byCron: true });
        if (result.skipped) summary.skipped[result.skipped] = (summary.skipped[result.skipped] || 0) + 1;
        else {
          if (result.sentTo.length > 0) summary.sent++;
          for (const f of result.failed) summary.errors.push({ uid: docSnap.id, error: f.error });
        }
      } catch (err) {
        console.error('send-meal-vote: user failed', docSnap.id, err);
        summary.errors.push({ uid: docSnap.id, error: err.message || 'failed' });
      }
    }
    return res.status(200).json({ ok: true, ...clock, ...summary });
  } catch (err) {
    console.error('send-meal-vote cron error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error', ...summary });
  }
}
