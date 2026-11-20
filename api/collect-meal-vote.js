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
// A reply with the "more meals" number (0) also gets the next round of
// Suggested Meals: they are added to the end of the ballot (`more`), so every
// number already sent keeps its meaning, and emailed back in the thread
// instead of a receipt. Asking for more keeps what was picked: the numbers in
// that reply, and in the next one, are added to the vote rather than
// replacing it (`mail.{voterId}.moreAt` marks the vote that asked, so a later
// save on the ballot page ends it). "none" still clears everything.
//
// Auth for GET: `Authorization: Bearer <CRON_SECRET>` (or ?secret=), as the
// other crons.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { sendMail, senderAddress } from '../lib/mailer.js';
import { fetchVoteReplies } from '../lib/mealVoteInbox.js';
import { renderVoteReceipt, renderMealVoteEmail } from '../lib/mealVoteEmail.js';
import { VOTE_MAIL_HEADER, matchReply, parseReply, replyAddress } from '../src/utils/mealVoteReply.js';
import { applyLogToSnapshot, ballotOptions, nextRound } from '../src/utils/mealVote.js';
import { eastern } from './send-meal-vote.js';

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
const siteBase = () => (process.env.PUBLIC_SITE_URL || 'https://prep-day.com').trim();

/** The ranking inputs for a further round of meals, brought up to date. */
async function loadVoteSnapshot(db, uid) {
  const dataCol = db.collection('users').doc(uid).collection('data');
  const [snapDoc, logDoc] = await Promise.all([dataCol.doc('mealVoteSnapshot').get(), dataCol.doc('dailyLog').get()]);
  if (!snapDoc.exists) return null;
  return applyLogToSnapshot(snapDoc.data(), logDoc.exists ? (logDoc.data().log || {}) : {});
}

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
 * `send` and `loadSnapshot` are injectable for tests. Returns a summary; a
 * failed email never undoes a saved vote.
 */
export async function applyReplies(db, accounts, replies, {
  send = sendMail, loadSnapshot = (uid) => loadVoteSnapshot(db, uid), now = new Date(),
} = {}) {
  const summary = { read: replies.length, recorded: 0, unclear: 0, ignored: 0, more: 0, errors: [] };
  for (const msg of replies) {
    if (msg.ours || msg.automatic || !msg.date) { summary.ignored++; continue; }
    const hit = matchReply(accounts, msg);
    if (!hit) { summary.ignored++; continue; }
    const { uid, weekOf, ballot, voter } = hit;
    const seenAt = ballot.mail?.[voter.id]?.seenAt || '';
    if (msg.date <= seenAt) continue;

    const parsed = parseReply(ballot, msg.text);
    const { understood, typed, more, none } = parsed;
    const prev = ballot.votes?.[voter.id];
    const moreAt = ballot.mail?.[voter.id]?.moreAt || '';
    // Adding to the vote rather than replacing it: this reply asks for more,
    // or answers the more-meals email (the vote is still the one that asked).
    const adding = !none && (more || (!!moreAt && prev?.at === moreAt));
    const keep = new Set(adding ? (prev?.picks || []) : []);
    const picks = ballotOptions(ballot).map(o => o.id).filter(id => keep.has(id) || parsed.picks.includes(id));
    const newer = msg.date > String(prev?.at || '');
    const record = understood && newer;
    const mailEntry = { seenAt: msg.date, ...(record && more ? { moreAt: msg.date } : {}) };
    const patch = { mail: { [voter.id]: mailEntry } };
    if (record) patch.votes = { [voter.id]: { picks, at: msg.date } };

    // The next round of meals, when asked for.
    let round = null;
    let outOfMeals = false;
    if (record && more) {
      let r = null;
      try {
        const snap = await loadSnapshot(uid);
        r = snap ? nextRound(ballot, snap, eastern(now).dateKey) : null;
      } catch (err) {
        console.error('collect-meal-vote: next round failed', uid, err?.message || err);
      }
      if (r) {
        patch.more = [...(Array.isArray(ballot.more) ? ballot.more : []), r];
        round = patch.more.length;
      } else outOfMeals = true;
    }
    try {
      // A merge that names only this voter's entries, as the ballot page does
      // (and the whole `more` list, which only ever grows).
      await voteRef(db, uid).set({ weeks: { [weekOf]: patch } }, { merge: true });
    } catch (err) {
      console.error('collect-meal-vote: save failed', uid, err?.message || err);
      summary.errors.push({ uid, error: err?.message || 'save failed' });
      continue;
    }
    // Keep the copy in hand in step, for a second reply in the same batch.
    ballot.mail = { ...(ballot.mail || {}), [voter.id]: { ...(ballot.mail?.[voter.id] || {}), ...mailEntry } };
    if (record) ballot.votes = { ...(ballot.votes || {}), [voter.id]: { picks, at: msg.date } };
    if (patch.more) ballot.more = patch.more;

    if (record) summary.recorded++;
    else if (!understood) summary.unclear++;
    else { summary.ignored++; continue; } // older than the vote already there

    // Nothing typed at all (an empty reply, or only a quote) gets no answer:
    // there is no person waiting for one, and it is how a mail loop looks.
    if (!understood && !typed) continue;
    const thread = msg.messageId ? { inReplyTo: msg.messageId, references: [...(msg.references || []), msg.messageId] } : {};
    try {
      if (round != null) {
        const v = ballot.voters?.[voter.id] || {};
        const mail = renderMealVoteEmail({
          base: siteBase(), uid, ballot: { ...ballot, weekOf }, voter: { id: voter.id, ...v }, round, picked: picks,
        });
        await send({
          to: voter.email, ...mail,
          replyTo: `Prep Day <${replyAddress(senderAddress(), v.token)}>`,
          headers: { [VOTE_MAIL_HEADER]: 'meal-vote-more', 'Auto-Submitted': 'auto-replied' },
          ...thread,
        });
        summary.more++;
      } else {
        const mail = renderVoteReceipt({ ballot: { ...ballot, weekOf }, voter, picks, understood, outOfMeals });
        await send({
          to: voter.email, ...mail,
          headers: { [VOTE_MAIL_HEADER]: 'meal-vote-receipt', 'Auto-Submitted': 'auto-replied' },
          ...thread,
        });
      }
    } catch (err) {
      console.error('collect-meal-vote: reply mail failed', uid, err?.message || err);
      summary.errors.push({ uid, error: `receipt: ${err?.message || 'send failed'}` });
    }
  }
  return summary;
}

/** The whole run: skip the mailbox entirely when no ballot is waiting. */
export async function collectMealVotes(db, { onlyUid, now = new Date(), fetch = fetchVoteReplies, send = sendMail } = {}) {
  const accounts = await loadAccounts(db, onlyUid);
  if (!anyOpenBallot(accounts, now)) return { read: 0, recorded: 0, unclear: 0, ignored: 0, more: 0, errors: [], idle: true };
  const replies = await fetch({ sinceDays: REPLY_WINDOW_DAYS, now });
  return applyReplies(db, accounts, replies, { send, now });
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
