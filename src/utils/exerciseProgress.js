// Analyzes logged workouts to classify each exercise's recent progress into
// Progressing / Stagnating / No-Baseline, mirroring the "stagnation" logic:
// track estimated 1RM (Epley) on the top set and training volume (weight × reps),
// then compare a recent window against an earlier baseline. Pure logic (no React)
// so it stays testable and reusable; consumed by ExerciseProgressTracker.jsx.
//
// Set/weight model (from WorkoutPage): each entry has `sets` (array of rep/time
// strings), a canonical-lb `weight` (or per-set `setWeights` when `useSetWeights`),
// and `perArm` (weight is per side → double it for the total load).

import { parseSetValue } from './setValue';

const LB_PER_KG = 2.2046226218;
export const WINDOW_DAYS = 60;          // "past 2 months"
export const MIN_SESSIONS = 3;          // fewer than this → no baseline to judge
const PROGRESS_PCT = 0.025;             // +2.5% on the primary metric = progressing
const VOLUME_PCT = 0.05;                // …or +5% training volume rescues it

// Canonical-lb value → the user's display unit, rounded to 0.1.
export function displayWeight(lb, unit) {
  const n = typeof lb === 'number' ? lb : parseFloat(lb);
  if (isNaN(n)) return null;
  const v = unit === 'kg' ? n / LB_PER_KG : n;
  return Math.round(v * 10) / 10;
}

