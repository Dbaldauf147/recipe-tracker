// POST /api/send-test-reminder { emails: [...], kind?: 'test' | 'meal-log' | 'weight', remaining?: number }
//
// Sends a preview email via Resend so the user can verify the address
// works AND see what each real reminder would look like.
// - kind='test' (default): the legacy "this is a test" body. Used by the
//   Account Settings → Send Test Email button.
// - kind='meal-log': same body the hourly cron sends when you're behind
//   on meals. Pass `remaining` (1-3) to control the count in the copy.
// - kind='weight': the weight-log reminder body.

import { sendMail } from '../lib/mailer.js';

function bodyFor(kind, remaining) {
  if (kind === 'meal-log') {
    const n = Math.min(3, Math.max(1, Number(remaining) || 2));
    return {
      subject: 'Prep Day — log your meals',
      text:
        `You have ${n} meal${n > 1 ? 's' : ''} left to log today.\n\n` +
        `Log now: https://prep-day.com\n\n— Prep Day`,
    };
  }
  if (kind === 'weight') {
    return {
      subject: 'Prep Day — log your weight',
      text: `Don't forget to log your weight today.\n\nLog now: https://prep-day.com\n\n— Prep Day`,
    };
  }
  return {
    subject: 'Prep Day — test reminder',
    text:
      `This is a test reminder from Prep Day. If you got this, your reminder ` +
      `address is wired up correctly.\n\nOpen the app: https://prep-day.com\n\n— Prep Day`,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'GMAIL_USER / GMAIL_APP_PASSWORD not configured' });
  }

  const body = req.body || {};
  const raw = Array.isArray(body.emails) ? body.emails : (body.email ? [body.email] : []);
  const emails = raw
    .map(e => String(e || '').trim().toLowerCase())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  if (emails.length === 0) {
    return res.status(400).json({ error: 'No valid recipient emails provided' });
  }

  const { subject, text } = bodyFor(body.kind, body.remaining);

  try {
    await sendMail({ to: emails, subject, text });
    return res.status(200).json({ ok: true, sentTo: emails, kind: body.kind || 'test' });
  } catch (err) {
    console.error('send-test-reminder error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
