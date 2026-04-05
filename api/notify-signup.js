// Vercel serverless function: sends admin notifications via Resend
// Handles both new signups and user-reported issues

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

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Prep Day <onboarding@resend.dev>',
        to: 'baldaufdan@gmail.com',
        subject: `Prep Day Issue Report`,
        text: `A user reported an issue on Prep Day.\n\nPage: ${page || 'Unknown'}\nUser: ${userName || 'Anonymous'}${userEmail ? ` (${userEmail})` : ''}\n\nMessage:\n${message.trim()}`,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
      return res.status(500).send('Failed to send report');
    }

    return res.status(200).send('Report sent');
  }

  // Default: signup notification
  const { email, name } = req.body || {};
  if (!email) {
    return res.status(400).send('Missing email');
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'Prep Day <onboarding@resend.dev>',
      to: 'baldaufdan@gmail.com',
      subject: `New Prep Day Signup: ${name || 'Unknown'}`,
      text: `New user signed up for Prep Day!\n\nName: ${name || 'N/A'}\nEmail: ${email}\nTime: ${new Date().toISOString()}`,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Resend error:', err);
    return res.status(500).json({ error: err });
  }

  return res.status(200).send('Notification sent');
}
