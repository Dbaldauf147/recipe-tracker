// Vercel serverless function: sends email notification on new signup via Resend

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const { email, name } = req.body || {};
  if (!email) {
    return res.status(400).send('Missing email');
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
      subject: `New Prep Day Signup: ${name || 'Unknown'}`,
      text: `New user signed up for Prep Day!\n\nName: ${name || 'N/A'}\nEmail: ${email}`,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Resend error:', err);
    return res.status(500).send('Failed to send notification');
  }

  return res.status(200).send('Notification sent');
}
