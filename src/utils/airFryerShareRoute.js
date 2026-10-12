/**
 * Is this url the public air fryer link, and with what token?
 *
 * Returns null when it isn't the air fryer link, else the token ('' when the
 * url is the air fryer link but the token is unreadable).
 *
 * Forgiving on purpose. A link pasted from a chat or an email often drags a
 * character along — the `**` of bold text, a full stop, a `)` — and an exact
 * match then fell through to the LOGIN page, which reads as "this link needs
 * an account". So anything under /air-fryer/ is the public page; the token is
 * the leading run of letters and digits, and a bad one shows "this link has
 * expired" rather than a sign-in screen.
 */
export function airFryerShareRoute(pathname = '', search = '') {
  let path = String(pathname || '');
  try { path = decodeURIComponent(path); } catch { /* keep it raw */ }
  const m = path.match(/^\/air-fryer\/(.*)$/i);
  if (m) return (m[1].match(/^[A-Za-z0-9]{6,32}/) || [''])[0];
  const q = new URLSearchParams(search || '').get('airfryer');
  if (q != null) return (q.match(/^[A-Za-z0-9]{6,32}/) || [''])[0];
  return null;
}
