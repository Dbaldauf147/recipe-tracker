// Proxies a date range of the user's Rally Voting Calendar (civic election dates)
// into Prep Day's Week Plan. Like rally-events.js, the call to Rally happens
// server-side so the shared secret (RALLY_EXPORT_KEY) never reaches the browser.
// Returns { eventsByDay: { 'YYYY-MM-DD': [{ id, title, type, icon, color }] } }.
const RALLY_BASE_URL = process.env.RALLY_BASE_URL || 'https://rally-seven-theta.vercel.app';

export default async function handler(req, res) {
  const start = (req.query?.start || '').toString().trim();
  const end = (req.query?.end || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) are required', eventsByDay: {} });
  }

  const key = (process.env.RALLY_EXPORT_KEY || '').trim();
  if (!key) {
    return res.status(200).json({ eventsByDay: {}, reason: 'No RALLY_EXPORT_KEY configured' });
  }

  try {
    const params = new URLSearchParams({ key, start, end });
    const r = await fetch(`${RALLY_BASE_URL}/api/voting-export?${params}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(200).json({ eventsByDay: {}, reason: data.error || `Rally HTTP ${r.status}` });
    }
    return res.status(200).json({ eventsByDay: data.eventsByDay || {} });
  } catch (err) {
    return res.status(200).json({ eventsByDay: {}, reason: err.message });
  }
}
