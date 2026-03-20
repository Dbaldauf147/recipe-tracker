// Vercel serverless function: sends email/SMS notifications

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const { toEmail, toName, fromUsername, message, type, recipeName, toPhone, smsBody } = req.body || {};

  // SMS reminder
  if (type === 'sms-reminder' && toPhone) {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    if (!twilioSid || !twilioAuth || !twilioFrom) {
      // Fall back to email if Twilio not configured
      if (toEmail) {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'Prep Day <onboarding@resend.dev>',
            to: toEmail,
            subject: 'Prep Day Reminder',
            text: smsBody || 'Time to log your meals on Prep Day! https://prep-day.com',
          }),
        });
        return res.status(emailRes.ok ? 200 : 500).send(emailRes.ok ? 'Email reminder sent' : 'Failed');
      }
      return res.status(400).send('Twilio not configured and no email provided');
    }
    try {
      const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64'),
        },
        body: new URLSearchParams({ To: toPhone, From: twilioFrom, Body: smsBody || 'Time to log your meals on Prep Day! https://prep-day.com' }),
      });
      return res.status(twilioRes.ok ? 200 : 500).send(twilioRes.ok ? 'SMS sent' : 'SMS failed');
    } catch (err) {
      return res.status(500).send('SMS error: ' + err.message);
    }
  }

  if (!toEmail) {
    return res.status(400).send('Missing recipient email');
  }

  let subject, text;

  if (type === 'friend-accepted') {
    subject = `${fromUsername || 'Someone'} accepted your friend request on Prep Day`;
    text = `Hi${toName ? ` ${toName}` : ''}!\n\n@${fromUsername || 'A user'} accepted your friend request on Prep Day. You're now friends!\n\nLog in to share recipes and more: https://prep-day.com\n\n— Prep Day`;
  } else if (type === 'shared-recipe') {
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
