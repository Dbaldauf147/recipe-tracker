// Shared Whoop integration helpers for the api/whoop/* serverless functions.
//
// Handles: firebase-admin init (reused from the same FIREBASE_SERVICE_ACCOUNT
// env pattern as api/send-meal-prompt.js), Firebase ID-token verification,
// Whoop OAuth (authorize/token/refresh), per-user token storage in the
// private subcollection users/{uid}/private/whoop, and normalized data fetches
// against the Whoop v2 API.
//
// Required env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI,
// FIREBASE_SERVICE_ACCOUNT (already configured for other functions).

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

export const db = getFirestore();

// ── Whoop constants ──────────────────────────────────────────────────────
export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
export const WHOOP_SCOPES = [
  'offline',
  'read:recovery',
  'read:sleep',
  'read:workout',
  'read:cycles',
  'read:profile',
];

const KJ_PER_KCAL = 4.184;
export const kjToKcal = (kj) => (typeof kj === 'number' ? Math.round(kj / KJ_PER_KCAL) : 0);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

export function clientId() { return requireEnv('WHOOP_CLIENT_ID'); }
export function clientSecret() { return requireEnv('WHOOP_CLIENT_SECRET'); }
export function redirectUri() { return requireEnv('WHOOP_REDIRECT_URI'); }

// ── Auth ─────────────────────────────────────────────────────────────────
// Verify a Firebase ID token (passed as ?t= or Authorization: Bearer) and
// confirm it matches the claimed uid. Returns the uid or throws.
export async function verifyCaller(req) {
  const params = req.method === 'GET' ? req.query : { ...req.query, ...req.body };
  const uid = params.uid;
  let token = params.t;
  const authHeader = req.headers?.authorization || '';
  if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!uid) throw httpError(400, 'Missing uid');
  if (!token) throw httpError(401, 'Missing auth token');
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    throw httpError(401, 'Invalid auth token');
  }
  if (decoded.uid !== uid) throw httpError(403, 'Token does not match uid');
  return uid;
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ── OAuth state (short-lived, ties Whoop redirect back to a user) ─────────
export async function createOAuthState(uid) {
  const state = randomToken();
  await db.collection('whoopStates').doc(state).set({
    uid,
    exp: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
  return state;
}

export async function consumeOAuthState(state) {
  if (!state) return null;
  const ref = db.collection('whoopStates').doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  await ref.delete().catch(() => {});
  if (!data.exp || data.exp < Date.now()) return null;
  return data.uid || null;
}

function randomToken() {
  // Vercel functions run on Node 18+ where crypto.randomUUID exists.
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch { /* ignore */ }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function buildAuthorizeUrl(state) {
  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', WHOOP_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

// ── Token exchange / refresh ──────────────────────────────────────────────
async function postToken(body) {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw httpError(502, `Whoop token error ${res.status}: ${json.error || ''}`);
  }
  return json;
}

export async function exchangeCode(code) {
  return postToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
  });
}

export async function refreshAccessToken(refreshToken) {
  return postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    scope: 'offline',
  });
}

// ── Token storage (private subcollection — never synced to the client) ────
function tokenRef(uid) {
  return db.collection('users').doc(uid).collection('private').doc('whoop');
}

export async function saveTokens(uid, tok) {
  const expiresAt = Date.now() + (tok.expires_in || 3600) * 1000;
  await tokenRef(uid).set({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt,
    scope: tok.scope || '',
    updatedAt: Date.now(),
  }, { merge: true });
  await db.collection('users').doc(uid).set({ whoopConnected: true }, { merge: true });
}

