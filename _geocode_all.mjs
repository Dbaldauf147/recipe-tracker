// One-off bulk geocoder. Runs against Firestore via firebase-admin,
// hitting Nominatim directly with a 1.2s throttle. Safe to interrupt —
// each success is persisted before the next request.
//
// Usage (from repo root):
//   node --env-file=.vercel/.env.geocode.local _geocode_all.mjs [email]
//
// Delete this file after running.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const TARGET_EMAIL = process.argv[2] || 'baldaufdan@gmail.com';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'PrepDay/1.0 (https://prep-day.com; baldaufdan@gmail.com)';
const THROTTLE_MS = 1200;

function coerceCoord(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null || v === '') return NaN;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}
function hasValidCoords(r) {
  return Number.isFinite(coerceCoord(r?.lat)) && Number.isFinite(coerceCoord(r?.lng));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeOne(address) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Accept-Language': 'en',
    },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  const lat = parseFloat(top.lat);
  const lng = parseFloat(top.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT env var.');
    console.error('Run with: node --env-file=.vercel/.env.geocode.local _geocode_all.mjs');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(raw);
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }

  console.log(`Looking up user: ${TARGET_EMAIL}`);
  const user = await getAuth().getUserByEmail(TARGET_EMAIL);
  console.log(`  uid: ${user.uid}`);

  const db = getFirestore();
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error('User doc does not exist.');
    process.exit(1);
  }
  const data = snap.data();
  const restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
  console.log(`Total restaurants: ${restaurants.length}`);

  const candidates = restaurants
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) =>
      typeof r.address === 'string' && r.address.trim() && !hasValidCoords(r),
    );
  console.log(`Candidates (have address, no coords): ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Nothing to geocode.');
    return;
  }

  const working = [...restaurants];
  let succeeded = 0;
  let notFound = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < candidates.length; i++) {
    const { r, idx } = candidates[i];
    const tag = `[${i + 1}/${candidates.length}]`;
    try {
      const result = await geocodeOne(r.address);
      if (result) {
        working[idx] = {
          ...working[idx],
          lat: result.lat,
          lng: result.lng,
          updatedAt: new Date().toISOString(),
        };
        await ref.update({ restaurants: working });
        succeeded++;
        console.log(`${tag} ✓ ${r.name} → ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`);
      } else {
        notFound++;
        failures.push({ name: r.name, address: r.address, reason: 'not found' });
        console.log(`${tag} ? ${r.name} (no Nominatim match for "${r.address}")`);
      }
    } catch (err) {
      failed++;
      failures.push({ name: r.name, address: r.address, reason: err.message });
      console.log(`${tag} ✗ ${r.name} — ${err.message}`);
    }
    if (i < candidates.length - 1) await sleep(THROTTLE_MS);
  }

  console.log('');
  console.log('═══ DONE ═══');
  console.log(`✓ ${succeeded} geocoded`);
  console.log(`? ${notFound} not found`);
  console.log(`✗ ${failed} failed`);
  if (failures.length > 0) {
    console.log('');
    console.log('Failures / not-found:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.address} (${f.reason})`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
