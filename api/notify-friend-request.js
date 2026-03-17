// Vercel serverless function: sends email notifications (friend requests + shared recipes)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const { toEmail, toName, fromUsername, message, type, recipeName } = req.body || {};
  if (!toEmail) {
    return res.status(400).send('Missing recipient email');
  }

  let subject, text;

  if (type === 'shared-recipe') {
    subject = `${fromUsername || 'Someone'} shared a recipe with you on Prep Day`;
    text = `Hi${toName ? ` ${toName}` : ''}!\n\n@${fromUsername || 'A user'} shared a recipe with you on Prep Day: "${recipeName || 'Untitled'}"\n\nLog in to view and accept it: https://prep-day.com\n\n— Prep Day`;
  } else {
    const msgLine = message ? `\nMessage: "${message}"\n` : '';
    subject = `${fromUsername || 'Someone'} sent you a friend request on Prep Day`;
    text = `Hi${toName ? ` ${toName}` : ''}!\n\n@${fromUsername || 'A user'} sent you a friend request on Prep Day.\n${msgLine}\nLog in to accept or decline: https://prep-day.com\n\n— Prep Day`;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Prep Day <onboarding@resend.dev>',
      to: toEmail,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Resend error:', err);
    return res.status(500).send('Failed to send notification');
  }

  return res.status(200).send('Notification sent');
}
