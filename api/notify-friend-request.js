// Vercel serverless function: sends email when a friend request is received

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const { toEmail, toName, fromUsername, message } = req.body || {};
  if (!toEmail) {
    return res.status(400).send('Missing recipient email');
  }

  const msgLine = message ? `\nMessage: "${message}"\n` : '';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Prep Day <onboarding@resend.dev>',
      to: toEmail,
      subject: `${fromUsername || 'Someone'} sent you a friend request on Prep Day`,
      text: `Hi${toName ? ` ${toName}` : ''}!\n\n@${fromUsername || 'A user'} sent you a friend request on Prep Day.\n${msgLine}\nLog in to accept or decline: https://prep-day.com\n\n— Prep Day`,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Resend error:', err);
    return res.status(500).send('Failed to send notification');
  }

  return res.status(200).send('Notification sent');
}
