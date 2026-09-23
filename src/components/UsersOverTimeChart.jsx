import { useMemo, useRef, useState } from 'react';
import { summarizeUserGrowth, shortDate, monthYear } from '../../lib/adminGrowth.js';

// Same two hues the weekly summary email's growth chart uses, validated as a
// pair for colour-vision deficiency against a light surface. Keep them in step
// with SERIES_COLORS in lib/weeklySummary.js — the email and this chart are the
// same chart in two media, and a reader who sees both should not have to
// re-learn which line is which.
const GROWTH_COLORS = { total: '#c96442', active: '#2563eb' };

/**
 * Axis ticks that land on round numbers, and the top of the scale with them.
 *
 * Whole numbers only — both series are counts of people, and an axis offering
 * "7.5 users" invites the reader to interpolate a value that cannot exist.
 */
function niceTicks(max, count = 4) {
  const raw = Math.max(max, 1) / count;
  const mag = Math.max(1, 10 ** Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
  const ticks = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return { ticks, top: ticks[ticks.length - 1] || 1 };
}

/**
 * Total users over time, with the active slice drawn on the same axis.
 *
 * ONE axis for both lines on purpose: they count the same thing, so the gap
 * between the lines IS the share of the user base that showed up that week.
 * Give "active" its own scale and that gap becomes decorative — the classic
 * dual-axis lie.
 *
 * The series come from lib/adminGrowth.js, shared with the weekly summary
 * email, so the two can't drift apart on what "active" means. Exact figures for
 * every point are in the History table below, which is the table view of this
 * chart for anyone who can't read it as a picture.
 *
 * It spans the WHOLE history, always. What adapts is the grain — a point is a
 * day, a week or a month depending on how much there is — which is why the
 * heading says which, rather than leaving a monthly point to be misread as
 * yesterday.
 */
const GRAIN_LABEL = {
  day: 'one point per day',
  week: 'one point per week',
  month: 'one point per month',
  sparse: 'thinned to fit',
};

export function UsersOverTimeChart({ snaps }) {
  const { points, grain } = useMemo(() => summarizeUserGrowth(snaps, { maxPoints: 30 }), [snaps]);
  const [hover, setHover] = useState(null); // index under the pointer
  const wrapRef = useRef(null);

  if (points.length < 2) return null; // one dot is a number, not a trend

  const W = 720, H = 250;
  const PAD = { top: 14, right: 18, bottom: 34, left: 42 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = points.flatMap(p => [p.total, p.active]).filter(Number.isFinite);
  const { ticks, top } = niceTicks(Math.max(...values, 1));
  const xOf = i => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yOf = v => PAD.top + plotH - (v / top) * plotH;

  const SERIES = [
    { key: 'total', label: 'Total users', color: GROWTH_COLORS.total },
    { key: 'active', label: 'Active (7d)', color: GROWTH_COLORS.active },
  ];

  // A gap in the data breaks the line rather than being bridged: a straight
  // segment across a day nothing was captured would be a reading nobody took.
  const pathFor = key => points.reduce((d, p, i) => {
    if (!Number.isFinite(p[key])) return d + ' ';
    const cmd = (i === 0 || !Number.isFinite(points[i - 1]?.[key])) ? 'M' : 'L';
    return `${d}${cmd}${xOf(i).toFixed(1)},${yOf(p[key]).toFixed(1)} `;
  }, '').trim();

  // Markers on every point crowd a long series, so they appear only when the
  // points are far enough apart to read; the latest one is always drawn,
  // because "where are we now" is the question the chart is opened for.
  const showAllMarkers = points.length <= 14;
  const last = points.length - 1;

  function pick(e) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(xOf(i) - x) < Math.abs(xOf(best) - x)) best = i;
    }
    setHover(best);
  }

  const hp = hover == null ? null : points[hover];

  // Years appear in the span the moment it crosses one. Without this an
  // all-time chart introduces itself as "Sep 30 - Sep 22", which reads as a
  // week rather than the two years it is.
  const multiYear = points[0].date.slice(0, 4) !== points[last].date.slice(0, 4);
  const edge = i => shortDate(points[i].date, { year: multiYear });
  const spanLabel = `${edge(0)} – ${edge(last)}`;
  // A monthly point lands on whichever day represented its bucket, so the
  // day-of-month is an artefact; the month and year are the real information.
  const coarse = grain === 'month' || grain === 'sparse';
  const tickLabel = p => (coarse ? monthYear(p.date) : p.label);

  const summary = `Total users and active users across ${points.length} points `
    + `(${GRAIN_LABEL[grain]}), ${edge(0)} to ${edge(last)}.`;

  return (
    <div style={{ margin: '0 0 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <strong style={{ fontSize: '0.82rem' }}>Users over time</strong>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          {spanLabel} · {GRAIN_LABEL[grain]}
        </span>
        {SERIES.map(s => (
          <span key={s.key} style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: s.color, marginRight: 5 }} />
            {s.label}
          </span>
        ))}
      </div>

      <div
        ref={wrapRef}
        style={{ position: 'relative' }}
        onMouseMove={pick}
        onMouseLeave={() => setHover(null)}
        onTouchStart={pick}
        onTouchMove={pick}
        onTouchEnd={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto', overflow: 'visible' }} role="img" aria-label={summary}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--color-border)" strokeWidth="1" />
              <text x={PAD.left - 8} y={yOf(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-muted)">{t}</text>
            </g>
          ))}

          {hover != null && (
            <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          )}

          {SERIES.map(s => (
            <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {SERIES.map(s => points.map((p, i) => {
            if (!Number.isFinite(p[s.key])) return null;
            const show = showAllMarkers || i === last || i === hover;
            if (!show) return null;
            // A surface-coloured ring keeps the two markers apart where the
            // lines cross or sit on top of each other.
            return (
              <circle
                key={`${s.key}-${i}`}
                cx={xOf(i)} cy={yOf(p[s.key])} r={i === hover ? 5.5 : 4}
                fill={s.color} stroke="var(--color-surface)" strokeWidth="2"
              />
            );
          }))}

          {/* Direct labels on the latest point only — a number on every point
              is noise, and the one worth reading without hovering is today's.
              When the two lines finish close together the lower one's label
              drops below its marker instead of landing on the other. */}
          {SERIES.map((s, si) => {
            const v = points[last][s.key];
            if (!Number.isFinite(v)) return null;
            const other = points[last][SERIES[1 - si].key]; // exactly two series
            const crowded = Number.isFinite(other) && Math.abs(yOf(v) - yOf(other)) < 16;
            // On a tie the index breaks it, so the two labels never both go down.
            const below = crowded && (v < other || (v === other && si === 1));
            return (
              <text
                key={`lbl-${s.key}`}
                x={xOf(last)} y={yOf(v) + (below ? 20 : -10)}
                textAnchor="end" fontSize="12" fontWeight="600" fill="var(--color-text)"
              >{v}</text>
            );
          })}

          {points.map((p, i) => {
            // Every other date once the series gets long, so the labels don't collide.
            const stride = Math.ceil(points.length / 8);
            if (i % stride !== 0 && i !== last) return null;
            return (
              <text key={p.date} x={xOf(i)} y={H - 12} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">{tickLabel(p)}</text>
            );
          })}
        </svg>

        {hp && (
          <div
            style={{
              position: 'absolute', top: 0,
              left: `${(xOf(hover) / W) * 100}%`,
              transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})`,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 6, padding: '0.4rem 0.6rem', fontSize: '0.74rem',
              boxShadow: 'var(--shadow-sm)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 2,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{hp.date}</div>
            {SERIES.map(s => (
              <div key={s.key} style={{ color: 'var(--color-text-muted)' }}>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: s.color, marginRight: 5 }} />
                {s.label}: <strong style={{ color: 'var(--color-text)' }}>{Number.isFinite(hp[s.key]) ? hp[s.key] : '—'}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
