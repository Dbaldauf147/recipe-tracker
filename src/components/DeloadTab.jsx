// Workout → Deload tab: train N weeks, then a deload ROUND — the next session
// of each deload type (Push / Pull / Legs / Full Body by default) is a lighter
// one, and the next block starts the day after the last. Settings live in
// `deloadSettings` on the user doc (shared with the phone); the math is in
// utils/deload.js. For a type still due in the round, the Log tab prefills weights at
// weightPct% of the latest normal session with `setCut` fewer sets and
// (100 − repCutPct)% of the reps per set (default: Dr. Andy Galpin's 5 weeks /
// 70% / 1 fewer set / 80% of the reps), and saves the workout with `deload: true` so 1RM progress and PRs skip it.
// ⚠️ Mirrors PrepDay/src/components/DeloadView.tsx.
import styles from './DeloadTab.module.css';
import { displayWeight } from '../utils/exerciseProgress';
import {
  addDays, applyDeloadToEntry, defaultDeloadSettings, deloadRound, isRecommendedDeload, skipRoundTypes, startRoundOn,
  unskipRoundType,
} from '../utils/deload';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
const pad2 = (n) => String(n).padStart(2, '0');
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

export function DeloadTab({ settings, onChange, weightUnit = 'lb', workouts = [], workoutTypes = [] }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const today = todayKey();
  const round = deloadRound(settings, workouts, today);
  // Your workout types plus any chosen type you no longer have, so a pick
  // never silently disappears from the list.
  const typeChoices = [...workoutTypes];
  for (const t of settings.types) if (!typeChoices.some(x => x.toLowerCase() === t.toLowerCase())) typeChoices.push(t);
  const typeOn = (t) => settings.types.some(x => x.toLowerCase() === t.toLowerCase());
  const toggleType = (t) => set({ types: typeOn(t) ? settings.types.filter(x => x.toLowerCase() !== t.toLowerCase()) : [...settings.types, t] });
  const example = applyDeloadToEntry({ sets: ['10', '10', '10', '10', '10'], weight: '135' }, settings);
  const exampleSets = example.sets.filter(x => x !== '');
  const recommended = defaultDeloadSettings();

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <label className={styles.rowBetween}>
          <span>
            <span className={styles.title}>Deload rounds</span>
            <span className={styles.muted}>After every few weeks of training, one lighter session of each workout type.</span>
          </span>
          <input type="checkbox" className={styles.toggle} checked={settings.enabled}
            onChange={e => set({ enabled: e.target.checked })} />
        </label>
        <div className={styles.note}>
          💡 Default follows Dr. Andy Galpin's recommendation: train 5 weeks, then deload at 70% of your weight, 1 fewer set and 80% of your usual reps.
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
          <div className={`${styles.card} ${round.phase === 'round' ? styles.cardDeload : ''}`}>
            {round.phase === 'round' ? (
              <>
                <div className={styles.label}>Deload round · since {dayLabel(round.roundStart)}</div>
                <div className={styles.status}>🔻 {round.pending.length} to go</div>
                <ul className={styles.typeList}>
                  {round.done.map(d => (
                    <li key={d.type} className={styles.typeDone}>✓ {d.type} <span className={styles.mutedInline}>{dayLabel(d.date)}</span></li>
                  ))}
                  {round.skipped.map(t => (
                    <li key={t} className={styles.typeSkipped}>
                      – {t} <span className={styles.mutedInline}>skipped</span>
                      <button type="button" className={styles.inlineLink} onClick={() => onChange(unskipRoundType(settings, round.roundStart, t))}>Undo</button>
                    </li>
                  ))}
                  {round.pending.map(t => (
                    <li key={t}>
                      ○ {t} <span className={styles.mutedInline}>next {t} session is a deload</span>
                      <button type="button" className={styles.inlineLink} onClick={() => onChange(skipRoundTypes(settings, round.roundStart, [t], today))}>Skip</button>
                    </li>
                  ))}
                </ul>
                <button type="button" className={styles.btn}
                  onClick={() => onChange(skipRoundTypes(settings, round.roundStart, round.pending, today))}>
                  End this round
                </button>
              </>
            ) : (
              <>
                <div className={styles.label}>Training · week {round.week} of {settings.trainWeeks}</div>
                <div className={styles.status}>Deload round starts {dayLabel(round.roundStart)}</div>
                <button type="button" className={styles.btn} onClick={() => onChange(startRoundOn(settings, today))}>
                  Start a deload round now
                </button>
              </>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.rowBetween}>
              <span className={styles.label}>Train for</span>
              <Stepper label="training weeks" value={settings.trainWeeks} onChange={n => set({ trainWeeks: n })}
                step={1} min={1} max={52} suffix={settings.trainWeeks === 1 ? ' week' : ' weeks'} />
            </div>
            <div className={styles.muted}>…then one deload session of each type below, and repeat.</div>
            {round.phase === 'training' && (
              <>
                <div className={`${styles.rowBetween} ${styles.gap}`}>
                  <span className={styles.label}>Block started</span>
                  <div className={styles.stepper}>
                    <button type="button" className={styles.stepBtn} aria-label="A week earlier"
                      onClick={() => set({ anchor: addDays(settings.anchor, -7) })}>‹</button>
                    <span className={styles.stepValueWide}>{dayLabel(round.blockStart)}</span>
                    <button type="button" className={styles.stepBtn} aria-label="A week later"
                      onClick={() => set({ anchor: addDays(settings.anchor, 7) })}>›</button>
                  </div>
                </div>
                {round.blockStart !== today && (
                  <button type="button" className={styles.link} onClick={() => set({ anchor: today, roundSkips: {} })}>
                    Start a new block today
                  </button>
                )}
              </>
            )}

            <div className={`${styles.label} ${styles.gap}`}>Deload each of</div>
            <div className={styles.chips}>
              {typeChoices.map(t => (
                <button key={t} type="button" className={`${styles.chip} ${typeOn(t) ? styles.chipOn : ''}`}
                  aria-pressed={typeOn(t)} onClick={() => toggleType(t)}>{t}</button>
              ))}
            </div>
            <div className={styles.muted}>A round ends once each of these has had its deload session.</div>
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

          <p className={styles.muted}>
            Deload sessions are tagged as deload. They stay in your history and charts (greyed out),
            but never count toward 1-rep-max progress or personal records.
          </p>
        </>
      )}
    </div>
  );
}
