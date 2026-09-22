// GET /api/whoop/backfill?uid=<uid>&t=<firebaseIdToken>&before=<ISO>
//
// Walks BACKWARD through the account's Whoop history in fixed chunks and
// merges each one into users/{uid}/data/whoopDaily.
//
// api/whoop/data.js only ever asks Whoop for a trailing window, so the nights
// you wore the band before you connected the account here were never fetched.
// This is the one-time job that goes and gets them.
//
// It is RESUMABLE rather than one long request, because a serverless function
// can't sit there for the minutes a multi-year walk takes: each call does at
// most CHUNKS_PER_CALL chunks and returns `nextBefore`, which the client feeds
// back in until `done`. Stopping is by exhaustion — once EMPTY_CHUNKS_TO_STOP
// consecutive chunks come back with no records we've walked off the start of
// the account. Whoop exposes no "account created" date, so a run of empty
// chunks is the only signal available; the threshold is deliberately wider
// than any plausible not-wearing-it gap.

import {
  verifyCaller,
  getValidAccessToken,
  fetchWhoopRange,
  mergeWhoopDaily,
  httpError,
} from '../../lib/whoop.js';

const CHUNK_DAYS = 60;
// 240 days per request. Kept modest on purpose: each chunk is three paged
// endpoint walks, and Whoop rate-limits at 100 requests/minute per user.
const CHUNKS_PER_CALL = 4;
const EMPTY_CHUNKS_TO_STOP = 3;     // 180 days of nothing = off the end
const FLOOR_ISO = '2014-01-01T00:00:00.000Z'; // predates any Whoop account

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  try {
    const uid = await verifyCaller(req);

    const accessToken = await getValidAccessToken(uid);
    if (!accessToken) {
      return res.status(200).json({ connected: false });
    }

    // Where this call starts walking back from. Absent (the first call) means
    // "from now"; the client echoes back whatever we returned last time.
    const beforeParam = req.query.before;
    let cursor = beforeParam ? new Date(beforeParam) : new Date();
    if (isNaN(cursor)) throw httpError(400, 'Invalid `before` timestamp');

    const floor = new Date(FLOOR_ISO);
    let emptyStreak = Math.max(0, parseInt(req.query.empty, 10) || 0);
    let fetched = 0;
    let done = false;
    const collected = {};

    for (let i = 0; i < CHUNKS_PER_CALL; i++) {
      const end = cursor;
      const start = new Date(Math.max(floor.getTime(), end.getTime() - CHUNK_DAYS * DAY_MS));

      const chunk = await fetchWhoopRange(
        accessToken,
        start.toISOString(),
        end.toISOString(),
        { includeWorkouts: false },
      );

      const dates = Object.keys(chunk.daily);
      fetched += dates.length;
      Object.assign(collected, chunk.daily);

      emptyStreak = dates.length === 0 ? emptyStreak + 1 : 0;
      cursor = start;

      if (emptyStreak >= EMPTY_CHUNKS_TO_STOP || start.getTime() <= floor.getTime()) {
        done = true;
        break;
      }
    }

    // Write once per call rather than once per chunk — mergeWhoopDaily reads
    // both documents back, so per-chunk writes would be several times the reads
    // for the same result. Called even on an empty call, because the caller
    // wants the resulting totals either way.
    const { dates, full } = await mergeWhoopDaily(uid, collected);

    // A full history doc means older nights are being dropped as fast as we
    // add them; keep walking and it would just churn.
    if (full) done = true;

    return res.status(200).json({
      connected: true,
      done,
      full,
      added: fetched,
      nextBefore: done ? null : cursor.toISOString(),
      empty: emptyStreak,
      totalDays: dates.length,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Whoop backfill failed' });
  }
}
