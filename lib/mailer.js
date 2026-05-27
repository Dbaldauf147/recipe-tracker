import nodemailer from 'nodemailer';

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not configured');
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  const from = `Prep Day <${process.env.GMAIL_USER}>`;
  await t.sendMail({ from, to, subject, text, html });
}
