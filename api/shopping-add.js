/**
 * Webhook API for adding items to the shopping list via voice assistants (Siri, Alexa, etc.)
 *
 * POST /api/shopping-add
 * Body: { uid: "firebase-user-id", token: "secret-token", items: "milk, eggs, bread" }
 *
 * Or simple GET for Siri Shortcuts:
 * GET /api/shopping-add?uid=xxx&token=xxx&items=milk,eggs,bread
 *
 * The token is a simple shared secret to prevent unauthorized access.
 * Items are added to the user's shopExtras array in Firestore.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin (reuse if already initialized)
if (getApps().length === 0) {
  // Use application default credentials or service account
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    // Fallback: use project ID only (works with Vercel env)
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
  }
}

const db = getFirestore();

function parseItems(itemsStr) {
  if (!itemsStr) return [];
  return itemsStr
    .split(/[,\n;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(item => {
      // Try to parse "2 cups milk" format
      const match = item.match(/^(\d+(?:\.\d+)?)\s*(cups?|tbsp|tsp|oz|lbs?|kg|g|gallons?|liters?|bunch|bags?|boxes?|cans?|bottles?|packs?|loaves?)?\s+(.+)$/i);
      if (match) {
        return { quantity: parseFloat(match[1]) || 1, measurement: (match[2] || '').trim(), ingredient: match[3].trim() };
      }
      // Just an ingredient name
      return { quantity: 1, measurement: '', ingredient: item };
    });
}

export default async function handler(req, res) {
  // Allow both GET (for Siri Shortcuts) and POST
  const params = req.method === 'GET' ? req.query : req.body;
  const { uid, token, items } = params;

  // Validate
  const expectedToken = process.env.SHOPPING_WEBHOOK_TOKEN;
  if (!expectedToken) {
    return res.status(500).json({ error: 'SHOPPING_WEBHOOK_TOKEN not configured. Add it to Vercel environment variables.' });
  }
  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (!uid) {
    return res.status(400).json({ error: 'Missing uid' });
  }
  if (!items) {
    return res.status(400).json({ error: 'Missing items' });
  }

  const parsed = parseItems(items);
  if (parsed.length === 0) {
    return res.status(400).json({ error: 'No valid items found' });
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    const existing = snap.exists ? (snap.data().shopExtras || []) : [];
    const updated = [...existing, ...parsed];
    await userRef.set({ shopExtras: updated }, { merge: true });

    return res.status(200).json({
      success: true,
      added: parsed.length,
      items: parsed.map(i => `${i.quantity > 1 ? i.quantity + ' ' : ''}${i.measurement ? i.measurement + ' ' : ''}${i.ingredient}`),
      total: updated.length,
    });
  } catch (err) {
    console.error('Shopping add error:', err);
    return res.status(500).json({ error: err.message });
  }
}
