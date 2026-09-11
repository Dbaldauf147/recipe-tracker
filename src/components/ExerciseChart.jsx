// A single exercise's progress chart (Avg reps + top Weight over time),
// mirroring the Workout Charts page visual. Self-contained: builds its own
// series from raw logged sets so it doesn't depend on entry enrichment.
// Used by the Progress page's click-to-view popup.
//
// Sessions somewhere else (see offsiteMarker) are drawn in amber and left out
// of the trend line: on the record, visibly different, not counted.
import React, { useMemo } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { parseSetValue } from '../utils/setValue';
import { displayWeight, offsiteMarker } from '../utils/exerciseProgress';

const LEFT = '#dc2626';   // reps
const RIGHT = '#3B6B9C';  // weight
const AWAY = '#d97706';   // a session somewhere else
const AWAY_BAND = '#fde68a';

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

// One point per session date: average reps + heaviest set (in the display unit).
// `homeGym` (the Progress page's "<gym> only" switch) also marks sessions at any
// other gym, so the amber points are exactly the ones its verdict left out.
function buildSeries(workouts, exercise, unit, homeGym) {
  const key = (exercise || '').trim().toLowerCase();
  // Where this lift was done over its WHOLE history: a one-off is judged
  // against all of it, not just the sessions that get charted.
  const located = [];
  for (const w of (workouts || [])) {
    if (w?.date && (w.entries || []).some(e => (e.exercise || '').trim().toLowerCase() === key)) {
      located.push({ date: w.date, gym: w.gym });
    }
  }
  const offsiteOf = offsiteMarker(located, homeGym || null);

  const byDate = new Map();
  for (const w of (workouts || [])) {
    const away = offsiteOf(w.gym);
    for (const e of (w.entries || [])) {
      if ((e.exercise || '').trim().toLowerCase() !== key) continue;
      const sets = Array.isArray(e.sets) ? e.sets : [];
      let repSum = 0, repCount = 0, maxReps = 0, topLb = 0;
      for (let i = 0; i < sets.length; i++) {
        const p = parseSetValue(sets[i]);
        if (p.kind === 'reps' && p.reps > 0) {
          repSum += p.reps; repCount++;
          if (p.reps > maxReps) maxReps = p.reps;
          const wl = setWeightLb(e, i);
          if (wl > topLb) topLb = wl;
        }
      }
      if (repCount === 0 && topLb === 0) continue;
      const entryAvg = repCount ? repSum / repCount : 0;
      const prev = byDate.get(w.date);
      if (!prev) byDate.set(w.date, { avgSum: entryAvg, avgN: 1, maxReps, topLb, away, home: !away });
      else {
        prev.avgSum += entryAvg; prev.avgN += 1;
        prev.maxReps = Math.max(prev.maxReps, maxReps);
        prev.topLb = Math.max(prev.topLb, topLb);
        if (away) { if (!prev.away) prev.away = away; } else prev.home = true;
      }
    }
  }
  return [...byDate.keys()].sort().map(date => {
    const b = byDate.get(date);
    return {
      date,
      avgReps: Math.round((b.avgSum / b.avgN) * 10) / 10,
      maxReps: b.maxReps,
      weight: displayWeight(b.topLb, unit) || 0,
      // Home and away on one date: the home session is real, so no mark.
      offsite: !b.home && b.away ? b.away : undefined,
    };
  });
}

// Least-squares trend on the weight series. Away sessions keep their x
// position but stay out of the fit.
function withTrend(data) {
  if (data.length < 2) return data;
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i].offsite) continue;
    const y = data[i].weight;
    n++; sx += i; sy += y; sxy += i * y; sxx += i * i;
  }
  if (n < 2) return data;
  const denom = n * sxx - sx * sx;
  if (denom === 0) return data;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return data.map((d, i) => ({ ...d, trend: Math.round((intercept + slope * i) * 10) / 10 }));
}

// Ringed amber marker on an away session; nothing on a normal one.
function awayDot(p) {
  const k = `${p.dataKey}-${p.index}`;
  if (!p.payload?.offsite || p.cx == null || p.cy == null) return <g key={k} />;
  return <circle key={k} cx={p.cx} cy={p.cy} r={4.5} fill="#fff" stroke={AWAY} strokeWidth={2} />;
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  if (!y) return d;
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ExerciseChart({ workouts = [], exercise, weightUnit = 'lb', height = 300, homeGym = null }) {
  const data = useMemo(
    () => buildSeries(workouts, exercise, weightUnit, homeGym),
    [workouts, exercise, weightUnit, homeGym],
  );

  if (data.length === 0) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)' }}>No logged sessions for {exercise}.</div>;
  }
  if (data.length < 2) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)' }}>Only one session logged for {exercise} — need 2+ to draw a trend.</div>;
  }

  const dataT = withTrend(data);
  const years = [...new Set(data.map(p => p.date.slice(0, 4)))];
  const multiYear = years.length > 1;
  const awayNames = [...new Set(data.filter(d => d.offsite).map(d => d.offsite))];

  return (
    <div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dataT} margin={{ top: 12, right: 40, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            {/* Amber column behind each away session. */}
            {data.map((d, i) => d.offsite ? (
              <ReferenceLine key={`away-${i}`} yAxisId="left" x={d.date} stroke={AWAY_BAND} strokeWidth={14} strokeOpacity={0.8} />
            ) : null)}
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickFormatter={d => {
                if (!d) return '';
                const [y, m, dd] = d.split('-');
                return multiYear ? `'${y.slice(2)}` : `${parseInt(m)}/${parseInt(dd)}`;
              }}
              minTickGap={28}
              height={24}
            />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: LEFT }} axisLine={false} tickLine={false} width={34} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: RIGHT }} axisLine={false} tickLine={false} width={40} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.82rem', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 2, color: '#111' }}>{fmtDate(label)}</div>
                  <div style={{ color: LEFT }}>Avg reps: {d.avgReps}</div>
                  <div style={{ color: RIGHT }}>Top weight: {d.weight} {weightUnit}</div>
                  {d.offsite && <div style={{ color: '#b45309', fontWeight: 600, marginTop: 2 }}>At {d.offsite}, not in the trend</div>}
                </div>
              );
            }} />
            <Area yAxisId="left" type="stepAfter" dataKey="avgReps" stroke={LEFT} strokeWidth={2} fill="#fca5a5" fillOpacity={0.4} dot={awayDot} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Area yAxisId="right" type="stepAfter" dataKey="weight" stroke={RIGHT} strokeWidth={2} fill="#bfdbfe" fillOpacity={0.4} dot={awayDot} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line yAxisId="right" type="linear" dataKey="trend" stroke={RIGHT} strokeWidth={1.25} strokeOpacity={0.6} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.25rem', justifyContent: 'center', marginTop: '0.5rem', fontSize: '0.82rem' }}>
        <span style={{ color: 'var(--color-text-muted, #64748b)' }}>{data.length} sessions</span>
        <span style={{ color: LEFT }}>● Avg reps</span>
        <span style={{ color: RIGHT }}>● Weight ({weightUnit})</span>
        {awayNames.length > 0 && (
          <span style={{ color: '#b45309' }} title="Sessions at a different location use different equipment, so they're shown but left out of the trend.">
            <span style={{ display: 'inline-block', width: 9, height: 9, background: AWAY_BAND, border: `1.5px solid ${AWAY}`, borderRadius: 2, marginRight: 4, verticalAlign: '-1px' }} />
            {awayNames.join(', ')} · not in the trend
          </span>
        )}
      </div>
    </div>
  );
}
