// Saves a vote ticked INSIDE the meal vote email — the interactive version
// Gmail shows (AMP for Email; lib/mealVoteEmail.js renders it).
//
//   POST /api/meal-vote-amp   u, w, t and any number of `pick`
//        Saves that voter's picks, replacing what they saved before, and
//        answers with JSON the email shows in place ({ message }).
//
// Written with the web-standard handler signature (Request in, Response out)
// rather than (req, res) like the routes around it, for one reason: an AMP
// form posts multipart/form-data, which Vercel's (req, res) helpers neither
// parse nor leave on the stream. request.formData() reads it natively.
//
// The mail client makes the request, not a page of ours, so it needs the AMP
// CORS handshake: Gmail names the sender it is acting for and the response
// has to name it back, or the reply is thrown away.
//
// Same credential as the ballot page: the per-voter, per-week token.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { senderAddress } from '../lib/mailer.js';
import { ballotOptions, sanitizePicks, voterForToken } from '../src/utils/mealVote.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

/**
 * The CORS headers an AMP email request needs, or null when the request names
 * a sender that isn't ours. Two generations of the handshake are in use:
 *   • AMP-Email-Sender in → AMP-Email-Allow-Sender out (current);
 *   • Origin + ?__amp_source_origin in → the three Access-Control headers out.
 */
export function ampCorsHeaders(request, sender = senderAddress()) {
  const ours = String(sender || '').trim().toLowerCase();
  const named = request.headers.get('amp-email-sender');
  if (named != null) {
    if (!ours || named.trim().toLowerCase() !== ours) return null;
    return { 'AMP-Email-Allow-Sender': named };
  }
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const source = new URL(request.url).searchParams.get('__amp_source_origin');
  if (source && ours && source.trim().toLowerCase() !== ours) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    ...(source ? {
      'AMP-Access-Control-Allow-Source-Origin': source,
      'Access-Control-Expose-Headers': 'AMP-Access-Control-Allow-Source-Origin',
    } : {}),
  };
}

function reply(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...cors,
    },
  });
}

const BAD_LINK = 'This email\'s vote has expired. Use the most recent meal vote email.';

/** The whole request, with the database passed in so it can be tested. */
export async function handleAmpVote(db, request, { nowIso = new Date().toISOString(), sender } = {}) {
  const cors = ampCorsHeaders(request, sender);
  if (!cors) return reply(403, { message: 'This sender is not allowed.' }, {});

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { message: 'The vote could not be read.' }, cors);
  }
  const one = (k) => String(form.get(k) ?? '').trim();
  const uid = one('u');
  const weekOf = one('w');
  const token = one('t');
  if (!uid || uid.includes('/') || uid.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || !token) {
    return reply(400, { message: BAD_LINK }, cors);
  }

  const ref = db.collection('users').doc(uid).collection('data').doc('mealVote');
  let ballot;
  try {
    const snap = await ref.get();
    ballot = snap.exists ? (snap.data().weeks || {})[weekOf] : null;
  } catch (err) {
    console.error('meal-vote-amp read error:', err);
    return reply(500, { message: 'Something went wrong on our side.' }, cors);
  }
  const voter = ballot ? voterForToken(ballot, token) : null;
  if (!voter) return reply(404, { message: BAD_LINK }, cors);

  const picks = sanitizePicks(ballot, form.getAll('pick').map(String));
  try {
    // Names only this voter's entry, as the ballot page and reply collector do.
    await ref.set({ weeks: { [weekOf]: { votes: { [voter.id]: { picks, at: nowIso } } } } }, { merge: true });
  } catch (err) {
    console.error('meal-vote-amp write error:', err);
    return reply(500, { message: 'Something went wrong on our side.' }, cors);
  }

  const chosen = ballotOptions(ballot)
    .map((o, i) => ({ ...o, n: i + 1 }))
    .filter(o => picks.includes(o.id));
  const message = chosen.length === 0
    ? `Saved, ${voter.name} — no meals picked.`
    : `Saved, ${voter.name}: ${chosen.map(o => `${o.n}. ${o.title}`).join(', ')}.`;
  return reply(200, { message, count: chosen.length }, cors);
}

export async function POST(request) {
  return handleAmpVote(getFirestore(), request);
}

/** Preflight, for clients that send one. */
export async function OPTIONS(request) {
  const cors = ampCorsHeaders(request);
  if (!cors) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || 'Content-Type, AMP-Email-Sender',
      'Access-Control-Max-Age': '600',
    },
  });
}
