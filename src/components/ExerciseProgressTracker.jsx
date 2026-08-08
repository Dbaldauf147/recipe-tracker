// "Progress" subtab of the Workout page. Classifies every exercise logged in the
// last 2 months as Progressing / Decreasing / Stagnating / No-Baseline and lays
// them out in status-grouped cards (mirroring the Normal Range Tracker visual):
// a chips summary up top (each chip has an ✕ to hide it from the page), then a
// table per status with baseline → recent, Δ, and a trend sparkline. Analysis
// lives in utils/exerciseProgress.js.
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import styles from './ExerciseProgressTracker.module.css';
import {
  analyzeProgress, displayWeight, deltaTone, WINDOW_DAYS, MIN_SESSIONS, MIN_SPAN_DAYS,
  PROGRESS_PCT, VOLUME_PCT, VOLUME_DROP_PCT, EPLEY_REP_CAP,
} from '../utils/exerciseProgress';
import { formatSeconds } from '../utils/setValue';
import { saveField, loadField } from '../utils/firestoreSync';
import ExerciseChart from './ExerciseChart';

const HIDDEN_KEY = 'sunday-progress-hidden';

// Exercises hidden until a date, as { 'bench press': 'YYYY-MM-DD' }.
//
// Its OWN field rather than a shape change to progressHiddenExercises, which is
// a flat array of names that other readers already understand. A hide with an
// end date is a different thing from a hide without one, and mixing them would
// mean every reader of the old field learning about expiry.
const SNOOZE_FIELD = 'progressSnoozedExercises';
const SNOOZE_KEY = 'sunday-progress-snoozed';
// Long enough to sit out a whole training block. Already-parked exercises keep
// the expiry date they were given, so changing this only affects new parks.
const SNOOZE_DAYS = 45;

/** Local YYYY-MM-DD, N days from today. Dates, not timestamps: the unit the
 *  user asked for is days, and a date compares cleanly as a string. */
function dateInDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A copy with any expiry that has come and gone dropped. */
function pruneExpired(map) {
  const today = dateInDays(0);
  return Object.fromEntries(Object.entries(map || {}).filter(([, until]) => until > today));
}

/** Days from today until `iso`, rounded up; 0 once it's today or past. */
function daysUntil(iso) {
  const today = dateInDays(0);
  if (!iso || iso <= today) return 0;
  const ms = new Date(`${iso}T12:00:00`) - new Date(`${today}T12:00:00`);
  return Math.max(0, Math.round(ms / 86400000));
}
const INTENT_KEY = 'sunday-progress-intent';
// Bodyweight history, hydrated into localStorage from the user doc by
// firestoreSync. Read directly (the established pattern in this app) rather than
// threaded through props — WorkoutPage doesn't receive it either.
const WEIGHT_LOG_KEY = 'sunday-weight-log';

const STATUS_META = {
  progressing: { label: 'Progressing', icon: '📈', color: '#16a34a', blurb: 'Adding weight, reps, or volume' },
  decreasing: { label: 'Decreasing', icon: '📉', color: '#dc2626', blurb: 'Estimated 1RM trending down' },
  stagnating: { label: 'Stagnating', icon: '➖', color: '#d97706', blurb: '1RM holding flat — no added stimulus' },
  deload: { label: 'Deload', icon: '🌙', color: '#7c3aed', blurb: 'Backing off on purpose — dips are expected' },
  maintaining: { label: 'Maintaining', icon: '⏸️', color: '#0891b2', blurb: 'Holding steady on purpose' },
  nobaseline: { label: 'No Baseline', icon: '○', color: '#64748b', blurb: `Needs ${MIN_SESSIONS}+ sessions over ${MIN_SPAN_DAYS}+ days` },
};
const ORDER = ['progressing', 'decreasing', 'stagnating', 'deload', 'maintaining', 'nobaseline'];

const INTENT_OPTIONS = [
  { value: 'normal', label: 'Normal training' },
  { value: 'deload', label: 'Deload' },
  { value: 'maintenance', label: 'Maintaining' },
];

// Why an exercise has no trend yet — "new" (not enough time depth) vs
// "insufficient" (logged too sparsely). Shown as a hint in the No Baseline table.
function noBaselineHint(r) {
  if (r.noBaselineReason === 'new') {
    const need = MIN_SPAN_DAYS - (r.spanDays || 0);
    return `new · ${need}+ more days`;
  }
  const need = MIN_SESSIONS - r.sessions;
  return need > 0 ? `${need} more session${need === 1 ? '' : 's'}` : 'log more often';
}

