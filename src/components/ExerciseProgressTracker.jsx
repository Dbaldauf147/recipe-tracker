// "Progress" subtab of the Workout page. Classifies every exercise logged in the
// last 2 months as Progressing / Decreasing / Stagnating / No-Baseline and lays
// them out in status-grouped cards (mirroring the Normal Range Tracker visual):
// a chips summary up top (each chip has an ✕ to hide it from the page), then a
// table per status with baseline → recent, Δ, and a trend sparkline. Analysis
// lives in utils/exerciseProgress.js.
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import styles from './ExerciseProgressTracker.module.css';
import { analyzeProgress, displayWeight, WINDOW_DAYS, MIN_SESSIONS } from '../utils/exerciseProgress';
import { formatSeconds } from '../utils/setValue';
import { saveField, loadField } from '../utils/firestoreSync';

const HIDDEN_KEY = 'sunday-progress-hidden';

const STATUS_META = {
  progressing: { label: 'Progressing', icon: '📈', color: '#16a34a', blurb: 'Adding weight, reps, or volume' },
  decreasing: { label: 'Decreasing', icon: '📉', color: '#dc2626', blurb: 'Estimated 1RM trending down' },
  stagnating: { label: 'Stagnating', icon: '➖', color: '#d97706', blurb: '1RM holding flat — no added stimulus' },
  nobaseline: { label: 'No Baseline', icon: '○', color: '#64748b', blurb: `Fewer than ${MIN_SESSIONS} sessions in the window` },
};
const ORDER = ['progressing', 'decreasing', 'stagnating', 'nobaseline'];

// Format a metric value in the right units (weight / reps / hold time).
function fmtValue(metric, val, unit) {
  if (val == null) return '—';
  if (metric === 'e1rm') { const d = displayWeight(val, unit); return d == null ? '—' : `${d} ${unit}`; }
  if (metric === 'reps') return `${Math.round(val)} reps`;
  return formatSeconds(Math.round(val));
}

// Signed delta cell, e.g. "+12.5 lb (+6%)", colored by the exercise's status.
function DeltaCell({ r, unit }) {
  if (r.delta == null || r.deltaPct == null) return <span className={styles.dim}>—</span>;
  const up = r.delta >= 0;
  const sign = up ? '+' : '−';
  const mag = Math.abs(r.delta);
  const amount = r.metric === 'e1rm'
    ? `${displayWeight(mag, unit)} ${unit}`
    : r.metric === 'reps'
      ? `${Math.round(mag)} reps`
      : formatSeconds(Math.round(mag));
  const pct = `${up ? '+' : '−'}${Math.abs(Math.round(r.deltaPct * 100))}%`;
  const cls = r.status === 'progressing' ? styles.deltaUp
    : r.status === 'decreasing' ? styles.deltaDown
      : styles.deltaFlat;
  return <span className={cls}>{sign}{amount} ({pct})</span>;
}

// Minimal inline-SVG sparkline: the primary metric per session, a dashed
// baseline reference line, and a status-colored endpoint dot.
function Sparkline({ series, baseline, color }) {
  const W = 150, H = 40, pad = 5;
  if (!series || series.length === 0) return <span className={styles.dim}>—</span>;
  const vals = series.map(p => p.value);
  const lo = Math.min(...vals, baseline != null ? baseline : Infinity);
  const hi = Math.max(...vals, baseline != null ? baseline : -Infinity);
  const range = (hi - lo) || 1;
  const x = (i) => series.length === 1 ? W / 2 : pad + (i / (series.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - lo) / range) * (H - 2 * pad);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const lx = x(series.length - 1), ly = y(series[series.length - 1].value);
  return (
    <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {baseline != null && (
        <line x1={pad} x2={W - pad} y1={y(baseline)} y2={y(baseline)}
          stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
      )}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3.2" fill={color} />
    </svg>
  );
}

