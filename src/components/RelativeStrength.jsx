// "vs Bodyweight" subtab of the Workout page: every lift expressed as a multiple
// of what you weigh, ranked, with what moved the ratio (the lift or the scale)
// and where the published strength bands put it.
//
// The Charts page can already plot est-1RM ÷ bodyweight for one exercise at a
// time. This page is the board: all of them at once, plus the decomposition a
// single line can't show. Analysis lives in utils/relativeStrength.js.
import React, { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Scatter } from 'recharts';
import styles from './RelativeStrength.module.css';
import {
  analyzeRelativeStrength, standardLevel, DEFAULT_WINDOW_DAYS, WINDOW_OPTIONS, STANDARD_LEVELS,
} from '../utils/relativeStrength';
import { displayWeight } from '../utils/exerciseProgress';
import { effectiveExerciseType } from '../utils/exerciseTypes';

const WEIGHT_LOG_KEY = 'sunday-weight-log';
const BODY_STATS_KEY = 'sunday-body-stats';
const WINDOW_KEY = 'sunday-relstrength-window';
// 'male' | 'female' | 'off'. Its own setting rather than always following body
// stats: the bands are a reference table, and wanting them hidden is a normal
// thing to want without editing your profile.
const SEX_KEY = 'sunday-relstrength-sex';

const RATIO = '#3B6B9C';
const BW = '#94a3b8';
const AWAY = '#9ca3af';

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
  catch { return fallback; }
}

/** 'YYYY-MM-DD' → "Jul 9" (parsed local so it can't drift a day). */
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const fmtRatio = r => `${r.toFixed(2)}×`;
const fmtPct = p => `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`;

/**
 * Ratio over time. The line joins the sessions that count; an away day is a
 * grey dot at its own x.
 *
 * The scale is set by the counted sessions ONLY. One bad afternoon on a hotel
 * cable stack can sit 40% below everything else, and letting it set the range
 * squashes a year of real progress into a flat line — the sparkline would be
 * dominated by the one session the page has already decided not to count. An
 * away day outside that range is pinned to the edge (hollow, so it reads as
 * "off the scale" rather than as a value); the popup chart has the axes and
 * shows it where it truly falls.
 */
function Sparkline({ series }) {
  const W = 140, H = 34, pad = 4;
  if (!series || series.length === 0) return <span className={styles.dim}>—</span>;
  const scored = series.filter(p => !p.offsite);
  const scale = scored.length > 0 ? scored : series;
  const vals = scale.map(p => p.ratio);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const range = (hi - lo) || 1;
  const x = i => (series.length === 1 ? W / 2 : pad + (i / (series.length - 1)) * (W - 2 * pad));
  const y = v => {
    const raw = H - pad - ((v - lo) / range) * (H - 2 * pad);
    return Math.min(H - pad, Math.max(pad, raw));
  };
  const inRange = v => v >= lo && v <= hi;
  const pts = series
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.offsite)
    .map(({ p, i }) => `${x(i).toFixed(1)},${y(p.ratio).toFixed(1)}`)
    .join(' ');
  const last = scale[scale.length - 1];
  const lastIdx = series.lastIndexOf(last);
  return (
    <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={RATIO} strokeWidth="1.6" strokeLinejoin="round" />
      {series.map((p, i) => (p.offsite
        ? <circle key={i} cx={x(i)} cy={y(p.ratio)} r={2.4}
          fill={inRange(p.ratio) ? AWAY : 'none'} stroke={AWAY} strokeWidth="1" />
        : null))}
      <circle cx={x(lastIdx)} cy={y(last.ratio)} r={2.6} fill={RATIO} />
    </svg>
  );
}

/** Where this lift sits across the five bands, as a 5-segment bar. */
function BandBar({ level }) {
  if (!level) return null;
  return (
    <span className={styles.bandBar} aria-hidden="true">
      {STANDARD_LEVELS.map((lab, i) => (
        <span
          key={lab}
          className={`${styles.bandSeg} ${i <= level.index ? styles.bandOn : ''}`}
          title={`${lab} · ${level.bands[i].toFixed(2)}×`}
        />
      ))}
    </span>
  );
}

