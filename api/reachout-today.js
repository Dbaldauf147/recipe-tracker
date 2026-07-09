// Proxies the "reached out today" count from Rally's Reach Out page into Prep
// Day's Habits KPI. Like rally-events.js / voting-events.js, the shared secret
// (RALLY_EXPORT_KEY) is attached server-side so it never reaches the browser.
// The caller passes its LOCAL day (?date=YYYY-MM-DD) so the count matches the
// user's today, not the serverless region's UTC day.
const RALLY_BASE_URL = process.env.RALLY_BASE_URL || 'https://rally-seven-theta.vercel.app';

export default async function handler(req, res) {
  const date = (req.query?.date || '').toString().trim();

  const key = (process.env.RALLY_EXPORT_KEY || '').trim();
  if (!key) {
    return res.status(200).json({ reachedTodayCount: null, reason: 'No RALLY_EXPORT_KEY configured' });
  }

  try {
    const params = new URLSearchParams({ key });
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
    const r = await fetch(`${RALLY_BASE_URL}/api/reachout-export?${params}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(200).json({ reachedTodayCount: null, reason: data.error || `Rally HTTP ${r.status}` });
    }
    return res.status(200).json({
      reachedTodayCount: typeof data.reachedTodayCount === 'number' ? data.reachedTodayCount : null,
      reachedFamilyToday: !!data.reachedFamilyToday,
      reachedFriendToday: !!data.reachedFriendToday,
      date: data.date || date,
    });
  } catch (err) {
    return res.status(200).json({ reachedTodayCount: null, reason: err.message });
  }
}
