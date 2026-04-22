/**
 * Public endpoint to fetch a shared recipe by token.
 *
 * GET /api/shared-recipe?token=abc123
 *
 * Reads sharedLinks/{token} via Firebase Admin so the lookup works for
 * external (unauthenticated) users, regardless of Firestore security rules
 * on the sharedLinks collection.
 *
 * Returns: { recipe: <recipe object>, createdBy?, createdAt? }
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

export default async function handler(req, res) {
  const token = req.method === 'GET' ? req.query?.token : req.body?.token;
  if (!token || typeof token !== 'string' || !/^[A-Za-z0-9]{6,32}$/.test(token)) {
    return res.status(400).json({ error: 'Missing or malformed token' });
  }

  try {
    const snap = await db.collection('sharedLinks').doc(token).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Recipe not found or link expired' });
    }
    const data = snap.data() || {};
    return res.status(200).json({
      recipe: data.recipe || null,
      createdBy: data.createdBy || null,
      createdAt: data.createdAt || null,
    });
  } catch (err) {
    console.error('shared-recipe error:', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}
