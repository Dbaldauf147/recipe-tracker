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

/**
 * Wrap a body fragment in a real mobile-friendly HTML document.
 *
 * Every mail this app builds is a bare `<div>`. Handed a fragment with no
 * <head>, a phone mail client has no viewport to lay out against, so it falls
 * back to a desktop-width canvas (~980px), renders the mail there, and then
 * zooms the whole message out to fit the screen. Nothing is clipped — it is
 * all just scaled down by about a third, which is why the weekly summary's
 * charts arrive legible on a laptop and skinny and unreadable on a phone.
 * `width=device-width` is what stops that: lay the mail out at the width it
 * will actually be read at, and 13px text stays 13px.
 *
 * The two Apple metas are the same fight on iOS: Mail re-flows and auto-scales
 * a message it thinks is too wide unless told not to. And the palette is
 * declared light-only because every colour in these mails is a hardcoded light
 * hex — left to guess, a dark-mode client inverts the backgrounds but not the
 * chart bars drawn as background colours, and the result is worse than either.
 */
function asDocument(html) {
  // Several senders are text-only (notify-signup, send-test-reminder). Wrapping
  // nothing would hand them an EMPTY html part, which every client prefers over
  // the text part — a blank email. No body in, no body out.
  if (!html) return html;
  const body = String(html);
  if (/^\s*(<!doctype|<html)/i.test(body)) return body;
  return '<!doctype html><html lang="en"><head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="x-apple-disable-message-reformatting">'
    + '<meta name="color-scheme" content="light only">'
    + '<meta name="supported-color-schemes" content="light only">'
    + '<style>img{max-width:100%;height:auto;}table{max-width:100%;}</style>'
    + '</head>'
    + '<body style="margin:0;padding:16px;background:#ffffff;color-scheme:light only;">'
    + body
    + '</body></html>';
}

export async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  const from = `Prep Day <${gmailUser()}>`;
  await t.sendMail({ from, to, subject, text, html: asDocument(html) });
}
