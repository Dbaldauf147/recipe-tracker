// "Weekly" subtab of the Workout page: working sets per muscle group, week
// over week — +10% per week, and ≥10 working sets (15–20 = advanced). Primary
// muscles only. Analysis lives in utils/weeklyOverload.js.
import React, { useMemo, useState } from 'react';
import styles from './WeeklyOverload.module.css';
import {
  analyzeWeeklyOverload, volumeVerdict,
  VOLUME_TARGET_PCT, MIN_WEEKLY_SETS, ADVANCED_MIN_SETS, ADVANCED_MAX_SETS,
} from '../utils/weeklyOverload';

function fmtDate(key) {
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const fmtPct = p => `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`;

const BAND_LABEL = {
  below: `Under ${MIN_WEEKLY_SETS}`,
  min: `${MIN_WEEKLY_SETS}+ sets`,
  advanced: 'Advanced',
  over: `Over ${ADVANCED_MAX_SETS}`,
};

const VOLUME_LABEL = {
  hit: `+${VOLUME_TARGET_PCT * 100}% ✓`, miss: 'Missed', new: 'First week', none: 'Not trained', deload: 'Deload',
};

function Chip({ tone, children, title }) {
  return <span className={`${styles.chip} ${styles[tone] || ''}`} title={title}>{children}</span>;
}

const VOLUME_TONE = { hit: 'good', miss: 'bad', new: 'info', none: 'muted', deload: 'muted' };
const BAND_TONE = { below: 'bad', min: 'good', advanced: 'adv', over: 'warn' };

export default function WeeklyOverload({ workouts = [], exerciseLibrary = [] }) {
  const data = useMemo(
    () => analyzeWeeklyOverload(workouts, { exerciseLibrary }),
    [workouts, exerciseLibrary],
  );
  const { weeks } = data;

  // Which complete week to judge. Stored as the week's Sunday so it survives
  // the data refreshing underneath it; falls back to the last complete week.
  const [pickedStart, setPickedStart] = useState(null);
  const evalIndex = useMemo(() => {
    const i = pickedStart ? weeks.findIndex(w => w.start === pickedStart && !w.current) : -1;
    return i >= 1 ? i : data.evalIndex;
  }, [pickedStart, weeks, data.evalIndex]);
  const evalWeek = weeks[evalIndex];
  const [openMuscle, setOpenMuscle] = useState(null);

  const muscleRows = useMemo(
    () => data.muscles.map(m => ({ ...m, v: volumeVerdict(m.sets, weeks, evalIndex) })),
    [data.muscles, weeks, evalIndex],
  );
  if (data.muscles.length === 0) {
    return (
      <div className={styles.empty}>
        <p><strong>No strength work logged in the last {weeks.length - 1} weeks.</strong></p>
        <p>Log a few workouts and this tab will compare each week with the one before.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Weekly Overload</h2>
          <p className={styles.subtitle}>
            Week of {fmtDate(evalWeek.start)}–{fmtDate(evalWeek.end)} against the week before.
            Primary muscles only; secondary muscles aren&rsquo;t counted.
          </p>
        </div>
        <div className={styles.controls}>
          <label className={styles.control}>
            <span className={styles.controlLabel}>Week</span>
            <select className={styles.select} value={evalWeek.start} onChange={e => setPickedStart(e.target.value)}>
              {weeks.slice(1).filter(x => !x.current).reverse().map(x => (
                <option key={x.start} value={x.start}>
                  {fmtDate(x.start)} – {fmtDate(x.end)}{x.deload ? ' (deload)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {evalWeek.deload && (
        <div className={styles.banner}>This was a deload week, so it isn&rsquo;t judged — lighter is the point. Pick another week, or the next week will be compared with the last normal one.</div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Working sets per muscle group</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Muscle</th>
                {weeks.map((x, i) => (
                  <th key={x.start} className={`${styles.num} ${i === evalIndex ? styles.evalCol : ''}`} title={`${fmtDate(x.start)} – ${fmtDate(x.end)}`}>
                    {x.current ? 'This wk' : fmtDate(x.start)}{x.deload ? ' 🔻' : ''}
                  </th>
                ))}
                <th>Sets</th>
                <th>vs prev week</th>
              </tr>
            </thead>
            <tbody>
              {muscleRows.map(m => (
                <React.Fragment key={m.key}>
                  <tr>
                    <td>
                      <button type="button" className={styles.nameBtn} onClick={() => setOpenMuscle(openMuscle === m.key ? null : m.key)}>
                        {m.label}
                      </button>
                      <div className={styles.rowNote}>{m.exercises.length} exercise{m.exercises.length === 1 ? '' : 's'}</div>
                    </td>
                    {m.sets.map((s, i) => (
                      <td key={i} className={`${styles.num} ${i === evalIndex ? styles.evalCol : ''} ${weeks[i].current ? styles.dim : ''}`}>
                        <span className={`${styles.cell} ${s ? styles['band_' + (weeks[i].current ? 'cur' : volumeVerdict(m.sets, weeks, i).band)] : ''}`}>{s || '·'}</span>
                      </td>
                    ))}
                    <td><Chip tone={m.v.cur ? BAND_TONE[m.v.band] : 'muted'}>{m.v.cur ? BAND_LABEL[m.v.band] : '—'}</Chip></td>
                    <td>
                      <Chip tone={VOLUME_TONE[m.v.status]}>{VOLUME_LABEL[m.v.status]}</Chip>
                      {m.v.pct != null && (
                        <div className={styles.rowNote}>{m.v.prev} → {m.v.cur} sets ({fmtPct(m.v.pct)})</div>
                      )}
                    </td>
                  </tr>
                  {openMuscle === m.key && (
                    <tr className={styles.detailRow}>
                      <td colSpan={weeks.length + 3}>{m.exercises.join(' · ')}</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.footnote}>
          A working set is a filled set you ticked done (or every filled set if none on that exercise were ticked); stretches are left out.
          Bands: under {MIN_WEEKLY_SETS} · {MIN_WEEKLY_SETS}–{ADVANCED_MIN_SETS - 1} meets the minimum · {ADVANCED_MIN_SETS}–{ADVANCED_MAX_SETS} advanced · over {ADVANCED_MAX_SETS}.
          The comparison skips weeks the muscle wasn&rsquo;t trained and deload weeks.
        </p>
      </section>
    </div>
  );
}
