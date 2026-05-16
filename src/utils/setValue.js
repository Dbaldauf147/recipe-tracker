// Parse a set cell's text into either a rep count or a duration (seconds).
//
// Accepted formats:
//   "12"      → 12 reps
//   "30s"     → 30 seconds
//   "2m"      → 120 seconds
//   "1h"      → 3600 seconds
//   "1:30"    → 90 seconds (m:ss)
//   "1:00:30" → 3630 seconds (h:mm:ss)
//   "1.5m"    → 90 seconds
//   ""        → empty
//
// Anything else returns kind 'invalid' so callers can leave the raw text
// alone in the cell without contributing to derived stats.
//
// Mirror of PrepDay/src/utils/setValue.ts — keep both in sync.

const TIME_SUFFIX = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs)$/i;
const COLON_TIME = /^(\d+)(?::(\d+))(?::(\d+))?$/;
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;

export function parseSetValue(raw) {
  if (raw == null) return { kind: 'empty' };
  const s = String(raw).trim();
  if (!s) return { kind: 'empty' };

  const suffix = s.match(TIME_SUFFIX);
  if (suffix) {
    const n = parseFloat(suffix[1]);
    if (!isNaN(n)) {
      const unit = suffix[2].toLowerCase();
      const seconds =
        unit.startsWith('h') ? n * 3600 :
        unit.startsWith('m') ? n * 60 :
        n;
      return { kind: 'time', seconds: Math.round(seconds) };
    }
  }

  const colon = s.match(COLON_TIME);
  if (colon) {
    const a = parseInt(colon[1], 10);
    const b = parseInt(colon[2], 10);
    const c = colon[3] != null ? parseInt(colon[3], 10) : null;
    if (!isNaN(a) && !isNaN(b) && (c == null || !isNaN(c))) {
      const seconds = c != null
        ? a * 3600 + b * 60 + c
        : a * 60 + b;
      return { kind: 'time', seconds };
    }
  }

  if (PLAIN_NUMBER.test(s)) {
    const n = parseFloat(s);
    if (!isNaN(n)) return { kind: 'reps', reps: n };
  }

  return { kind: 'invalid' };
}

export function formatSeconds(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function computeSetStats(sets) {
  let totalReps = 0;
  let maxReps = 0;
  let repCount = 0;
  let totalSeconds = 0;
  let maxSeconds = 0;
  let timeCount = 0;
  for (const raw of sets || []) {
    const p = parseSetValue(raw);
    if (p.kind === 'reps') {
      totalReps += p.reps;
      if (p.reps > maxReps) maxReps = p.reps;
      repCount++;
    } else if (p.kind === 'time') {
      totalSeconds += p.seconds;
      if (p.seconds > maxSeconds) maxSeconds = p.seconds;
      timeCount++;
    }
  }
  const avgReps = repCount > 0 ? parseFloat((totalReps / repCount).toFixed(1)) : 0;
  return { repCount, totalReps, maxReps, avgReps, timeCount, totalSeconds, maxSeconds };
}
