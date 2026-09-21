/**
 * Public endpoint for a shared air fryer table.
 *
 * GET /api/air-fryer-share?token=abc123
 *
 * The token doc lives in sharedLinks/{token} (same collection the recipe
 * share uses, whose rules already allow a public `get`) and holds nothing but
 * `{ kind: 'air-fryer', createdBy }` — a POINTER, not a copy. The table itself
 * is read fresh off the owner's user doc on every request, so the link is
 * always the current table: an edit made at the counter is live on the link
 * before the basket is out, with nothing to re-publish.
 *
 * Only the air-fryer fields leave this function. The user doc holds the whole
 * app, so the response is an allow-list rather than a delete-list — a field
 * added to the doc next year must not silently become public.
 *
 * Returns: { rows, hidden, spices, oils, timeNotes, names, sharedByName }
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
  }
}

const db = getFirestore();

/** A plain object of arrays-of-strings, or {} — never whatever was in the doc. */
function tagMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v)) continue;
    const list = v.map(x => String(x || '').trim()).filter(Boolean).slice(0, 24);
    if (list.length > 0) out[String(k)] = list;
  }
  return out;
}

/** { key: { low, high } }, both strings. */
function noteMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const low = String(v.low || '').trim().slice(0, 200);
    const high = String(v.high || '').trim().slice(0, 200);
    if (low || high) out[String(k)] = { low, high };
  }
  return out;
}

/** { key: 'your name for it' }. */
function stringMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = String(v || '').trim().slice(0, 120);
    if (s) out[String(k)] = s;
  }
  return out;
}

/** The owner's own rows, reduced to the columns this page draws. */
function rowList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map(r => ({
    name: String(r?.name || '').trim().slice(0, 120),
    cat: String(r?.cat || '').trim().slice(0, 60),
    tempF: r?.tempF === '' || r?.tempF == null ? '' : Number(r.tempF) || '',
    min: Number(r?.min) || 0,
    max: Number(r?.max) || 0,
    doneF: Number(r?.doneF) || undefined,
    stop: r?.stop === undefined ? undefined : String(r.stop || '').slice(0, 120),
    note: String(r?.note || '').slice(0, 600),
  })).filter(r => r.name);
}

export default async function handler(req, res) {
  const token = req.method === 'GET' ? req.query?.token : req.body?.token;
  if (!token || typeof token !== 'string' || !/^[A-Za-z0-9]{6,32}$/.test(token)) {
    return res.status(400).json({ error: 'Missing or malformed token' });
  }

  try {
    const linkSnap = await db.collection('sharedLinks').doc(token).get();
    if (!linkSnap.exists) {
      return res.status(404).json({ error: 'Link not found or expired' });
    }
    const link = linkSnap.data() || {};
    // A recipe token must not open the air fryer table, and vice versa.
    if (link.kind !== 'air-fryer' || !link.createdBy) {
      return res.status(404).json({ error: 'Link not found or expired' });
    }

    const userSnap = await db.collection('users').doc(String(link.createdBy)).get();
    const u = userSnap.exists ? (userSnap.data() || {}) : {};

    // A 30-minute CDN cache with a day of stale-while-revalidate: a link passed
    // round a family group chat is the same table for everyone who opens it,
    // and the owner's edits still land within the half hour.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400');

    return res.status(200).json({
      rows: rowList(u.airFryerNotes),
      hidden: Array.isArray(u.airFryerHidden)
        ? u.airFryerHidden.map(x => String(x || '')).filter(Boolean)
        : [],
      spices: tagMap(u.airFryerSpices),
      oils: tagMap(u.airFryerOils),
      timeNotes: noteMap(u.airFryerTimeNotes),
      names: stringMap(u.airFryerLinks),
      sharedByName: String(link.createdByName || '').trim(),
    });
  } catch (err) {
    console.error('air-fryer-share error:', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}