const ANNOTATION_META = {
  'volume-down': { text: 'volume down', title: `Training volume is down ${VOLUME_DROP_PCT * 100}%+ over the window` },
  'volume-up': { text: 'volume up', title: `Training volume is up ${VOLUME_PCT * 100}%+ over the window` },
};

// 'YYYY-MM-DD' → "Jul 9" (parsed as a local date to avoid TZ drift).
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Whole days between `dateStr` (local midnight) and today. null if unparseable.
function daysSince(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const then = new Date(y, m - 1, d); then.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - then) / 86400000);
}

// Last-workout cell: the date plus a "days ago" indicator (amber when stale).
// `staleAfter` is per-exercise and adaptive — 2× that lift's own median logging
// gap — so a twice-weekly lift flags sooner than a once-a-month one.
function LastCell({ dateStr, loggedDateStr, staleAfter = 14 }) {
  // `dateStr` is the last COMPLETED (green) session. Imported history and
  // workouts saved without ticking a set have none, which used to leave the
  // cell blank — no date, and no staleness check either, so a lift untouched
  // for weeks looked fine. Fall back to the last logged session, shown muted
  // so "I finished this" still reads differently from "it was on the list".
  const unconfirmed = !dateStr && !!loggedDateStr;
  const shown = dateStr || loggedDateStr;
  const n = daysSince(shown);
  const rel = n == null ? '' : n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n}d ago`;
  const stale = n != null && n >= staleAfter;
  const staleTitle = stale
    ? `No log in ${n} days — this lift is usually trained every ~${Math.round(staleAfter / 2)} days`
    : undefined;
  return (
    <td className={styles.num}>
      <span
        className={`${styles.lastDate}${unconfirmed ? ` ${styles.lastUnconfirmed}` : ''}`}
        title={unconfirmed ? 'Logged, but no sets were marked complete' : undefined}
      >
        {fmtDate(shown)}{unconfirmed ? '*' : ''}
      </span>
      {rel && (
        <span
          className={`${styles.lastAgo}${stale ? ` ${styles.lastStale}` : ''}`}
          title={staleTitle}
        >{rel}</span>
      )}
    </td>
  );
}

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
  const tone = deltaTone(r.status, r.delta);
  const cls = tone === 'up' ? styles.deltaUp : tone === 'down' ? styles.deltaDown : styles.deltaFlat;
  // The status and the number disagree — the lift was classified on volume while
  // its e1RM moved the other way. Say so on hover rather than colouring a
  // negative number green.
  const mismatch = (r.status === 'progressing' && !up) || (r.status === 'decreasing' && up);
  return (
    <span className={cls} title={mismatch ? 'Classified on training volume — the e1RM trend itself moved the other way.' : undefined}>
      {sign}{amount} ({pct})
    </span>
  );
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

// Secondary signals that didn't change the status but are worth surfacing —
// e.g. a sustained volume drop underneath a flat e1RM.
function Annotations({ list }) {
  if (!list || list.length === 0) return null;
  return (
    <>
      {list.map(a => ANNOTATION_META[a] && (
        <span key={a} className={styles.annotation} title={ANNOTATION_META[a].title}>
          {ANNOTATION_META[a].text}
        </span>
      ))}
    </>
  );
}

/**
 * The two ways to get an exercise off this page.
 *
 * Parking is the one you actually want most of the time — an exercise you're not
 * training this block isn't stagnating, it's parked, and it should come back on
 * its own rather than needing you to remember it exists. ✕ stays for good.
 */
function HideCell({ name, onHide, onSnooze }) {
  return (
    <td className={styles.hideCol}>
      <button
        type="button"
        className={styles.rowSnooze}
        title={`Hide ${name} for ${SNOOZE_DAYS} days, then bring it back`}
        aria-label={`Hide ${name} for ${SNOOZE_DAYS} days`}
        onClick={() => onSnooze(name)}
      >{SNOOZE_DAYS}d</button>
      <button
        type="button"
        className={styles.rowHide}
        title={`Hide ${name} from the tracker for good`}
        aria-label={`Hide ${name}`}
        onClick={() => onHide(name)}
      >×</button>
    </td>
  );
}

function ExerciseRow({ r, unit, onHide, onSnooze, onOpenChart }) {
  const color = STATUS_META[r.status].color;
  return (
    <tr>
      <td className={styles.nameCell}>
        <button type="button" className={styles.exNameBtn} onClick={() => onOpenChart(r.name)} title={`View ${r.name} chart`}>{r.name}</button>
        {r.group && <span className={styles.exGroup}>{r.group}</span>}
        <Annotations list={r.annotations} />
        {r.discontinuity && (
          <span className={styles.annotation} title="This exercise switched between rep-based and loaded logging; the trend restarts from the switch.">
            window restarted
          </span>
        )}
      </td>
      <td className={styles.num}>{r.sessions}</td>
      <LastCell dateStr={r.lastDate} loggedDateStr={r.lastLoggedDate} staleAfter={r.staleAfterDays} />
      <td className={styles.num}>{fmtValue(r.metric, r.baseline ?? r.last, unit)}</td>
      <td className={`${styles.num} ${styles.strong}`}>{fmtValue(r.metric, r.recent, unit)}</td>
      <td className={styles.num}><DeltaCell r={r} unit={unit} /></td>
      <td className={styles.trendCell}><Sparkline series={r.series} baseline={r.baseline} color={color} /></td>
      <HideCell name={r.name} onHide={onHide} onSnooze={onSnooze} />
    </tr>
  );
}

function StatusSection({ status, rows, unit, onHide, onSnooze, onOpenChart }) {
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
              <th className={styles.num}>Last</th>
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
                    <button type="button" className={styles.exNameBtn} onClick={() => onOpenChart(r.name)} title={`View ${r.name} chart`}>{r.name}</button>
                    {r.group && <span className={styles.exGroup}>{r.group}</span>}
                  </td>
                  <td className={styles.num}>{r.sessions}</td>
                  <LastCell dateStr={r.lastDate} loggedDateStr={r.lastLoggedDate} staleAfter={r.staleAfterDays} />
                  <td className={styles.num}>{fmtValue(r.metric, r.last, unit)}</td>
                  <td className={styles.num}>{fmtValue(r.metric, r.best, unit)}</td>
                  <td className={`${styles.num} ${styles.dim}`}>{noBaselineHint(r)}</td>
                  <td className={styles.trendCell}><Sparkline series={r.series} baseline={null} color={STATUS_META.nobaseline.color} /></td>
                  <HideCell name={r.name} onHide={onHide} onSnooze={onSnooze} />
                </tr>
              ))
              : rows.map(r => <ExerciseRow key={r.name} r={r} unit={unit} onHide={onHide} onSnooze={onSnooze} onOpenChart={onOpenChart} />)}
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

  // Bodyweight history, so weighted pull-ups/dips can be scored on
  // bodyweight + added load instead of the plate alone. Seeded from localStorage
  // (firestoreSync hydrates it there) and refreshed when a weigh-in lands.
  const [weightLog, setWeightLog] = useState(() => {
    try { const a = JSON.parse(localStorage.getItem(WEIGHT_LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  });
  useEffect(() => {
    const reload = () => {
      try { const a = JSON.parse(localStorage.getItem(WEIGHT_LOG_KEY) || '[]'); setWeightLog(Array.isArray(a) ? a : []); }
      catch { /* keep what we have */ }
    };
    window.addEventListener('weight-logged', reload);
    window.addEventListener('firestore-sync', reload);
    return () => {
      window.removeEventListener('weight-logged', reload);
      window.removeEventListener('firestore-sync', reload);
    };
  }, []);

  // Declared training intent. When set, planned dips stop being reported as
  // regressions. Global-only for now; the analysis layer also supports a
  // per-exercise override (see options.intentByExercise) which has no UI yet.
  const [intent, setIntent] = useState(() => {
    try { return localStorage.getItem(INTENT_KEY) || 'normal'; } catch { return 'normal'; }
  });
  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    loadField(user.uid, 'workoutTrainingIntent').then(v => {
      if (alive && typeof v === 'string' && INTENT_OPTIONS.some(o => o.value === v)) {
        setIntent(v);
        try { localStorage.setItem(INTENT_KEY, v); } catch { /* ignore */ }
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.uid]);

  const uid = user?.uid;
  const changeIntent = useCallback((v) => {
    setIntent(v);
    try { localStorage.setItem(INTENT_KEY, v); } catch { /* ignore */ }
    if (uid) saveField(uid, 'workoutTrainingIntent', v).catch(() => {});
  }, [uid]);

  const allGroups = useMemo(
    () => analyzeProgress(workouts, groupByName, {
      weightLog,
      intent: intent === 'normal' ? null : intent,
    }),
    [workouts, groupByName, weightLog, intent],
  );

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

  // Temporarily hidden: name → the date it comes back.
  const [snoozed, setSnoozed] = useState(() => {
    try { const o = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch { return {}; }
  });
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    loadField(uid, SNOOZE_FIELD).then(v => {
      if (alive && v && typeof v === 'object' && !Array.isArray(v)) {
        // Pruned on the way in. Expiries are dropped when they're read or
        // written rather than by an effect that watches the state it sets —
        // the render-time filter already hides them, so nothing is waiting on
        // this, and it never has to reconcile with itself.
        const live = pruneExpired(v);
        setSnoozed(live);
        try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(live)); } catch { /* ignore */ }
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [uid]);

  /** Hide for SNOOZE_DAYS, or pass false to bring it back now. */
  const setSnoozedName = useCallback((name, snooze) => {
    const key = name.trim().toLowerCase();
    setSnoozed(prev => {
      const next = pruneExpired(prev);
      if (snooze) next[key] = dateInDays(SNOOZE_DAYS);
      else delete next[key];
      try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      if (uid) saveField(uid, SNOOZE_FIELD, next).catch(() => {});
      return next;
    });
  }, [uid]);

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

  // Split analysis into visible groups, the hidden pile, and the snoozed pile.
  // The two piles are listed separately: "gone until I say otherwise" and "back
  // on the 5th" are different states, and a single list of them would hide the
  // fact that some of these are coming back on their own.
  const { groups, hiddenList, snoozedList, total } = useMemo(() => {
    const g = {};
    let t = 0;
    const hid = [];
    const snz = [];
    const today = dateInDays(0);
    for (const k of ORDER) {
      g[k] = [];
      for (const r of allGroups[k]) {
        const key = r.name.toLowerCase();
        const until = snoozed[key];
        if (hidden.has(key)) hid.push(r);
        // Compared against today on every render, not just at cleanup: the page
        // can be open when a snooze runs out, and it should come back on its own.
        else if (until && until > today) snz.push({ ...r, until });
        else { g[k].push(r); t++; }
      }
    }
    hid.sort((a, b) => a.name.localeCompare(b.name));
    snz.sort((a, b) => a.until.localeCompare(b.until) || a.name.localeCompare(b.name));
    return { groups: g, hiddenList: hid, snoozedList: snz, total: t };
  }, [allGroups, hidden, snoozed]);

  const anyAnalyzed = ORDER.reduce((s, k) => s + allGroups[k].length, 0) > 0;

  // Exercise whose chart popup is open (click a row name to open).
  const [chartExercise, setChartExercise] = useState(null);
  useEffect(() => {
    if (!chartExercise) return;
    const onKey = (e) => { if (e.key === 'Escape') setChartExercise(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chartExercise]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Exercise Progress Tracker</h2>
          <p className={styles.subtitle}>Every exercise you've logged in the last 2 months, by whether it's progressing.</p>
        </div>
        <div className={styles.headerRight}>
          <label className={styles.intentPicker}>
            <span className={styles.intentLabel}>Training intent</span>
            <select
              className={styles.intentSelect}
              value={intent}
              onChange={e => changeIntent(e.target.value)}
              title="On a deload or maintenance block, planned dips aren't reported as regressions."
            >
              {INTENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <span className={styles.legendNote}>Past {WINDOW_DAYS} days · est. 1RM (Epley) · trend line</span>
        </div>
      </div>

      {/* Default-collapsed explanation of the categorization method. */}
      <details className={styles.methodology}>
        <summary className={styles.methodologySummary}>How are exercises categorized?</summary>
        <div className={styles.methodologyBody}>
          <p>
            <strong>Estimated 1RM (e1RM)</strong> is your <em>one-rep max</em> — the most weight you could
            lift for a single rep. Since you rarely test a true max, we estimate it with the{' '}
            <strong>Epley formula</strong>: <code>weight × (1 + reps ÷ 30)</code>, taking the{' '}
            <em>best set of the session</em> (a lighter set for more reps can imply a higher max than a
            heavy triple). This puts every set on one scale, so a 3×8 at 150&nbsp;lb and a 5×5 at
            165&nbsp;lb can be compared directly. Reps are capped at {EPLEY_REP_CAP} in the formula, since
            past that Epley inflates fast and a high-rep burnout set would fake a PR.
          </p>
          <p>
            <strong>Training volume</strong> — weight × reps summed across your sets — is the secondary
            signal (total work done).
          </p>
          <p>
            Over the past <strong>{WINDOW_DAYS} days</strong>, we fit a <strong>trend line</strong> through
            every session's e1RM (a least-squares regression) and read off the change it implies across the
            window. Using the whole line rather than comparing two halves means one unusual session can't
            flip the verdict:
          </p>
          <ul className={styles.methodologyList}>
            <li><strong style={{ color: '#16a34a' }}>Progressing</strong> — the trend implies ≥{PROGRESS_PCT * 100}% e1RM growth, <em>or</em> e1RM is flat while volume climbs ≥{VOLUME_PCT * 100}% (you've added work).</li>
            <li><strong style={{ color: '#dc2626' }}>Decreasing</strong> — the trend implies ≥{PROGRESS_PCT * 100}% e1RM <em>decline</em>. Extra volume doesn't cancel this out; it's noted alongside instead.</li>
            <li><strong style={{ color: '#d97706' }}>Stagnating</strong> — e1RM within ±{PROGRESS_PCT * 100}%: flat, no added stimulus. A volume drop of ≥{VOLUME_DROP_PCT * 100}% is flagged as <em>volume down</em>.</li>
            <li><strong style={{ color: '#7c3aed' }}>Deload</strong> / <strong style={{ color: '#0891b2' }}>Maintaining</strong> — you've set your training intent above, so planned dips aren't reported as regressions.</li>
            <li><strong style={{ color: '#64748b' }}>No Baseline</strong> — needs {MIN_SESSIONS}+ sessions spread over {MIN_SPAN_DAYS}+ days. Either it's new, or it's logged too sparsely to read a trend.</li>
          </ul>
          <p>
            Each exercise is only ever in <strong>one</strong> category: the e1RM trend decides, and volume
            can only ever promote a flat lift to Progressing. A wandering, low-confidence trend is left as
            Stagnating rather than flip-flopping week to week.
          </p>
          <p>
            <strong>Bodyweight moves</strong> (pull-ups, dips) are scored on bodyweight + any added load
            when we know your bodyweight, and on max reps when we don't. <strong>Timed holds</strong>{' '}
            (planks) trend on your longest hold. The <strong>days-ago</strong> note under each date turns
            amber once you've gone more than twice that exercise's usual gap between sessions.
          </p>
        </div>
      </details>

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
            {/* Its own row, above Hidden: these are coming back on a date, and
                the date is the whole point of having parked them. */}
            {snoozedList.length > 0 && (
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel} style={{ '--status-color': '#f59e0b' }}>
                  Parked
                  <span className={styles.summaryCount}>{snoozedList.length}</span>
                </span>
                <div className={styles.chips}>
                  {snoozedList.map(r => {
                    const left = daysUntil(r.until);
                    return (
                      <button
                        key={r.name}
                        type="button"
                        className={styles.chipSnoozed}
                        title={`Back on ${r.until} — click to bring it back now`}
                        onClick={() => setSnoozedName(r.name, false)}
                      >
                        {r.name}
                        <span className={styles.chipDays}>{left}d</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
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
          <p className={styles.hint}>
            <strong>{SNOOZE_DAYS}d</strong> parks an exercise for {SNOOZE_DAYS} days and it comes back on its own;
            {' '}<strong>✕</strong> hides it for good
            {hiddenList.length + snoozedList.length > 0 ? '. Click any chip above to bring one back now.' : '.'}
          </p>

          {total === 0 ? (
            <div className={styles.empty}>All analyzed exercises are hidden. Restore one above to see it here.</div>
          ) : ORDER.filter(s => groups[s].length > 0).map(status => (
            <StatusSection
              key={status}
              status={status}
              rows={groups[status]}
              unit={weightUnit}
              onHide={(n) => setHiddenName(n, true)}
              onSnooze={(n) => setSnoozedName(n, true)}
              onOpenChart={setChartExercise}
            />
          ))}
        </>
      )}

      {chartExercise && (
        <div className={styles.modalOverlay} onClick={() => setChartExercise(null)} role="dialog" aria-modal="true">
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{chartExercise}</h3>
              <button className={styles.modalClose} onClick={() => setChartExercise(null)} aria-label="Close chart">×</button>
            </div>
            <ExerciseChart workouts={workouts} exercise={chartExercise} weightUnit={weightUnit} />
          </div>
        </div>
      )}
    </div>
  );
}
