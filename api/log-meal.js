/**
 * Webhook API for logging a meal via voice (Siri Shortcuts, Alexa, etc.)
 *
 * GET  /api/log-meal?uid=xxx&token=xxx&description=I+had+chicken+and+rice&slot=lunch
 * POST /api/log-meal  { uid, token, description, slot? }
 *
 * Writes a custom_meal entry to the user's dailyLog for today. If Claude is
 * available (ANTHROPIC_API_KEY set), nutrition is AI-estimated from the
 * description. Otherwise, a zero-nutrition placeholder is saved and the user
 * can refine it later in the app.
 *
 * Auth: token must match users/{uid}.siriToken in Firestore, or the legacy
 * SHOPPING_WEBHOOK_TOKEN env secret.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();

const VALID_SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);

function pickSlotFromHour(hour) {
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function estimateNutrition(description) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const systemPrompt =
    `You are a nutritionist. Given a meal description, return ONLY valid JSON, no markdown, ` +
    `with this shape: { "title": "clean meal name", "macrosPerServing": { "calories": number, "protein": number, "carbs": number, "fat": number } }. ` +
    `Estimate for a single typical serving.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: `Meal: ${description}` }],
        system: systemPrompt,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('estimateNutrition error:', err);
    return null;
  }
}

export default async function handler(req, res) {
  const params = req.method === 'GET' ? req.query : req.body;
  const { uid, token, description, slot: rawSlot } = params || {};

  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  if (!token) return res.status(401).json({ error: 'Missing token' });
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'Missing description' });
  }

  // Auth: match users/{uid}.siriToken or fall back to env secret.
  let userSnap;
  try {
    userSnap = await db.collection('users').doc(uid).get();
  } catch (err) {
    console.error('User lookup error:', err);
    return res.status(500).json({ error: 'User lookup failed' });
  }
  const userToken = userSnap.exists ? (userSnap.data().siriToken || null) : null;
  const envToken = process.env.SHOPPING_WEBHOOK_TOKEN;
  if (token !== userToken && (!envToken || token !== envToken)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const desc = String(description).trim();
  const slot = VALID_SLOTS.has(rawSlot) ? rawSlot : pickSlotFromHour(new Date().getHours());
  const today = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString();

  // Try AI estimate; fall back to zero-macro placeholder.
  const estimate = await estimateNutrition(desc);
  const macros = estimate?.macrosPerServing || {};
  const title = estimate?.title || desc.slice(0, 80);

  const entry = {
    id: generateId(),
    type: 'custom_meal',
    estimated: true,
    recipeName: title,
    mealSlot: slot,
    nutrition: {
      calories: macros.calories || 0,
      protein: macros.protein || 0,
      carbs: macros.carbs || 0,
      fat: macros.fat || 0,
    },
    ingredients: [desc],
    ingredientData: [],
    timestamp,
  };

  try {
    const dailyLogRef = db.collection('users').doc(uid).collection('data').doc('dailyLog');
    const snap = await dailyLogRef.get();
    const log = snap.exists ? (snap.data().log || {}) : {};
    const dayEntries = log[today]?.entries || [];
    const nextLog = {
      ...log,
      [today]: {
        ...(log[today] || {}),
        entries: [...dayEntries, entry],
      },
    };
    await dailyLogRef.set({ log: nextLog }, { merge: false });

    return res.status(200).json({
      success: true,
      slot,
      title,
      macros,
      estimated: !!estimate,
    });
  } catch (err) {
    console.error('log-meal write error:', err);
    return res.status(500).json({ error: err.message });
  }
}
