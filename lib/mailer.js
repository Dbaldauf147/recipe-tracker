import nodemailer from 'nodemailer';

// Credentials arrive from the environment, where a trailing newline is easy to
// introduce (pasting into a dashboard field, `echo` without -n, a here-doc) and
// impossible to see afterwards. Gmail rejects the login as
// "535-5.7.8 Username and Password not accepted", which reads exactly like a
// revoked app password — so the stray byte costs an hour of chasing the wrong
// thing. Neither a Google app password nor an address can legitimately carry
// surrounding whitespace, so both are trimmed at the point of use.
//
// The address is also interpolated into the From header, where an embedded
// newline is header injection rather than merely a bad login.
const gmailUser = () => (process.env.GMAIL_USER || '').trim();
const gmailPass = () => (process.env.GMAIL_APP_PASSWORD || '').trim();

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  const user = gmailUser();
  const pass = gmailPass();
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
  const from = `Prep Day <${gmailUser()}>`;
  await t.sendMail({ from, to, subject, text, html });
}