export async function loadTokens(uid) {
  const snap = await tokenRef(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteTokens(uid) {
  await tokenRef(uid).delete().catch(() => {});
  await db.collection('users').doc(uid).set({ whoopConnected: false }, { merge: true });
}

// Return a valid access token for the user, refreshing (and persisting) when
// it is within 2 minutes of expiry. Returns null if the user isn't connected.
export async function getValidAccessToken(uid) {
  const tok = await loadTokens(uid);
  if (!tok?.accessToken) return null;
  if (tok.expiresAt && tok.expiresAt > Date.now() + 120 * 1000) {
    return tok.accessToken;
  }
  if (!tok.refreshToken) return tok.accessToken; // best effort
  const refreshed = await refreshAccessToken(tok.refreshToken);
  // Whoop may or may not return a new refresh token; keep the old one if not.
  if (!refreshed.refresh_token) refreshed.refresh_token = tok.refreshToken;
  await saveTokens(uid, refreshed);
  return refreshed.access_token;
}

// ── Whoop API fetch ────────────────────────────────────────────────────────
// Fetch all pages of a v2 collection endpoint within [start, end].
async function whoopFetchAll(accessToken, path, { start, end, limit = 25, maxPages = 6 } = {}) {
  const records = [];
  let nextToken = null;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${WHOOP_API_BASE}${path}`);
    if (start) url.searchParams.set('start', start);
    if (end) url.searchParams.set('end', end);
    url.searchParams.set('limit', String(limit));
    if (nextToken) url.searchParams.set('nextToken', nextToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      if (page === 0) throw httpError(502, `Whoop ${path} error ${res.status}`);
      break;
    }
    const json = await res.json().catch(() => ({}));
    if (Array.isArray(json.records)) records.push(...json.records);
    nextToken = json.next_token || null;
    if (!nextToken) break;
  }
  return records;
}

// Local date key (YYYY-MM-DD) for a Whoop ISO timestamp, applying the record's
// timezone_offset (e.g. "-04:00") so the day boundary matches the user's day.
export function localDateKey(iso, tzOffset) {
  if (!iso) return null;
  const base = new Date(iso);
  if (isNaN(base)) return null;
  let offsetMin = 0;
  if (typeof tzOffset === 'string') {
    const m = tzOffset.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (m) offsetMin = (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }
  const shifted = new Date(base.getTime() + offsetMin * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

// Fetch + normalize recovery, sleep, workouts, cycles for the last `days`.
export async function fetchWhoopData(accessToken, days = 14) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [cyclesRaw, recoveryRaw, sleepRaw, workoutsRaw] = await Promise.all([
    whoopFetchAll(accessToken, '/v2/cycle', { start: startIso, end: endIso }),
    whoopFetchAll(accessToken, '/v2/recovery', { start: startIso, end: endIso }),
    whoopFetchAll(accessToken, '/v2/activity/sleep', { start: startIso, end: endIso }),
    whoopFetchAll(accessToken, '/v2/activity/workout', { start: startIso, end: endIso }),
  ]);

  const cycles = cyclesRaw.map(c => ({
    id: c.id,
    date: localDateKey(c.start, c.timezone_offset),
    start: c.start,
    end: c.end,
    strain: c.score?.strain ?? null,
    calories: kjToKcal(c.score?.kilojoule),
    avgHeartRate: c.score?.average_heart_rate ?? null,
    maxHeartRate: c.score?.max_heart_rate ?? null,
  }));

  const recovery = recoveryRaw.map(r => ({
    cycleId: r.cycle_id,
    date: localDateKey(r.created_at, null),
    createdAt: r.created_at,
    recoveryScore: r.score?.recovery_score ?? null,
    restingHeartRate: r.score?.resting_heart_rate ?? null,
    hrv: r.score?.hrv_rmssd_milli != null ? Math.round(r.score.hrv_rmssd_milli) : null,
  }));

  const sleep = sleepRaw.map(s => {
    const stage = s.score?.stage_summary || {};
    const inBedMs = stage.total_in_bed_time_milli || 0;
    const awakeMs = stage.total_awake_time_milli || 0;
    return {
      id: s.id,
      date: localDateKey(s.start, s.timezone_offset),
      start: s.start,
      end: s.end,
      performance: s.score?.sleep_performance_percentage ?? null,
      durationMin: Math.round(Math.max(0, inBedMs - awakeMs) / 60000),
      inBedMin: Math.round(inBedMs / 60000),
      remMin: Math.round((stage.total_rem_sleep_time_milli || 0) / 60000),
      deepMin: Math.round((stage.total_slow_wave_sleep_time_milli || 0) / 60000),
    };
  });

  const workouts = workoutsRaw.map(w => ({
    id: w.id,
    date: localDateKey(w.start, w.timezone_offset),
    start: w.start,
    end: w.end,
    sportName: w.sport_name || w.sport_id || 'Workout',
    strain: w.score?.strain ?? null,
    calories: kjToKcal(w.score?.kilojoule),
    avgHeartRate: w.score?.average_heart_rate ?? null,
  }));

  // Per-day rollup used for the calorie-budget feature. Calories come from the
  // physiological cycle (whole-day energy expenditure).
  const daily = {};
  for (const c of cycles) {
    if (!c.date) continue;
    daily[c.date] = {
      calories: c.calories || 0,
      strain: c.strain,
    };
  }
  for (const r of recovery) {
    if (!r.date) continue;
    daily[r.date] = { ...(daily[r.date] || {}), recovery: r.recoveryScore };
  }
  const toHours = (min) => Math.round((min / 60) * 10) / 10;
  for (const s of sleep) {
    if (!s.date) continue;
    const hours = toHours(s.durationMin);
    const existing = daily[s.date] || {};
    // A day can hold several sleep records (naps); treat the longest as the
    // night's total so a short nap doesn't override the main sleep. We surface
    // sleepHours so the web charts can fall back to Whoop when Apple Health
    // hasn't synced a night, plus a per-stage breakdown matching the keys the
    // Sleep tab expects (Core = asleep − REM − Deep, Awake = in-bed − asleep).
    if (existing.sleepHours == null || hours > existing.sleepHours) {
      daily[s.date] = {
        ...existing,
        sleepPerformance: s.performance,
        sleepHours: hours,
        sleepBreakdown: {
          remHours: toHours(s.remMin),
          deepHours: toHours(s.deepMin),
          coreHours: toHours(Math.max(0, s.durationMin - s.remMin - s.deepMin)),
          awakeHours: toHours(Math.max(0, s.inBedMin - s.durationMin)),
          inBedHours: toHours(s.inBedMin),
        },
      };
    }
  }

  return { cycles, recovery, sleep, workouts, daily };
}
