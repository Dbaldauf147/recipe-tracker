// The panel under a bad habit when you click it: pick how far back to look
// ("last N days / weeks / months / years", or all time), then see the slips in
// that window as a trend chart — plus every day as a tappable grid while the
// window is short enough for that to be readable.
//
// The window is saved on the habit (`badRange`), so it's remembered next visit
// and the phone opens the same one. ⚠️ Mirrors the mobile BadHabitDetail in
// HabitsScreen.tsx; the maths for both lives in utils/badHabits.js /
// badHabitTrend.ts.
import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  BAD_HABIT_MARK, BAD_RANGE_PRESETS, BAD_GRID_MAX_DAYS, badHabitTrend, badRangeLabel,
  normalizeBadRange, dateOfDayKey, dayKeyOf,
} from '../utils/badHabits';

// Recharts colours must be literal hex — a CSS var doesn't resolve on an SVG attribute.
const BAR_RED = '#dc2626';
const GRID_LINE = '#e2e8f0';    // --color-border
const AXIS_TEXT = '#64748b';    // --color-text-muted

const UNIT_OPTIONS = ['days', 'weeks', 'months', 'years'];
const BUCKET_NOUN = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };
const FULL_BUCKET_DAYS = { week: 7, month: 28, year: 365 };

const chip = (on) => ({
  border: `1px solid ${on ? '#111' : 'var(--color-border, #e2e8f0)'}`,
  background: on ? '#111' : 'var(--color-surface, #fff)',
  color: on ? '#fff' : 'var(--color-text, #0f172a)',
  borderRadius: 999, padding: '0.25rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
});
const field = { padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid var(--color-border, #e2e8f0)', font: 'inherit', fontSize: '0.8rem' };
const subhead = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary, #475569)', marginBottom: 6 };

function Stat({ value, label }) {
  return (
    <div style={{ minWidth: 88 }}>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-text, #0f172a)' }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #64748b)' }}>{label}</div>
    </div>
  );
}

function TrendTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  const start = dateOfDayKey(b.key);
  const when = unit === 'day' && start
    ? start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : unit === 'week' ? `Week of ${b.label}` : b.label;
  const partial = unit !== 'day' && b.days < FULL_BUCKET_DAYS[unit];
  return (
    <div style={{ background: '#fff', border: `1px solid ${GRID_LINE}`, borderRadius: 8, padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}>
      <div style={{ fontWeight: 700 }}>{when}</div>
      <div>{b.count} {b.count === 1 ? 'time' : 'times'}{partial ? ` (${b.days} days in range)` : ''}</div>
    </div>
  );
}

export function BadHabitDetail({ habit, habitLog, todayKey, onCycleMark, onSaveRange }) {
  const [range, setRange] = useState(() => normalizeBadRange(habit.badRange));
  // The number box keeps its own text, so clearing it to type "12" doesn't snap to 1.
  const [nText, setNText] = useState(String(range.n));
  const trend = useMemo(
    () => badHabitTrend(habit.id, habitLog, range, dateOfDayKey(todayKey) || new Date()),
    [habit.id, habitLog, range, todayKey],
  );

  const apply = (next) => {
    const r = normalizeBadRange(next);
    setRange(r);
    if (r.unit !== 'all') setNText(String(r.n));
    onSaveRange(r);
  };

  const gridKeys = useMemo(() => {
    if (trend.spanDays > BAD_GRID_MAX_DAYS) return null;
    const start = dateOfDayKey(trend.startKey);
    return Array.from({ length: trend.spanDays }, (_, i) =>
      dayKeyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }, [trend.startKey, trend.spanDays]);
  const marked = (key) => (habitLog[key] || {})[habit.id] === BAD_HABIT_MARK;
  const startDate = dateOfDayKey(trend.startKey);

  return (
    <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid var(--color-border, #e2e8f0)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {BAD_RANGE_PRESETS.map(p => (
          <button key={p.label} type="button" style={chip(range.unit === p.unit && (p.unit === 'all' || range.n === p.n))} onClick={() => apply(p)}>
            {p.label}
          </button>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6, fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)' }}>
          Last
          <input
            type="number" min={1} max={999}
            value={range.unit === 'all' ? '' : nText}
            placeholder="N"
            aria-label="How many"
            onChange={e => {
              setNText(e.target.value);
              const n = Number(e.target.value);
              if (n >= 1) apply({ n, unit: range.unit === 'all' ? 'months' : range.unit });
            }}
            onBlur={() => setNText(String(range.n))}
            style={{ ...field, width: 58 }}
          />
          <select
            value={range.unit === 'all' ? '' : range.unit}
            aria-label="Unit"
            onChange={e => apply({ n: Number(nText) || range.n, unit: e.target.value })}
            style={field}
          >
            {range.unit === 'all' && <option value="" disabled>—</option>}
            {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </span>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)', marginBottom: '0.6rem' }}>
        <strong style={{ color: 'var(--color-text, #0f172a)' }}>{badRangeLabel(range)}</strong>
        {startDate && ` · ${startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} – today (${trend.spanDays} ${trend.spanDays === 1 ? 'day' : 'days'})`}
      </div>

      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        <Stat value={trend.total} label={trend.total === 1 ? 'time it happened' : 'times it happened'} />
        <Stat value={trend.cleanDays} label="clean days" />
        <Stat value={trend.longestClean} label="longest clean run" />
        <Stat value={trend.perWeek} label="per week, avg" />
      </div>

      <div style={subhead}>{BUCKET_NOUN[trend.unit]} trend</div>
      <div style={{ width: '100%', height: 190 }}>
        <ResponsiveContainer>
          <BarChart data={trend.buckets} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID_LINE} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_TEXT }} interval="preserveStartEnd" minTickGap={14} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS_TEXT }} width={40} />
            <Tooltip content={<TrendTooltip unit={trend.unit} />} cursor={{ fill: '#fee2e2' }} />
            <Bar dataKey="count" fill={BAR_RED} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {gridKeys && (
        <>
          <div style={{ ...subhead, marginTop: '0.8rem' }}>Every day — click to log or unlog</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {gridKeys.map((key, i) => {
              const on = marked(key);
              const d = dateOfDayKey(key);
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  title={`${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${on ? ' — logged' : ''}`}
                  onClick={() => onCycleMark(habit.id, key, on ? null : BAD_HABIT_MARK)}
                  style={{
                    width: 30, height: 34, borderRadius: 6, cursor: 'pointer', padding: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    border: isToday ? `2px solid ${on ? BAR_RED : '#94a3b8'}` : '1px solid var(--color-border, #e2e8f0)',
                    background: on ? BAR_RED : 'var(--color-surface, #fff)',
                    color: on ? '#fff' : 'var(--color-text-muted, #94a3b8)',
                    fontSize: '0.66rem', fontWeight: 700, lineHeight: 1.05,
                  }}
                >
                  {/* Month name on the 1st and the first cell, weekday letter otherwise. */}
                  <span style={{ fontSize: '0.52rem', fontWeight: 600, opacity: 0.85 }}>
                    {d.getDate() === 1 || i === 0
                      ? d.toLocaleDateString(undefined, { month: 'short' })
                      : ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()]}
                  </span>
                  <span>{d.getDate()}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
