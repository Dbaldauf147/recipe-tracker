// "Weekly" subtab of the Workout page: three week-over-week overload checks —
// top weight +3% per lift, working sets +10% per muscle group, and ≥10 working
// sets per muscle group (15–20 = advanced). Primary muscles only. Analysis
// lives in utils/weeklyOverload.js.
import React, { useEffect, useMemo, useState } from 'react';
import styles from './WeeklyOverload.module.css';
import {
  analyzeWeeklyOverload, volumeVerdict, weightVerdict, averageWeeklyWeightPct,
  WEIGHT_TARGET_PCT, VOLUME_TARGET_PCT, MIN_WEEKLY_SETS, ADVANCED_MIN_SETS, ADVANCED_MAX_SETS,
} from '../utils/weeklyOverload';
import { displayWeight } from '../utils/exerciseProgress';

const HOME_GYM_KEY = 'sunday-weekly-overload-home-gym-only';

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
const WEIGHT_LABEL = {
  hit: `+${WEIGHT_TARGET_PCT * 100}% ✓`, up: 'Up, under 3%', flat: 'Same weight', down: 'Down', new: 'First time', deload: 'Deload',
};
const WEIGHT_ORDER = { hit: 0, up: 1, flat: 2, down: 3, new: 4, deload: 5 };

function Chip({ tone, children, title }) {
  return <span className={`${styles.chip} ${styles[tone] || ''}`} title={title}>{children}</span>;
}

const VOLUME_TONE = { hit: 'good', miss: 'bad', new: 'info', none: 'muted', deload: 'muted' };
const WEIGHT_TONE = { hit: 'good', up: 'warn', flat: 'muted', down: 'bad', new: 'info', deload: 'muted' };
const BAND_TONE = { below: 'bad', min: 'good', advanced: 'adv', over: 'warn' };

