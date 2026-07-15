// Redirects user to Google OAuth for Calendar access
export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  // Normalize to the canonical (non-www) host so redirect_uri always matches the
  // one registered in Google Cloud Console, whether on prep-day.com or www.*.
  const host = (req.headers.host || '').replace(/^www\./, '');
  const redirectUri = `${req.headers['x-forwarded-proto'] || 'https'}://${host}/api/google-callback`;
  // `calendar` (full read/write) is needed to CREATE the "Prep Day Workouts"
  // calendar; it also covers reading events and calendars, so it supersedes the
  // old readonly+events scopes.
  const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
  res.redirect(302, url);
}
