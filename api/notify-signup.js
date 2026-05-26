// Vercel serverless function: sends admin notifications via Gmail SMTP.
// Handles both new signups and user-reported issues.

import { sendMail } from '../lib/mailer.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const { type } = req.body || {};

  if (type === 'issue') {
    const { message, page, userEmail, userName } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).send('Missing message');
    }

    try {
      await sendMail({
        to: 'baldaufdan@gmail.com',
        subject: 'Prep Day Issue Report',
        text: `A user reported an issue on Prep Day.\n\nPage: ${page || 'Unknown'}\nUser: ${userName || 'Anonymous'}${userEmail ? ` (${userEmail})` : ''}\n\nMessage:\n${message.trim()}`,
      });
    } catch (err) {
      console.error('notify-signup issue error:', err);
      return res.status(500).send('Failed to send report');
    }
    return res.status(200).send('Report sent');
  }

  // Default: signup notification
  const { email, name } = req.body || {};
  if (!email) {
    return res.status(400).send('Missing email');
  }

  try {
    await sendMail({
      to: 'baldaufdan@gmail.com',
      subject: `New Prep Day Signup: ${name || 'Unknown'}`,
      text: `New user signed up for Prep Day!\n\nName: ${name || 'N/A'}\nEmail: ${email}\nTime: ${new Date().toISOString()}`,
    });
  } catch (err) {
    console.error('notify-signup error:', err);
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).send('Notification sent');
}