export default function RelativeStrength({ workouts = [], weightUnit = 'lb', exerciseLibrary = [] }) {
  // Weigh-ins, hydrated into localStorage by firestoreSync. Read here rather
  // than threaded through props — the established pattern in this app, and the
  // same one the Progress tab uses for the same array.
  const [weightLog, setWeightLog] = useState(() => readJSON(WEIGHT_LOG_KEY, []));
  useEffect(() => {
    const reload = () => setWeightLog(readJSON(WEIGHT_LOG_KEY, []));
    window.addEventListener('weight-logged', reload);
    window.addEventListener('firestore-sync', reload);
    return () => {
      window.removeEventListener('weight-logged', reload);
      window.removeEventListener('firestore-sync', reload);
    };
  }, []);

  const [windowDays, setWindowDays] = useState(() => {
    const v = Number(localStorage.getItem(WINDOW_KEY));
    return WINDOW_OPTIONS.some(o => o.value === v) ? v : DEFAULT_WINDOW_DAYS;
  });
  useEffect(() => { try { localStorage.setItem(WINDOW_KEY, String(windowDays)); } catch { /* ignore */ } }, [windowDays]);

  // Which standards table to read against. Seeded from the gender already in
  // body stats (the nutrition targets ask for it) so most people never touch
  // this; 'off' when there's nothing to seed from, because guessing wrong grades
  // the whole page against the wrong table without ever saying so.
  const [sex, setSex] = useState(() => {
    const saved = localStorage.getItem(SEX_KEY);
    if (saved === 'male' || saved === 'female' || saved === 'off') return saved;
    const g = readJSON(BODY_STATS_KEY, {})?.gender;
    return g === 'male' || g === 'female' ? g : 'off';
  });
  useEffect(() => { try { localStorage.setItem(SEX_KEY, sex); } catch { /* ignore */ } }, [sex]);

  const groupByName = useMemo(() => {
    const m = new Map();
    for (const ex of (exerciseLibrary || [])) {
      const n = (ex?.exercise || '').trim().toLowerCase();
      if (n && ex.muscleGroup) m.set(n, ex.muscleGroup);
    }
    return m;
  }, [exerciseLibrary]);

  // A drill you've tagged as Stretching stays off the page whatever its name
  // looks like — same precedence the Progress tab uses.
  const typeByName = useMemo(() => {
    const m = new Map();
    for (const ex of (exerciseLibrary || [])) {
      const n = (ex?.exercise || '').trim().toLowerCase();
      if (n) m.set(n, effectiveExerciseType(ex, ex.muscleGroup));
    }
    return m;
  }, [exerciseLibrary]);

  const libraryByName = useMemo(() => {
    const m = new Map();
    for (const ex of (exerciseLibrary || [])) {
      const n = (ex?.exercise || '').trim().toLowerCase();
      if (n) m.set(n, ex);
    }
    return m;
  }, [exerciseLibrary]);

  const analysis = useMemo(() => analyzeRelativeStrength(workouts, {
    weightLog, groupByName, typeByName, exerciseLibrary: libraryByName,
    windowDays, sex: sex === 'off' ? 'male' : sex,
  }), [workouts, weightLog, groupByName, typeByName, libraryByName, windowDays, sex]);

  const { rows, bodyweight, excluded, hasWeighIns, total } = analysis;
  const showStandards = sex !== 'off';

  const [openLift, setOpenLift] = useState(null);
  useEffect(() => {
    if (!openLift) return;
    const onKey = e => { if (e.key === 'Escape') setOpenLift(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLift]);
  const openRow = openLift ? rows.find(r => r.key === openLift) : null;
  // The popup's rows: one per session, with the ratio split into the line's
  // column and the away-day scatter's column so they share one x-axis.
  const chartData = useMemo(() => (openRow?.series || []).map(p => ({
    ...p,
    ratioScored: p.offsite ? null : p.ratio,
    ratioAway: p.offsite ? p.ratio : null,
  })), [openRow]);

  const unit = weightUnit;
  const w = lb => displayWeight(lb, unit);

  const header = (
    <div className={styles.header}>
      <div>
        <h2 className={styles.title}>Strength vs bodyweight</h2>
        <p className={styles.subtitle}>
          Every lift as a multiple of what you weigh — estimated 1RM ÷ your bodyweight on the day you lifted it.
        </p>
      </div>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Window</span>
          <select className={styles.select} value={windowDays} onChange={e => setWindowDays(Number(e.target.value))}>
            {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Standards</span>
          <select className={styles.select} value={sex} onChange={e => setSex(e.target.value)}>
            <option value="male">Men's table</option>
            <option value="female">Women's table</option>
            <option value="off">Hide</option>
          </select>
        </label>
      </div>
    </div>
  );

  if (!hasWeighIns) {
    return (
      <div className={styles.container}>
        {header}
        <div className={styles.empty}>
          <p><strong>No weigh-ins yet.</strong></p>
          <p>This page divides each lift by your bodyweight on the day you lifted it, so it needs at least one weigh-in
            to divide by. Log one on the Body tab and every session from that date onward appears here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {header}

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Bodyweight</div>
          <div className={styles.tileValue}>{w(bodyweight.lb)} <span className={styles.tileUnit}>{unit}</span></div>
          <div className={styles.tileNote}>weighed {fmtDate(bodyweight.date)}</div>
        </div>
        {rows[0] && (
          <div className={styles.tile}>
            <div className={styles.tileLabel}>Strongest relative lift</div>
            <div className={styles.tileValue}>{fmtRatio(rows[0].current.ratio)}</div>
            <div className={styles.tileNote}>{rows[0].name}</div>
          </div>
        )}
        {total && (
          <div className={styles.tile}>
            <div className={styles.tileLabel}>Squat + bench + deadlift</div>
            <div className={styles.tileValue}>{fmtRatio(total.ratio)}</div>
            <div className={styles.tileNote}>{w(total.sum)} {unit} total</div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <p><strong>Nothing to show in this window.</strong></p>
          <p>Every lift needs at least one loaded session (weight × reps) logged on or after your first weigh-in.
            Try a longer window.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Lift</th>
                <th className={styles.num}>× bodyweight</th>
                <th className={styles.num}>Est. 1RM</th>
                <th className={styles.num}>Change</th>
                <th>Trend</th>
                {showStandards && <th>Standard</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const c = r.change;
                const tone = !c ? styles.flat
                  : c.ratioPct > 0.01 ? styles.up
                    : c.ratioPct < -0.01 ? styles.down : styles.flat;
                const level = showStandards && r.standard
                  ? standardLevel(r.current.ratio, r.standard, sex)
                  : null;
                const gapLb = level?.next ? (level.next.ratio - r.current.ratio) * r.current.bw : null;
                return (
                  <tr key={r.key}>
                    <td>
                      <button className={styles.nameBtn} onClick={() => setOpenLift(r.key)} title="Open the full chart">
                        {r.name}
                      </button>
                      <div className={styles.rowNote}>
                        {r.sessions} session{r.sessions === 1 ? '' : 's'} · last {fmtDate(r.current.date)}
                      </div>
                    </td>
                    <td className={styles.num}>
                      <span className={styles.ratio}>{fmtRatio(r.current.ratio)}</span>
                      {r.bestAllTime.ratio > r.current.ratio + 0.005 && (
                        <div className={styles.rowNote} title={`Best ever, ${fmtDate(r.bestAllTime.date)}`}>
                          best {fmtRatio(r.bestAllTime.ratio)}
                        </div>
                      )}
                    </td>
                    <td className={styles.num}>
                      {w(r.current.e1rm)} {unit}
                      <div className={styles.rowNote}>at {w(r.current.bw)} {unit}</div>
                    </td>
                    <td className={styles.num}>
                      {c ? (
                        <>
                          <span className={tone}>{fmtPct(c.ratioPct)}</span>
                          {/* The whole point of the page: the ratio can fall on a
                              lift that went UP, and only these two numbers say so. */}
                          <div className={styles.rowNote} title={`${fmtDate(c.startDate)} → ${fmtDate(c.endDate)}`}>
                            lift {fmtPct(c.e1rmPct)} · body {fmtPct(c.bwPct)}
                          </div>
                        </>
                      ) : <span className={styles.dim}>one session</span>}
                    </td>
                    <td><Sparkline series={r.series} /></td>
                    {showStandards && (
                      <td>
                        {level ? (
                          <>
                            <span className={styles.levelChip}>{level.level || 'Building'}</span>
                            <BandBar level={level} />
                            {level.next && gapLb > 0 && (
                              <div className={styles.rowNote}>
                                {w(gapLb)} {unit} to {level.next.label}
                              </div>
                            )}
                          </>
                        ) : <span className={styles.dim}>—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(excluded.bodyweight.length > 0 || excluded.noWeighIn > 0) && (
        <p className={styles.footnote}>
          {excluded.bodyweight.length > 0 && (
            <>Left out — the load already contains your bodyweight: {excluded.bodyweight.join(', ')}. </>
          )}
          {excluded.noWeighIn > 0 && (
            <>{excluded.noWeighIn} lift{excluded.noWeighIn === 1 ? ' was' : 's were'} only ever logged before your
              first weigh-in, so there is nothing to divide by.</>
          )}
        </p>
      )}

      <details className={styles.methodology}>
        <summary className={styles.methodologySummary}>How this is worked out</summary>
        <div className={styles.methodologyBody}>
          <p>
            <strong>The ratio.</strong> Each session's best estimated 1RM (Epley, across all its sets) divided by your
            bodyweight on that date — the most recent weigh-in on or before it. Sessions logged before your first
            weigh-in are left out rather than divided by a weight you hadn't recorded yet.
          </p>
          <p>
            <strong>Change.</strong> The first and last couple of sessions in the window, compared. It's split into the
            two things that can move it: the lift and the scale. A lift can go up while the ratio goes down — that's
            not an error, it's the number doing its job.
          </p>
          <p>
            <strong>Bodyweight movements</strong> (pull-ups, dips, push-ups) are excluded: their load already contains
            your bodyweight, so the ratio barely moves and reads as a plateau rather than as a question that doesn't
            apply. <strong>Away sessions</strong> — a one-off gym for this lift — stay on the chart as grey dots but
            never set the headline number: someone else's equipment isn't evidence about your strength.
          </p>
          {showStandards && (
            <p>
              <strong>The bands</strong> (Beginner → Elite) are the commonly published bodyweight-multiple standards,
              and they only appear for the barbell lifts those tables cover — a dumbbell or machine variant is a
              different lift with different numbers. They're flat multiples, while the real tables also vary by
              bodyweight class and age, so read a band as a neighbourhood, not a grade.
            </p>
          )}
        </div>
      </details>

      {openRow && (
        <div className={styles.modalOverlay} onClick={() => setOpenLift(null)} role="dialog" aria-modal="true">
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{openRow.name} — × bodyweight</h3>
              <button className={styles.modalClose} onClick={() => setOpenLift(null)} aria-label="Close chart">×</button>
            </div>
            <div className={styles.modalChart}>
              <ResponsiveContainer width="100%" height={280}>
                {/* Both series come off the SAME rows — an away day is a null in
                    one column and a value in the other. Handing a child its own
                    `data` array instead makes recharts build the x-axis from
                    that array alone, which collapses the whole chart to the one
                    away session. */}
                <ComposedChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="ratio" tick={{ fontSize: 11 }} width={44}
                    tickFormatter={v => v.toFixed(2)} domain={['auto', 'auto']} />
                  <YAxis yAxisId="bw" orientation="right" tick={{ fontSize: 11 }} width={44}
                    tickFormatter={v => Math.round(displayWeight(v, unit))} domain={['auto', 'auto']} />
                  <Tooltip
                    labelFormatter={fmtDate}
                    formatter={(v, name) => (name === 'Bodyweight'
                      ? [`${w(v)} ${unit}`, name]
                      : [`${Number(v).toFixed(2)}×`, name])}
                  />
                  <Line yAxisId="bw" type="monotone" dataKey="bw" name="Bodyweight" stroke={BW}
                    strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                  <Line yAxisId="ratio" type="monotone" dataKey="ratioScored" name="× bodyweight" stroke={RATIO}
                    strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  {/* Away days stay visible, in grey, exactly as the table's
                      sparkline shows them — plotted, never counted. */}
                  <Scatter yAxisId="ratio" name="Somewhere else" fill={AWAY} dataKey="ratioAway" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className={styles.modalNote}>
              Blue is the multiple of bodyweight; the dashed grey line is the bodyweight it was divided by.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