// YYYY-MM-DD for `days` before today (local midnight), for windowing by date key.
function cutoffKey(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Total lb moved for set `i` of an entry (per-set weight if present, ×2 per-arm).
function setWeightLb(entry, i) {
  let w;
  if (entry.useSetWeights && Array.isArray(entry.setWeights)) {
    w = parseFloat(entry.setWeights[i] || '');
    if (isNaN(w)) w = parseFloat(entry.weight || '');
  } else {
    w = parseFloat(entry.weight || '');
  }
  if (isNaN(w)) w = 0;
  return entry.perArm ? w * 2 : w;
}

// Reduce one logged entry to a session sample: best estimated 1RM, total volume,
// and the bodyweight fallbacks (max reps / max hold seconds).
function entrySample(entry) {
  const sets = Array.isArray(entry.sets) ? entry.sets : [];
  let bestE1rm = 0, volume = 0, maxReps = 0, maxSeconds = 0, hasWeight = false;
  for (let i = 0; i < sets.length; i++) {
    const parsed = parseSetValue(sets[i]);
    if (parsed.kind === 'reps' && parsed.reps > 0) {
      if (parsed.reps > maxReps) maxReps = parsed.reps;
      const w = setWeightLb(entry, i);
      if (w > 0) {
        hasWeight = true;
        const e1 = w * (1 + parsed.reps / 30); // Epley estimated 1RM
        if (e1 > bestE1rm) bestE1rm = e1;
        volume += w * parsed.reps;
      }
    } else if (parsed.kind === 'time' && parsed.seconds > 0) {
      if (parsed.seconds > maxSeconds) maxSeconds = parsed.seconds;
    }
  }
  return { bestE1rm, volume, maxReps, maxSeconds, hasWeight };
}

const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;

// Analyze one exercise's history (entries carry a `.date`). Returns a result
// object or null when there's no usable data in the window.
function analyzeExercise(name, group, history) {
  const cutoff = cutoffKey(WINDOW_DAYS);
  // One combined sample per date (a date can hold multiple logged entries).
  const byDate = new Map();
  for (const e of history) {
    if (!e.date || e.date < cutoff) continue;
    const s = entrySample(e);
    const prev = byDate.get(e.date);
    byDate.set(e.date, prev ? {
      bestE1rm: Math.max(prev.bestE1rm, s.bestE1rm),
      volume: prev.volume + s.volume,
      maxReps: Math.max(prev.maxReps, s.maxReps),
      maxSeconds: Math.max(prev.maxSeconds, s.maxSeconds),
      hasWeight: prev.hasWeight || s.hasWeight,
    } : s);
  }
  const dates = [...byDate.keys()].sort();
  const samples = dates.map(d => byDate.get(d));
  if (samples.length === 0) return null;

  // Primary metric preference: weighted est-1RM > bodyweight reps > hold time.
  const metric = samples.some(s => s.hasWeight) ? 'e1rm'
    : samples.some(s => s.maxReps > 0) ? 'reps'
      : 'time';
  const primary = (s) => metric === 'e1rm' ? s.bestE1rm : metric === 'reps' ? s.maxReps : s.maxSeconds;
  const series = samples.map((s, i) => ({ date: dates[i], value: primary(s), volume: s.volume }));

  const n = series.length;
  const best = Math.max(...series.map(p => p.value));
  if (best <= 0) return null; // nothing measurable (e.g. all-empty sets)
  const last = series[n - 1].value;

  const baseResult = { name, group, metric, sessions: n, series, best, last };

  if (n < MIN_SESSIONS) {
    return { ...baseResult, status: 'nobaseline', baseline: null, recent: last, delta: null, deltaPct: null, volDeltaPct: null, declining: false };
  }

  const mid = Math.floor(n / 2);
  const early = series.slice(0, mid);
  const late = series.slice(mid);
  const baseline = mean(early.map(p => p.value));
  const recent = mean(late.map(p => p.value));
  const delta = recent - baseline;
  const deltaPct = baseline > 0 ? delta / baseline : null;

  let volDeltaPct = null;
  if (metric === 'e1rm') {
    const vB = mean(early.map(p => p.volume));
    const vR = mean(late.map(p => p.volume));
    if (vB > 0) volDeltaPct = (vR - vB) / vB;
  }

  const improved = (deltaPct != null && deltaPct >= PROGRESS_PCT)
    || (volDeltaPct != null && volDeltaPct >= VOLUME_PCT);
  const declining = deltaPct != null && deltaPct <= -PROGRESS_PCT;
  // Progressing (added stimulus) > Decreasing (1RM clearly down, no volume
  // rescue) > Stagnating (flat, neither up nor down enough to matter).
  const status = improved ? 'progressing' : declining ? 'decreasing' : 'stagnating';

  return { ...baseResult, status, baseline, recent, delta, deltaPct, volDeltaPct, declining };
}

// workouts: array of { date, entries:[{ exercise, group, sets, weight, ... }] }.
// groupByName: optional Map(lowercased exercise name → muscle group) for labels.
// Returns { progressing:[], stagnating:[], nobaseline:[] }, each sorted.
export function analyzeProgress(workouts, groupByName) {
  const byName = {};
  for (const w of (workouts || [])) {
    for (const e of (w.entries || [])) {
      if (!e.exercise) continue;
      const key = e.exercise.trim().toLowerCase();
      if (!byName[key]) byName[key] = { name: e.exercise.trim(), group: e.group || '', entries: [] };
      if (!byName[key].group && e.group) byName[key].group = e.group;
      byName[key].entries.push({ ...e, date: w.date });
    }
  }
  const groups = { progressing: [], decreasing: [], stagnating: [], nobaseline: [] };
  for (const key of Object.keys(byName)) {
    const g = (groupByName && groupByName.get(key)) || byName[key].group || '';
    const r = analyzeExercise(byName[key].name, g, byName[key].entries);
    if (r) groups[r.status].push(r);
  }
  groups.progressing.sort((a, b) => (b.deltaPct || 0) - (a.deltaPct || 0)); // best gain first
  groups.decreasing.sort((a, b) => (a.deltaPct || 0) - (b.deltaPct || 0));  // steepest drop first
  groups.stagnating.sort((a, b) => (a.deltaPct || 0) - (b.deltaPct || 0));
  groups.nobaseline.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  return groups;
}
