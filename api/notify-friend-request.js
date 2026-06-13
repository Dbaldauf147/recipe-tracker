// Vercel serverless function: sends email (Gmail SMTP) or SMS (Twilio) notifications

import { sendMail } from '../lib/mailer.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const { toEmail, toName, fromUsername, message, type, recipeName, mealName, toPhone, smsBody } = req.body || {};

  // Reminder (meal/weight). MUST be fully handled here so it can never fall
  // through to the friend-request template below: the website's reminder caller
  // sends type:'sms-reminder' with an email but NO toPhone, and gating this on
  // `&& toPhone` previously skipped the whole block, mis-routing every reminder
  // into a bogus "@A user sent you a friend request" email. Send as SMS only
  // when a phone number AND Twilio are configured; otherwise send by email.
  if (type === 'sms-reminder') {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    const canSendSms = toPhone && twilioSid && twilioAuth && twilioFrom;
    if (!canSendSms) {
      // No phone number (or Twilio not configured) → send the reminder by email.
      if (toEmail) {
        try {
          await sendMail({
            to: toEmail,
            subject: 'Prep Day Reminder',
            text: smsBody || 'Time to log your meals on Prep Day! https://prep-day.com',
          });
          return res.status(200).send('Email reminder sent');
        } catch (err) {
          console.error('notify-friend-request reminder email error:', err);
          return res.status(500).send('Failed');
        }
      }
      return res.status(400).send('No phone number or email to send the reminder to');
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
  } else if (type === 'shared-meal') {
    subject = `${fromUsername || 'Someone'} shared a meal with you on Prep Day`;
    text = `Hi${toName ? ` ${toName}` : ''}!\n\n@${fromUsername || 'A user'} shared a meal with you on Prep Day: "${mealName || 'Untitled meal'}"\n\nLog in to add it to your daily log: https://prep-day.com\n\n— Prep Day`;
  } else {
    const msgLine = message ? `\nMessage: "${message}"\n` : '';
    subject = `${fromUsername || 'Someone'} sent you a friend request on Prep Day`;
    text = `Hi${toName ? ` ${toName}` : ''}!\n\n@${fromUsername || 'A user'} sent you a friend request on Prep Day.\n${msgLine}\nLog in to accept or decline: https://prep-day.com\n\n— Prep Day`;
  }

  try {
    await sendMail({ to: toEmail, subject, text });
  } catch (err) {
    console.error('notify-friend-request error:', err);
    return res.status(500).send('Failed to send notification');
  }

  return res.status(200).send('Notification sent');
}
