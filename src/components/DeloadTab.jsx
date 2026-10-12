// Workout → Deload tab: train N weeks, then one lighter week. Settings live in
// `deloadSettings` on the user doc (shared with the phone); the math is in
// utils/deload.js. While a deload week is on, the Log tab prefills weights at
// weightPct% of the latest normal session with `setCut` fewer sets and
// (100 − repCutPct)% of the reps per set (default: Dr. Andy Galpin's 5 weeks /
// 70% / 1 fewer set / 80% of the reps), and saves the workout with `deload: true` so 1RM progress and PRs skip it.
// ⚠️ Mirrors PrepDay/src/components/DeloadView.tsx.
import styles from './DeloadTab.module.css';
import { displayWeight } from '../utils/exerciseProgress';
import {
  applyDeloadToEntry, defaultDeloadSettings, deloadWeekStart, isDeloadWeek, isRecommendedDeload, scheduledDeload,
  upcomingDeloadWeeks, withWeekOverride,
} from '../utils/deload';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function weekLabel(sunday) {
  const [y, m, d] = sunday.split('-').map(Number);
  const end = new Date(y, m - 1, d + 6);
  return `${MONTHS[m - 1]} ${d} – ${MONTHS[end.getMonth()]} ${end.getDate()}`;
}
function shiftWeek(sunday, weeks) {
  const [y, m, d] = sunday.split('-').map(Number);
  return deloadWeekStart(new Date(y, m - 1, d + 7 * weeks));
}

function Stepper({ value, onChange, step, min, max, suffix, label }) {
  return (
    <div className={styles.stepper}>
      <button type="button" className={styles.stepBtn} aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min}>−</button>
      <span className={styles.stepValue}>{value}{suffix || ''}</span>
      <button type="button" className={styles.stepBtn} aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max}>+</button>
    </div>
  );
}

export function DeloadTab({ settings, onChange, weightUnit = 'lb' }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const thisWeek = deloadWeekStart(new Date());
  const thisIsDeload = isDeloadWeek(settings, thisWeek);
  const upcoming = upcomingDeloadWeeks(settings, new Date(), 4);
  const example = applyDeloadToEntry({ sets: ['10', '10', '10', '10', '10'], weight: '135' }, settings);
  const exampleSets = example.sets.filter(x => x !== '');
  const recommended = defaultDeloadSettings();

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <label className={styles.rowBetween}>
          <span>
            <span className={styles.title}>Deload weeks</span>
            <span className={styles.muted}>One lighter week after every few weeks of training.</span>
          </span>
          <input type="checkbox" className={styles.toggle} checked={settings.enabled}
            onChange={e => set({ enabled: e.target.checked })} />
        </label>
        <div className={styles.note}>
          💡 Default follows Dr. Andy Galpin's recommendation: train 5 weeks, then deload for one week at 70% of your weight, 1 fewer set and 80% of your usual reps.
          {settings.enabled && !isRecommendedDeload(settings) && (
            <button type="button" className={styles.link} onClick={() => set({
              trainWeeks: recommended.trainWeeks, weightPct: recommended.weightPct,
              setCut: recommended.setCut, repCutPct: recommended.repCutPct,
            })}>Use Dr. Galpin's settings</button>
          )}
        </div>
      </div>

      {settings.enabled && (
        <>
          <div className={`${styles.card} ${thisIsDeload ? styles.cardDeload : ''}`}>
            <div className={styles.label}>This week · {weekLabel(thisWeek)}</div>
            <div className={styles.status}>{thisIsDeload ? '🔻 Deload week' : 'Normal training week'}</div>
            <button type="button" className={styles.btn}
              onClick={() => onChange(withWeekOverride(settings, thisWeek, !thisIsDeload))}>
              {thisIsDeload
                ? (scheduledDeload(settings, thisWeek) ? 'Skip this deload' : 'Back to a normal week')
                : 'Make this a deload week'}
            </button>
          </div>

          <div className={styles.card}>
            <div className={styles.rowBetween}>
              <span className={styles.label}>Train for</span>
              <Stepper label="training weeks" value={settings.trainWeeks} onChange={n => set({ trainWeeks: n })}
                step={1} min={1} max={52} suffix={settings.trainWeeks === 1 ? ' week' : ' weeks'} />
            </div>
            <div className={styles.muted}>…then 1 deload week, and repeat.</div>

            <div className={`${styles.rowBetween} ${styles.gap}`}>
              <span className={styles.label}>Cycle started</span>
              <div className={styles.stepper}>
                <button type="button" className={styles.stepBtn} aria-label="Previous week"
                  onClick={() => set({ anchor: shiftWeek(settings.anchor, -1) })}>‹</button>
                <span className={styles.stepValueWide}>{weekLabel(settings.anchor)}</span>
                <button type="button" className={styles.stepBtn} aria-label="Next week"
                  onClick={() => set({ anchor: shiftWeek(settings.anchor, 1) })}>›</button>
              </div>
            </div>
            {settings.anchor !== thisWeek && (
              <button type="button" className={styles.link} onClick={() => set({ anchor: thisWeek })}>
                Start the cycle this week
              </button>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.rowBetween}>
              <span className={styles.label}>Weight</span>
              <Stepper label="weight percent" value={settings.weightPct} onChange={n => set({ weightPct: n })}
                step={5} min={10} max={100} suffix="%" />
            </div>
            <div className={styles.muted}>of your latest normal (non-deload) weights</div>

            <div className={`${styles.rowBetween} ${styles.gap}`}>
              <span className={styles.label}>Fewer sets</span>
              <Stepper label="sets dropped" value={settings.setCut} onChange={n => set({ setCut: n })}
                step={1} min={0} max={10} suffix={settings.setCut === 1 ? ' set' : ' sets'} />
            </div>
            <div className={styles.muted}>per exercise (at least 1 set is always kept)</div>

            <div className={`${styles.rowBetween} ${styles.gap}`}>
              <span className={styles.label}>Reps</span>
              <Stepper label="reps percent" value={100 - settings.repCutPct} onChange={n => set({ repCutPct: 100 - n })}
                step={5} min={10} max={100} suffix="%" />
            </div>
            <div className={styles.muted}>of your usual reps in each set</div>
            <div className={`${styles.muted} ${styles.gap}`}>
              e.g. {displayWeight(135, weightUnit)} {weightUnit} × 5 sets of 10 → {displayWeight(example.weight, weightUnit)} {weightUnit} × {exampleSets.length} {exampleSets.length === 1 ? 'set' : 'sets'} of {exampleSets[0]}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.label}>Upcoming deload weeks</div>
            {upcoming.length === 0
              ? <div className={styles.muted}>None scheduled.</div>
              : <ul className={styles.list}>
                  {upcoming.map(w => <li key={w}>{weekLabel(w)}{w === thisWeek ? ' (this week)' : ''}</li>)}
                </ul>}
          </div>

          <p className={styles.muted}>
            Workouts saved in a deload week are tagged as deload. They stay in your history and charts (greyed out),
            but never count toward 1-rep-max progress or personal records.
          </p>
        </>
      )}
    </div>
  );
}
