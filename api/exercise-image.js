/**
 * AI-generated cartoon illustrations of exercises.
 *
 * POST /api/exercise-image
 * Body: { name: string }
 * Returns: { url: string, cached: boolean }
 *
 * Flow:
 *   1. Slugify the exercise name.
 *   2. If a cached image exists at exerciseImages/{slug} in Firestore,
 *      return its URL immediately.
 *   3. Otherwise call OpenAI's DALL·E 3 to generate a flat cartoon
 *      illustration, upload the PNG to Firebase Storage at
 *      exercise-images/{slug}.png, and write the URL into Firestore for
 *      next time.
 *
 * Env vars required:
 *   - OPENAI_API_KEY
 *   - FIREBASE_SERVICE_ACCOUNT  (already used by other API routes)
 *   - FIREBASE_STORAGE_BUCKET   (optional; defaults to <project-id>.appspot.com)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    (serviceAccount?.project_id ? `${serviceAccount.project_id}.appspot.com` : 'sunday-routine.appspot.com');
  if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount), storageBucket });
  } else {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine', storageBucket });
  }
}

const db = getFirestore();
const storage = getStorage();

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }

  const slug = slugify(name);
  if (!slug) {
    return res.status(400).json({ error: 'invalid name' });
  }

  const cacheRef = db.collection('exerciseImages').doc(slug);

  // 1. Cache hit?
  try {
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const data = cacheSnap.data();
      if (data?.url) {
        return res.status(200).json({ url: data.url, cached: true });
      }
    }
  } catch (err) {
    console.error('exercise-image cache read failed:', err);
    // fall through to generation
  }

  // 2. Generate via OpenAI.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const prompt =
    `Simple, friendly cartoon illustration of one person performing the "${name.trim()}" exercise. ` +
    `Flat vector style, clean lines, soft pastel colors, plain white background, full body visible, ` +
    `correct form, dynamic pose. No text, no labels, no logos, no watermarks. Single subject, centered.`;

  let b64;
  try {
    const genRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'b64_json',
      }),
    });
    if (!genRes.ok) {
      const errText = await genRes.text();
      console.error('OpenAI image error:', errText);
      return res.status(502).json({ error: 'image generation failed' });
    }
    const data = await genRes.json();
    b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: 'no image returned' });
  } catch (err) {
    console.error('OpenAI fetch failed:', err);
    return res.status(502).json({ error: 'image generation failed' });
  }

  // 3. Upload to Firebase Storage and make public-readable.
  let publicUrl;
  try {
    const buffer = Buffer.from(b64, 'base64');
    const bucket = storage.bucket();
    const file = bucket.file(`exercise-images/${slug}.png`);
    await file.save(buffer, {
      contentType: 'image/png',
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });
    await file.makePublic();
    publicUrl = `https://storage.googleapis.com/${bucket.name}/exercise-images/${slug}.png`;
  } catch (err) {
    console.error('Storage upload failed:', err);
    return res.status(500).json({ error: 'storage upload failed' });
  }

  // 4. Write cache metadata (best-effort).
  try {
    await cacheRef.set({
      name: name.trim(),
      slug,
      url: publicUrl,
      model: 'dall-e-3',
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('exerciseImages cache write failed:', err);
    // Image is already in storage and public — don't fail the request
  }

  return res.status(200).json({ url: publicUrl, cached: false });
}
