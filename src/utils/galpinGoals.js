// ---- Dr. Galpin's goals (Workout → Charts overlay) -------------------------
//
// A goal line per chart: each week, beat your best from the last week you
// trained by +3% on weight, or +10% on volume, compounded across skipped weeks
// (same rule the Weekly Overload tab judges with). Weeks are Sun–Sat. A gap
// of more than MAX_GAP_WEEKS is a fresh start, not a 1.03^20 target.
// Deload and away sessions (`offsite`) never set the baseline.

export const GALPIN_WEIGHT_PCT = 0.03;
export const GALPIN_VOLUME_PCT = 0.10;
export const MAX_GAP_WEEKS = 4;

/** Which goal applies to a Charts metric field, or null for none. */
export function galpinRateFor(field) {
  if (field === 'totalWeight' || field === 'maxWeight' || field === 'e1rm') return GALPIN_WEIGHT_PCT;
  if (field === 'totalReps') return GALPIN_VOLUME_PCT;
  return null;
}

/** Whole weeks since an arbitrary Sunday for a 'YYYY-MM-DD' date (Sun–Sat weeks). */
export function weekNumber(dateKey) {
  const [y, m, d] = String(dateKey || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const days = Math.round(Date.UTC(y, m - 1, d) / 86400000); // day 0 = Thu 1970-01-01
  return Math.floor((days + 4) / 7); // +4 shifts so weeks start on Sunday
}

/**
 * `data` (oldest first, each with `date`) with `outKey` set to that point's
 * goal: the best `field` from the latest earlier trained week × (1+rate)^gap.
 * Points with no earlier week (or past the gap cap) get no goal.
 */
export function withGalpinGoal(data, field, rate, outKey) {
  if (!Array.isArray(data) || rate == null) return data;
  const best = new Map();
  for (const p of data) {
    const v = Number(p?.[field]) || 0;
    const w = weekNumber(p?.date);
    if (p?.offsite || v <= 0 || w == null) continue;
    if (!best.has(w) || v > best.get(w)) best.set(w, v);
  }
  const weeks = [...best.keys()].sort((a, b) => a - b);
  return data.map(p => {
    const w = weekNumber(p?.date);
    let prev = null;
    for (const x of weeks) { if (x < w) prev = x; else break; }
    if (w == null || prev == null || w - prev > MAX_GAP_WEEKS) return { ...p, [outKey]: undefined };
    const goal = best.get(prev) * Math.pow(1 + rate, w - prev);
    return { ...p, [outKey]: Math.round(goal * 10) / 10 };
  });
}
