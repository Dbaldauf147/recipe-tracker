// Records the votes people send by replying to the weekly meal vote email.
//
//   • GET — Vercel cron, every ten minutes. Reads the replies waiting in the
//     sending mailbox (lib/mealVoteInbox.js), works out whose each one is and
//     which meals it names, saves that voter's picks on the ballot, and
//     answers in the same thread with what was counted.
//   • POST with the account's Firebase ID token — the Recipes page asks for a
//     check when it opens, so a vote sent a minute ago doesn't wait for the
//     next cron run.
//
// The mailbox is only read. What has been handled is remembered per voter on
// the ballot (`mail.{voterId}.seenAt`, the time the mailbox received the
// newest reply dealt with), so a reply is acted on once however often this
// runs. A reply only changes a vote if it is newer than the vote that is
// there — someone who replied and then changed their mind on the ballot page
// keeps what they saved on the page.
//
// Auth for GET: `Authorization: Bearer <CRON_SECRET>` (or ?secret=), as the
// other crons.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { sendMail } from '../lib/mailer.js';
import { fetchVoteReplies } from '../lib/mealVoteInbox.js';
import { renderVoteReceipt } from '../lib/mealVoteEmail.js';
import { VOTE_MAIL_HEADER, matchReply, parseReply } from '../src/utils/mealVoteReply.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

/** How long after an email goes out its replies are still collected. */
export const REPLY_WINDOW_DAYS = 9;

const voteRef = (db, uid) => db.collection('users').doc(uid).collection('data').doc('mealVote');

/** [{ uid, weeks }] for one account, or for every account with the vote on. */
export async function loadAccounts(db, onlyUid) {
  let uids;
  if (onlyUid) uids = [onlyUid];
  else {
    const snap = await db.collection('users').where('mealVoteSettings.enabled', '==', true).get();
    uids = snap.docs.map(d => d.id);
  }
  const out = [];
  for (const uid of uids) {
    const doc = await voteRef(db, uid).get();
    const weeks = doc.exists ? (doc.data().weeks || {}) : {};
    if (Object.keys(weeks).length > 0) out.push({ uid, weeks });
  }
  return out;
}

/** Has any of these accounts emailed a ballot recently enough to get replies? */
export function anyOpenBallot(accounts, now = new Date()) {
  const cutoff = new Date(now.getTime() - REPLY_WINDOW_DAYS * 86400000).toISOString();
  return accounts.some(a => Object.values(a.weeks).some(b => String(b?.lastSentAt || '') >= cutoff));
}

/**
 * Apply a batch of replies (oldest first) to the ballots in `accounts`.
 * `send` is injectable for tests. Returns a summary; a failed receipt never
 * undoes a saved vote.
 */
export async function applyReplies(db, accounts, replies, { send = sendMail } = {}) {
  const summary = { read: replies.length, recorded: 0, unclear: 0, ignored: 0, errors: [] };
  for (const msg of replies) {
    if (msg.ours || msg.automatic || !msg.date) { summary.ignored++; continue; }
    const hit = matchReply(accounts, msg);
    if (!hit) { summary.ignored++; continue; }
    const { uid, weekOf, ballot, voter } = hit;
    const seenAt = ballot.mail?.[voter.id]?.seenAt || '';
    if (msg.date <= seenAt) continue;

    const { understood, picks, typed } = parseReply(ballot, msg.text);
    const newer = msg.date > String(ballot.votes?.[voter.id]?.at || '');
    const record = understood && newer;
    const patch = { mail: { [voter.id]: { seenAt: msg.date } } };
    if (record) patch.votes = { [voter.id]: { picks, at: msg.date } };
    try {
      // A merge that names only this voter's entries, as the ballot page does.
      await voteRef(db, uid).set({ weeks: { [weekOf]: patch } }, { merge: true });
    } catch (err) {
      console.error('collect-meal-vote: save failed', uid, err?.message || err);
      summary.errors.push({ uid, error: err?.message || 'save failed' });
      continue;
    }
    // Keep the copy in hand in step, for a second reply in the same batch.
    ballot.mail = { ...(ballot.mail || {}), [voter.id]: { seenAt: msg.date } };
    if (record) ballot.votes = { ...(ballot.votes || {}), [voter.id]: { picks, at: msg.date } };

    if (record) summary.recorded++;
    else if (!understood) summary.unclear++;
    else { summary.ignored++; continue; } // older than the vote already there

    // Nothing typed at all (an empty reply, or only a quote) gets no answer:
    // there is no person waiting for one, and it is how a mail loop looks.
    if (!understood && !typed) continue;
    try {
      const mail = renderVoteReceipt({ ballot: { ...ballot, weekOf }, voter, picks, understood });
      await send({
        to: voter.email, ...mail,
        headers: { [VOTE_MAIL_HEADER]: 'meal-vote-receipt', 'Auto-Submitted': 'auto-replied' },
        ...(msg.messageId ? { inReplyTo: msg.messageId, references: [...(msg.references || []), msg.messageId] } : {}),
      });
    } catch (err) {
      console.error('collect-meal-vote: receipt failed', uid, err?.message || err);
      summary.errors.push({ uid, error: `receipt: ${err?.message || 'send failed'}` });
    }
  }
  return summary;
}

/** The whole run: skip the mailbox entirely when no ballot is waiting. */
export async function collectMealVotes(db, { onlyUid, now = new Date(), fetch = fetchVoteReplies, send = sendMail } = {}) {
  const accounts = await loadAccounts(db, onlyUid);
  if (!anyOpenBallot(accounts, now)) return { read: 0, recorded: 0, unclear: 0, ignored: 0, errors: [], idle: true };
  const replies = await fetch({ sinceDays: REPLY_WINDOW_DAYS, now });
  return applyReplies(db, accounts, replies, { send });
}

export default async function handler(req, res) {
  const db = getFirestore();
  try {
    if (req.method === 'POST') {
      const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
      if (!match) return res.status(401).json({ error: 'Sign in first.' });
      let uid;
      try {
        uid = (await getAuth().verifyIdToken(match[1])).uid;
      } catch {
        return res.status(401).json({ error: 'Session expired — sign in again.' });
      }
      const summary = await collectMealVotes(db, { onlyUid: uid });
      return res.status(200).json({ ok: true, recorded: summary.recorded, unclear: summary.unclear });
    }

    const secret = process.env.CRON_SECRET;
    if (secret) {
      const ok = (req.headers.authorization || '') === `Bearer ${secret}` || req.query?.secret === secret;
      if (!ok) return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.status(200).json({ ok: true, ...(await collectMealVotes(db)) });
  } catch (err) {
    console.error('collect-meal-vote error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