export default function WeeklyOverload({ workouts = [], weightUnit = 'lb', exerciseLibrary = [] }) {
  const [homeGymOnly, setHomeGymOnly] = useState(() => {
    try { return localStorage.getItem(HOME_GYM_KEY) !== 'false'; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(HOME_GYM_KEY, String(homeGymOnly)); } catch { /* ignore */ } }, [homeGymOnly]);

  const data = useMemo(
    () => analyzeWeeklyOverload(workouts, { exerciseLibrary, homeGymOnly }),
    [workouts, exerciseLibrary, homeGymOnly],
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
  const liftRows = useMemo(() => data.lifts
    .map(l => ({ ...l, v: weightVerdict(l.topLb, weeks, evalIndex), avg: averageWeeklyWeightPct(l.topLb, weeks, evalIndex) }))
    .filter(l => l.v.status !== 'none')
    .sort((a, b) => WEIGHT_ORDER[a.v.status] - WEIGHT_ORDER[b.v.status] || a.name.localeCompare(b.name)),
  [data.lifts, weeks, evalIndex]);
  const skippedLifts = data.lifts.length - liftRows.length;

  const w = lb => displayWeight(lb, weightUnit);
  const unit = weightUnit === 'kg' ? 'kg' : 'lb';

  const judgedLifts = liftRows.filter(l => ['hit', 'up', 'flat', 'down'].includes(l.v.status));
  const judgedMuscles = muscleRows.filter(m => m.v.status === 'hit' || m.v.status === 'miss');
  const trained = muscleRows.filter(m => m.v.cur > 0);

  if (data.muscles.length === 0 && data.lifts.length === 0) {
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
          {data.homeGym && (
            <label className={styles.toggle} title="Weight check only: sessions at other gyms are different equipment. Sets count everywhere.">
              <input type="checkbox" checked={homeGymOnly} onChange={e => setHomeGymOnly(e.target.checked)} />
              <span>{data.homeGym} only</span>
            </label>
          )}
        </div>
      </div>

      {evalWeek.deload && (
        <div className={styles.banner}>This was a deload week, so it isn&rsquo;t judged — lighter is the point. Pick another week, or the next week will be compared with the last normal one.</div>
      )}

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Weight +{WEIGHT_TARGET_PCT * 100}% / wk</div>
          <div className={styles.tileValue}>{judgedLifts.filter(l => l.v.status === 'hit').length}<span className={styles.tileUnit}> / {judgedLifts.length}</span></div>
          <div className={styles.tileNote}>lifts compared with a previous week</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Sets +{VOLUME_TARGET_PCT * 100}% / wk</div>
          <div className={styles.tileValue}>{judgedMuscles.filter(m => m.v.status === 'hit').length}<span className={styles.tileUnit}> / {judgedMuscles.length}</span></div>
          <div className={styles.tileNote}>muscle groups</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>{MIN_WEEKLY_SETS}+ sets / muscle</div>
          <div className={styles.tileValue}>{trained.filter(m => m.v.cur >= MIN_WEEKLY_SETS).length}<span className={styles.tileUnit}> / {trained.length}</span></div>
          <div className={styles.tileNote}>muscle groups trained</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Advanced ({ADVANCED_MIN_SETS}–{ADVANCED_MAX_SETS})</div>
          <div className={styles.tileValue}>{trained.filter(m => m.v.band === 'advanced').length}</div>
          <div className={styles.tileNote}>muscle groups in the band</div>
        </div>
      </div>

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
        {data.unmapped.length > 0 && (
          <p className={styles.warnNote}>
            Not counted — no primary muscle set: {data.unmapped.map(u => `${u.name} (${u.sets})`).join(', ')}.
            Fill in the Primary column for these on the Exercises tab.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Top working weight per lift</h3>
        {liftRows.length === 0 ? (
          <p className={styles.footnote}>No loaded lifts logged in the week of {fmtDate(evalWeek.start)}.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Lift</th>
                  <th className={styles.num}>Before</th>
                  <th className={styles.num}>This week</th>
                  <th className={styles.num}>Per week</th>
                  <th className={styles.num} title="Compounded weekly change from the first to the last week this lift appears in the window">{weeks.length - 1}-wk avg</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {liftRows.map(l => (
                  <tr key={l.name}>
                    <td>
                      <div className={styles.liftName}>{l.name}</div>
                      {l.muscles.length > 0 && <div className={styles.rowNote}>{l.muscles.join(', ')}</div>}
                    </td>
                    <td className={styles.num}>
                      {l.v.prev ? <>{w(l.v.prev)} {unit}<div className={styles.rowNote}>{fmtDate(weeks[l.v.prevIndex].start)}{l.v.gap > 1 ? ` · ${l.v.gap} wks` : ''}</div></> : <span className={styles.dim}>—</span>}
                    </td>
                    <td className={styles.num}>{w(l.v.cur)} {unit}</td>
                    <td className={styles.num}>
                      {l.v.weeklyPct != null
                        ? <span className={l.v.weeklyPct >= WEIGHT_TARGET_PCT - 1e-9 ? styles.up : l.v.weeklyPct < 0 ? styles.down : styles.flat}>{fmtPct(l.v.weeklyPct)}</span>
                        : <span className={styles.dim}>—</span>}
                    </td>
                    <td className={styles.num}>{l.avg != null ? fmtPct(l.avg) : <span className={styles.dim}>—</span>}</td>
                    <td><Chip tone={WEIGHT_TONE[l.v.status]}>{WEIGHT_LABEL[l.v.status]}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.footnote}>
          Heaviest completed set each week (per-arm loads doubled). A lift last done several weeks ago needs {WEIGHT_TARGET_PCT * 100}% per week compounded over the gap.
          Deload sessions{homeGymOnly && data.homeGym ? ` and sessions away from ${data.homeGym}` : ''} don&rsquo;t set the weight.
          {skippedLifts > 0 ? ` ${skippedLifts} other lift${skippedLifts === 1 ? '' : 's'} weren’t done this week.` : ''}
        </p>
      </section>
    </div>
  );
}