function ExerciseRow({ r, unit, onHide }) {
  const color = STATUS_META[r.status].color;
  return (
    <tr>
      <td className={styles.nameCell}>
        <span className={styles.exName}>{r.name}</span>
        {r.group && <span className={styles.exGroup}>{r.group}</span>}
      </td>
      <td className={styles.num}>{r.sessions}</td>
      <td className={styles.num}>{fmtValue(r.metric, r.baseline ?? r.last, unit)}</td>
      <td className={`${styles.num} ${styles.strong}`}>{fmtValue(r.metric, r.recent, unit)}</td>
      <td className={styles.num}><DeltaCell r={r} unit={unit} /></td>
      <td className={styles.trendCell}><Sparkline series={r.series} baseline={r.baseline} color={color} /></td>
      <td className={styles.hideCol}>
        <button type="button" className={styles.rowHide} title="Hide from tracker" aria-label={`Hide ${r.name}`} onClick={() => onHide(r.name)}>×</button>
      </td>
    </tr>
  );
}

function StatusSection({ status, rows, unit, onHide }) {
  const meta = STATUS_META[status];
  const baselineCol = status === 'nobaseline' ? 'Latest' : 'Baseline';
  const recentCol = status === 'nobaseline' ? 'Best' : 'Recent';
  return (
    <div className={styles.card} style={{ '--status-color': meta.color }}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>
          <span className={styles.cardIcon}>{meta.icon}</span>
          {meta.label}
          <span className={styles.count}>{rows.length}</span>
        </span>
        <span className={styles.cardBlurb}>{meta.blurb}</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Exercise</th>
              <th className={styles.num}>Sessions</th>
              <th className={styles.num}>{baselineCol}</th>
              <th className={styles.num}>{recentCol}</th>
              <th className={styles.num}>Δ vs baseline</th>
              <th>Trend</th>
              <th className={styles.hideCol} aria-label="Hide" />
            </tr>
          </thead>
          <tbody>
            {status === 'nobaseline'
              ? rows.map(r => (
                <tr key={r.name}>
                  <td className={styles.nameCell}>
                    <span className={styles.exName}>{r.name}</span>
                    {r.group && <span className={styles.exGroup}>{r.group}</span>}
                  </td>
                  <td className={styles.num}>{r.sessions}</td>
                  <td className={styles.num}>{fmtValue(r.metric, r.last, unit)}</td>
                  <td className={styles.num}>{fmtValue(r.metric, r.best, unit)}</td>
                  <td className={`${styles.num} ${styles.dim}`}>{MIN_SESSIONS - r.sessions} more</td>
                  <td className={styles.trendCell}><Sparkline series={r.series} baseline={null} color={STATUS_META.nobaseline.color} /></td>
                  <td className={styles.hideCol}>
                    <button type="button" className={styles.rowHide} title="Hide from tracker" aria-label={`Hide ${r.name}`} onClick={() => onHide(r.name)}>×</button>
                  </td>
                </tr>
              ))
              : rows.map(r => <ExerciseRow key={r.name} r={r} unit={unit} onHide={onHide} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ExerciseProgressTracker({ workouts = [], weightUnit = 'lb', exerciseLibrary = [], user = null }) {
  // name(lowercased) → muscle group, so rows can show a group subtitle.
  const groupByName = useMemo(() => {
    const m = new Map();
    for (const ex of (exerciseLibrary || [])) {
      const n = (ex?.exercise || '').trim().toLowerCase();
      if (n && ex.muscleGroup) m.set(n, ex.muscleGroup);
    }
    return m;
  }, [exerciseLibrary]);

  const allGroups = useMemo(() => analyzeProgress(workouts, groupByName), [workouts, groupByName]);

  // Exercises the user has hidden from this page (lowercased names). Seed from
  // localStorage for instant paint, then reconcile with the user doc.
  const [hidden, setHidden] = useState(() => {
    try { const a = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); return new Set(Array.isArray(a) ? a : []); }
    catch { return new Set(); }
  });
  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    loadField(user.uid, 'progressHiddenExercises').then(v => {
      if (alive && Array.isArray(v)) {
        const set = new Set(v.map(x => String(x).toLowerCase()));
        setHidden(set);
        try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.uid]);

  const setHiddenName = useCallback((name, hide) => {
    setHidden(prev => {
      const next = new Set(prev);
      const key = name.trim().toLowerCase();
      if (hide) next.add(key); else next.delete(key);
      const arr = [...next];
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
      if (user?.uid) saveField(user.uid, 'progressHiddenExercises', arr).catch(() => {});
      return next;
    });
  }, [user?.uid]);

  // Split analysis into visible groups + the hidden pile (for the restore row).
  const { groups, hiddenList, total } = useMemo(() => {
    const g = {};
    let t = 0;
    const hid = [];
    for (const k of ORDER) {
      g[k] = [];
      for (const r of allGroups[k]) {
        if (hidden.has(r.name.toLowerCase())) hid.push(r);
        else { g[k].push(r); t++; }
      }
    }
    hid.sort((a, b) => a.name.localeCompare(b.name));
    return { groups: g, hiddenList: hid, total: t };
  }, [allGroups, hidden]);

  const anyAnalyzed = ORDER.reduce((s, k) => s + allGroups[k].length, 0) > 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Exercise Progress Tracker</h2>
          <p className={styles.subtitle}>Every exercise you've logged in the last 2 months, by whether it's progressing.</p>
        </div>
        <span className={styles.legendNote}>Past {WINDOW_DAYS} days · est. 1RM (Epley) · recent vs baseline</span>
      </div>

      {!anyAnalyzed ? (
        <div className={styles.empty}>No workouts logged in the last 2 months. Log some sets and your exercises will show up here.</div>
      ) : (
        <>
          {/* Chips summary — status → count + the exercises in it (✕ to hide) */}
          <div className={styles.summary}>
            {ORDER.map(status => (
              <div key={status} className={styles.summaryRow}>
                <span className={styles.summaryLabel} style={{ '--status-color': STATUS_META[status].color }}>
                  {STATUS_META[status].label}
                  <span className={styles.summaryCount}>{groups[status].length}</span>
                </span>
                <div className={styles.chips}>
                  {groups[status].length === 0
                    ? <span className={styles.chipEmpty}>none</span>
                    : groups[status].map(r => (
                      <span key={r.name} className={styles.chip} style={{ '--status-color': STATUS_META[status].color }}>
                        {r.name}
                        <button type="button" className={styles.chipX} title="Hide from tracker" aria-label={`Hide ${r.name}`} onClick={() => setHiddenName(r.name, true)}>×</button>
                      </span>
                    ))}
                </div>
              </div>
            ))}
            {hiddenList.length > 0 && (
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel} style={{ '--status-color': '#94a3b8' }}>
                  Hidden
                  <span className={styles.summaryCount}>{hiddenList.length}</span>
                </span>
                <div className={styles.chips}>
                  {hiddenList.map(r => (
                    <button key={r.name} type="button" className={styles.chipHidden} title="Show again" onClick={() => setHiddenName(r.name, false)}>
                      {r.name}<span className={styles.chipRestore}>＋</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className={styles.hint}>Click ✕ on an exercise to hide it from this page{hiddenList.length > 0 ? '; click a hidden one to show it again.' : '.'}</p>

          {total === 0 ? (
            <div className={styles.empty}>All analyzed exercises are hidden. Restore one above to see it here.</div>
          ) : ORDER.filter(s => groups[s].length > 0).map(status => (
            <StatusSection key={status} status={status} rows={groups[status]} unit={weightUnit} onHide={(n) => setHiddenName(n, true)} />
          ))}
        </>
      )}
    </div>
  );
}
