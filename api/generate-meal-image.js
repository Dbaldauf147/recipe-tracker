import sharp from 'sharp';
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

const db = getFirestore();

// POST /api/generate-meal-image
//   { image: <dataUrl|base64> }                      → compress an uploaded photo
//   { recipeName, ingredients: [{ingredient}|str] }  → AI-generate a dish photo
// Returns { dataUrl } as a ≤800px JPEG (well under Firestore's ~1MB doc cap), so
// the mobile app — which has no canvas to compress with — can save it directly
// to users/{uid}/mealImages/{recipeId}, matching the website.
async function toCompressedDataUrl(buf) {
  const jpeg = await sharp(buf)
    .rotate() // honor EXIF orientation from phone photos
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

// AI generation is a paid call, so it's gated behind the caller's Firebase ID
// token + a per-user daily quota. Reserve a slot up front (atomic) so a burst of
// concurrent requests can't blow past the cap; refund on failure so a broken
// generation doesn't cost the user a slot.
const DAILY_LIMIT = Number(process.env.MEAL_IMAGE_DAILY_LIMIT) || 25;

function quotaRefFor(uid) {
  return db.collection('users').doc(uid).collection('data').doc('imageGenQuota');
}

async function reserveQuotaSlot(uid, today) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(quotaRefFor(uid));
    const data = snap.exists ? snap.data() : {};
    const count = data.date === today ? (data.count || 0) : 0;
    if (count >= DAILY_LIMIT) return false;
    tx.set(quotaRefFor(uid), { date: today, count: count + 1 }, { merge: true });
    return true;
  });
}

async function refundQuotaSlot(uid, today) {
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(quotaRefFor(uid));
      const data = snap.exists ? snap.data() : {};
      if (data.date === today && (data.count || 0) > 0) {
        tx.set(quotaRefFor(uid), { date: today, count: data.count - 1 }, { merge: true });
      }
    });
  } catch (e) {
    console.error('[generate-meal-image] quota refund error', e?.message || e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { image, recipeName, ingredients } = req.body || {};

    // Mode 1: compress an uploaded image. Unauthenticated — it's just a resize,
    // no paid API, no per-user cost.
    if (image) {
      const b64 = String(image).replace(/^data:[^,]+,/, '');
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return res.status(400).json({ error: 'empty image' });
      return res.status(200).json({ dataUrl: await toCompressedDataUrl(buf) });
    }

    // Mode 2: AI-generate via Gemini, then compress. The key is server-only.
    // The old VITE_-prefixed name was retired: Vite inlines any VITE_* var into
    // the public client bundle, which is exactly how the previous key leaked and
    // got the project suspended for hijacking. Never reintroduce that fallback.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    // Require a valid Firebase ID token — this is the metered, paid path.
    const authHeader = req.headers.authorization || '';
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) return res.status(401).json({ error: 'Sign in to generate images.' });
    let uid;
    try {
      const decoded = await getAuth().verifyIdToken(tokenMatch[1]);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: 'Session expired — sign in again.' });
    }

    // Per-user daily quota.
    const today = new Date().toISOString().slice(0, 10);
    let reserved;
    try {
      reserved = await reserveQuotaSlot(uid, today);
    } catch (e) {
      console.error('[generate-meal-image] quota check failed', e?.message || e);
      return res.status(500).json({ error: 'Could not check your image quota.' });
    }
    if (!reserved) {
      return res.status(429).json({
        error: `You've hit today's image limit (${DAILY_LIMIT}/day). Try again tomorrow.`,
      });
    }

    const list = (Array.isArray(ingredients) ? ingredients : [])
      .map(i => (typeof i === 'string' ? i : (i?.ingredient || '')))
      .map(s => String(s).trim())
      .filter(Boolean)
      .slice(0, 10)
      .join(', ');
    const prompt = `Professional overhead food photography of ${recipeName || 'a dish'} on a clean white plate${list ? `, containing ${list}` : ''}, natural lighting, appetizing, high quality, no text`;

    // From here on, refund the reserved slot on any failure.
    let succeeded = false;
    try {
      let lastErr = 'unknown error';
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Referer': 'https://prep-day.com/' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
            }),
          },
        );
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          console.error('[generate-meal-image] Gemini error', r.status, t.slice(0, 300));
          // Don't echo the provider body (it can include the key id).
          lastErr = r.status === 403
            ? 'AI image generation is temporarily unavailable (image API key issue).'
            : `Image generation failed (HTTP ${r.status}).`;
          if (r.status === 429) { await new Promise(s => setTimeout(s, 8000)); continue; }
          break;
        }
        const data = await r.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const img = parts.find(p => p.inlineData);
        if (!img) { lastErr = 'no image in response'; continue; }
        const dataUrl = await toCompressedDataUrl(Buffer.from(img.inlineData.data, 'base64'));
        succeeded = true;
        return res.status(200).json({ dataUrl });
      }
      return res.status(502).json({ error: lastErr });
    } finally {
      if (!succeeded) await refundQuotaSlot(uid, today);
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
