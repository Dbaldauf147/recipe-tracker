// The page behind the links in the weekly meal vote email.
//
//   GET  /api/meal-vote?u=<uid>&w=<week>&t=<token>[&pick=<recipeId>]
//        The ballot, as a plain HTML page — no sign-in, no app bundle, so it
//        opens instantly from a mail client. `pick` ticks one meal on arrival.
//        With &done=1: everyone's votes so far (where a save redirects to).
//   POST /api/meal-vote   u, w, t and any number of `pick` (a form post)
//        Saves that voter's picks, replacing what they saved before.
//
// The token in the link is the only credential: random, per voter, per week,
// stored on the ballot (users/{uid}/data/mealVote). It lets its holder read
// that week's ten meal names and set one person's ticks, nothing else.
//
// GET never writes. Mail scanners open every link in a message; if opening
// one voted, the scanner would vote.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sanitizePicks, voterForToken } from '../src/utils/mealVote.js';
import { renderBallotPage, renderResultPage, renderMessagePage, voteUrl } from '../lib/mealVoteEmail.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

// A form post normally arrives parsed; a raw string or buffer is parsed here
// so repeated `pick` fields are never lost to a missing body parser.
export function readParams(req) {
  if (req.method !== 'POST') return { ...(req.query || {}) };
  let body = req.body;
  if (body instanceof Uint8Array) body = new TextDecoder().decode(body);
  if (typeof body === 'string') {
    const q = new URLSearchParams(body);
    return { u: q.get('u'), w: q.get('w'), t: q.get('t'), pick: q.getAll('pick') };
  }
  return { ...(body || {}) };
}

const one = (v) => String(Array.isArray(v) ? v[0] : (v ?? '')).trim();

function html(res, status, markup) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The link carries the token: keep it out of caches and out of the Referer
  // of anything the page links to.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(status).send(markup);
}

const BAD_LINK = ['This link doesn\'t work', 'It may be from an older email. Open the most recent meal vote email and use the link in that one.'];

export async function handleMealVote(db, req, res, { nowIso = new Date().toISOString() } = {}) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return html(res, 405, renderMessagePage('Not allowed', 'This page only shows and saves a meal vote.'));
  }
  const p = readParams(req);
  const uid = one(p.u);
  const weekOf = one(p.w);
  const token = one(p.t);
  if (!uid || uid.includes('/') || uid.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || !token) {
    return html(res, 400, renderMessagePage(...BAD_LINK));
  }

  const ref = db.collection('users').doc(uid).collection('data').doc('mealVote');
  let ballot;
  try {
    const snap = await ref.get();
    ballot = snap.exists ? (snap.data().weeks || {})[weekOf] : null;
  } catch (err) {
    console.error('meal-vote read error:', err);
    return html(res, 500, renderMessagePage('Something went wrong', 'The vote could not be loaded. Try the link again in a minute.'));
  }
  const voter = ballot ? voterForToken(ballot, token) : null;
  if (!voter) return html(res, 404, renderMessagePage(...BAD_LINK));
  ballot = { ...ballot, weekOf };
  const me = { ...voter, token };

  if (req.method === 'GET') {
    if (one(p.done) === '1' && ballot.votes?.[voter.id]) {
      return html(res, 200, renderResultPage({ uid, ballot, voter: me }));
    }
    return html(res, 200, renderBallotPage({ uid, ballot, voter: me, pick: one(p.pick) }));
  }

  const picks = sanitizePicks(ballot, p.pick);
  try {
    // A merge that names only this voter's entry: the other person saving at
    // the same moment writes a different key and neither overwrites the other.
    await ref.set({ weeks: { [weekOf]: { votes: { [voter.id]: { picks, at: nowIso } } } } }, { merge: true });
  } catch (err) {
    console.error('meal-vote write error:', err);
    return html(res, 500, renderMessagePage('Your votes weren\'t saved', 'Something went wrong on our side. Go back and press Save again.'));
  }
  // Redirect so a refresh shows the results instead of posting again.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Location', `${voteUrl('', { uid, weekOf, token })}&done=1`);
  return res.status(303).end();
}

export default async function handler(req, res) {
  return handleMealVote(getFirestore(), req, res);
}
