// POST /api/alert-data-guard — notify the owner when the data-safety guard
// BLOCKS a destructive write (a write that would have erased a non-empty
// field). Fire-and-forget from the web/mobile firestoreSync guards. Notify-only
// (emails the fixed owner address), so no secret needed; it ignores anything
// that isn't a known guarded field to limit abuse.

import { sendMail } from '../lib/mailer.js';

const KNOWN_FIELDS = new Set([
  'dailyLog', 'recipes', 'weightLog', 'habits', 'ingredientsDb',
  'weeklyPlan', 'planHistory', 'groceryCategories', 'groceryItemSections',
  'shopLinks', 'restaurants', 'eatingOutVotes', 'keyIngredients',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const field = String(body?.field || '');
  const prevCount = Number(body?.prevCount) || 0;
  const platform = String(body?.platform || '?').slice(0, 20);
  const uid = String(body?.uid || '?').slice(0, 80);
  if (!KNOWN_FIELDS.has(field)) return res.status(200).json({ ok: false, reason: 'ignored' });

  const to = process.env.PREP_DAY_USER_EMAIL || process.env.GMAIL_USER;
  if (!to) return res.status(200).json({ ok: false, reason: 'no recipient' });

  try {
    await sendMail({
      to,
      subject: `⚠️ Prep Day blocked a data-wipe (${field})`,
      text:
        `The data-safety guard blocked a write that would have erased your "${field}" data ` +
        `(${prevCount} items) on ${platform}.\n\n` +
        `Nothing was lost — the write was refused before it could overwrite your data.\n` +
        `Account: ${uid}\nTime: ${new Date().toISOString()}\n\n— Prep Day`,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
