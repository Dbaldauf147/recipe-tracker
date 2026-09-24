// Front/back body map of what one stretch routine lengthens, shaded by how long
// each muscle is held in a single run. Same react-body-highlighter model as the
// Workout heatmap and the exercise popup, so it reads as the same body.
import { useMemo, useState } from 'react';
import Model from 'react-body-highlighter';
import styles from './StretchRoutines.module.css';
import { normalizeRoutine, mmss } from '../utils/stretchRoutine';
import { routineMuscleSeconds } from '../utils/stretchMuscles';

// Light → dark: the longest-held muscle in the routine is the darkest, so the
// map answers "where does this routine spend its time?" rather than just
// "what does it touch?".
const RAMP = ['#CFDFEE', '#A8C4DE', '#5A85B5', '#3B6B9C'];
const BODY_COLOR = '#EBF0F5';

const LABELS = {
  chest: 'Chest', obliques: 'Obliques', abs: 'Abs', biceps: 'Biceps', triceps: 'Triceps',
  neck: 'Neck', trapezius: 'Traps', 'upper-back': 'Upper back', 'lower-back': 'Lower back',
  'front-deltoids': 'Front delts', 'back-deltoids': 'Rear delts', adductor: 'Adductors',
  hamstring: 'Hamstrings', quadriceps: 'Quads', abductors: 'Abductors', calves: 'Calves',
  gluteal: 'Glutes', forearm: 'Forearms', 'left-soleus': 'Soleus', 'right-soleus': 'Soleus',
};

/**
 * `poseMuscles(name)` → this model's muscle ids for a pose (the caller knows
 * the exercise library). `routine` may be the editor's in-progress copy, with
 * numbers still mid-typing — it's normalized here before being timed.
 */
export function RoutineMuscleMap({ routine, poseMuscles }) {
  const [selected, setSelected] = useState(null);

  const { rows, data, unmapped } = useMemo(() => {
    const r = normalizeRoutine(routine) || routine;
    const { muscles, unmapped } = routineMuscleSeconds(r, poseMuscles);
    // The two soleus halves are one muscle to a reader.
    const merged = {};
    for (const [id, m] of Object.entries(muscles)) {
      const label = LABELS[id] || id;
      const row = merged[label] || (merged[label] = { label, ids: [], seconds: 0, poses: [] });
      row.ids.push(id);
      row.seconds = Math.max(row.seconds, m.seconds);
      for (const p of m.poses) if (!row.poses.includes(p)) row.poses.push(p);
    }
    const rows = Object.values(merged).sort((a, b) => b.seconds - a.seconds);
    const max = rows[0]?.seconds || 1;
    const data = rows.map(row => ({
      name: row.label,
      muscles: row.ids,
      frequency: Math.max(1, Math.ceil((row.seconds / max) * RAMP.length)),
    }));
    return { rows, data, unmapped };
  }, [routine, poseMuscles]);

  if (!routine?.steps?.length) return null;

  const active = rows.find(r => r.label === selected) || null;
  const pick = (stat) => {
    const label = LABELS[stat?.muscle];
    setSelected(s => (label && s !== label ? label : null));
  };

  return (
    <div className={styles.muscleCard}>
      <div className={styles.muscleHead}>
        <span className={styles.goalTitle}>Muscles stretched</span>
        <span className={styles.unit}>darker = held longer, per run</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.empty}>
          Can’t tell which muscles these poses stretch yet. Fill in the Primary/Secondary
          muscle columns for them on the Exercises tab and they’ll show up here.
        </div>
      ) : (
        <>
          <div className={styles.muscleBodies}>
            <div className={styles.muscleBodyCol}>
              <Model data={data} type="anterior" bodyColor={BODY_COLOR} highlightedColors={RAMP}
                style={{ width: '100%' }} onClick={pick} />
              <span className={styles.muscleBodyLabel}>Front</span>
            </div>
            <div className={styles.muscleBodyCol}>
              <Model data={data} type="posterior" bodyColor={BODY_COLOR} highlightedColors={RAMP}
                style={{ width: '100%' }} onClick={pick} />
              <span className={styles.muscleBodyLabel}>Back</span>
            </div>
          </div>
          {/* The same thing as a list — a body map alone can't say how long,
              and some muscles (adductors, obliques) are hard to spot on it. */}
          <div className={styles.muscleChips}>
            {rows.map(r => (
              <button
                key={r.label}
                type="button"
                className={`${styles.muscleChip} ${selected === r.label ? styles.muscleChipOn : ''}`}
                onClick={() => setSelected(s => (s === r.label ? null : r.label))}
              >
                {r.label} <span className={styles.muscleChipTime}>{mmss(r.seconds)}</span>
              </button>
            ))}
          </div>
          {active && (
            <div className={styles.poseHint}>
              <strong>{active.label}</strong> — {mmss(active.seconds)} from {active.poses.join(', ')}
            </div>
          )}
        </>
      )}
      {rows.length > 0 && unmapped.length > 0 && (
        <div className={styles.poseHint}>
          Not on the map: {unmapped.join(', ')} — add muscles for {unmapped.length === 1 ? 'it' : 'them'} on
          the Exercises tab.
        </div>
      )}
    </div>
  );
}
