import { useMemo, useState } from 'react';
import Model from 'react-body-highlighter';
import styles from './BodyHeatmap.module.css';

// Workout MUSCLE_GROUP -> library muscle names. Used as a fallback when an
// entry's exercise can't be matched to the library's per-exercise muscle data.
const GROUP_MUSCLES = {
  Chest: ['chest'],
  Back: ['trapezius', 'upper-back', 'lower-back'],
  Shoulders: ['front-deltoids', 'back-deltoids'],
  Biceps: ['biceps'],
  Triceps: ['triceps'],
  Abs: ['abs', 'obliques'],
  Forearms: ['forearm'],
  Legs: ['quadriceps', 'hamstring', 'gluteal', 'calves', 'adductor', 'abductors'],
};

// Map a free-text muscle name (from the Exercises library's primary/secondary
// columns) to library muscle ids. Best-effort regex matching.
function nameToMuscles(raw) {
  const m = (raw || '').toLowerCase().trim();
  if (!m) return [];
  const out = new Set();
  if (/pec|chest/.test(m)) out.add('chest');
  if (/lat\b|latissimus/.test(m)) out.add('upper-back');
  if (/rhomboid|mid[- ]?back|middle back|upper back/.test(m)) out.add('upper-back');
  if (/trap/.test(m)) out.add('trapezius');
  if (/lower back|erector|spinae/.test(m)) out.add('lower-back');
  if (/anterior delt|front delt/.test(m)) out.add('front-deltoids');
  if (/posterior delt|rear delt|back delt/.test(m)) out.add('back-deltoids');
  if (/lateral delt|side delt|medial delt/.test(m)) {
    out.add('front-deltoids');
    out.add('back-deltoids');
  }
  if (out.size === 0 && /delt|shoulder/.test(m)) {
    out.add('front-deltoids');
    out.add('back-deltoids');
  }
  if (/bicep/.test(m)) out.add('biceps');
  if (/tricep/.test(m)) out.add('triceps');
  if (/forearm|brachiorad/.test(m)) out.add('forearm');
  if (/abs\b|abdominal|rectus abdom|^core$/.test(m)) out.add('abs');
  if (/oblique/.test(m)) out.add('obliques');
  if (/quad|rectus femoris|vastus/.test(m)) out.add('quadriceps');
  if (/glute|buttock|gluteus/.test(m)) out.add('gluteal');
  if (/ham|biceps femoris|semitend|semimemb/.test(m)) out.add('hamstring');
  if (/calf|calves|gastroc/.test(m)) out.add('calves');
  if (/soleus/.test(m)) {
    out.add('left-soleus');
    out.add('right-soleus');
  }
  if (/adductor/.test(m)) out.add('adductor');
  if (/abductor/.test(m)) out.add('abductors');
  return Array.from(out);
}

function splitMuscles(s) {
  return String(s || '').split(/[,;/&]/).map(x => x.trim()).filter(Boolean);
}

const WINDOWS = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

function inWindow(dateStr, days) {
  if (days == null) return true;
  if (!dateStr) return false;
  const cutoff = Date.now() - days * 86400000;
  const t = new Date(dateStr + 'T00:00:00').getTime();
  return !isNaN(t) && t >= cutoff;
}

// 6-step accent ramp used for frequency-based shading. The library picks
// highlightedColors[min(len-1, freq-1)], so freq=1 -> first chip, freq>=6 -> last.
const HIGHLIGHTED_COLORS = ['#CFDFEE', '#A8C4DE', '#7FA5CB', '#5A85B5', '#3F7AB0', '#3B6B9C'];
const BODY_COLOR = '#EBF0F5';

export function BodyHeatmap({ workouts, exerciseLibrary }) {
  const [windowId, setWindowId] = useState('30d');
  const [selected, setSelected] = useState(null); // { muscle, data: { exercises, frequency } }
  const win = WINDOWS.find(w => w.id === windowId) || WINDOWS[1];

  const libByExercise = useMemo(() => {
    const map = {};
    for (const item of exerciseLibrary || []) {
      if (!item?.exercise) continue;
      const key = item.exercise.trim().toLowerCase();
      const primary = splitMuscles(item.primaryMuscles).flatMap(nameToMuscles);
      const secondary = splitMuscles(item.secondaryMuscles).flatMap(nameToMuscles);
      map[key] = { primary, secondary };
    }
    return map;
  }, [exerciseLibrary]);

  // Build the library's expected `data` shape: one entry per logged
  // (workout, exercise) pair within the window. Primary muscles get
  // frequency 2, secondary get 1, so primaries shade twice as fast.
  const exerciseData = useMemo(() => {
    const items = [];
    for (const w of workouts || []) {
      if (!inWindow(w.date, win.days)) continue;
      for (const e of w.entries || []) {
        if (!e.exercise) continue;
        const key = e.exercise.trim().toLowerCase();
        const lib = libByExercise[key];
        if (lib && (lib.primary.length || lib.secondary.length)) {
          if (lib.primary.length) {
            items.push({ name: e.exercise, muscles: lib.primary, frequency: 2 });
          }
          if (lib.secondary.length) {
            items.push({ name: e.exercise, muscles: lib.secondary, frequency: 1 });
          }
        } else {
          const grpMuscles = GROUP_MUSCLES[e.group];
          if (grpMuscles) items.push({ name: e.exercise, muscles: grpMuscles, frequency: 1 });
        }
      }
    }
    return items;
  }, [workouts, win.days, libByExercise]);

  const totalEngagements = useMemo(
    () => exerciseData.reduce((acc, it) => acc + it.muscles.length * (it.frequency || 1), 0),
    [exerciseData]
  );

  const sessionCount = useMemo(() => {
    const dates = new Set();
    for (const w of workouts || []) {
      if (inWindow(w.date, win.days)) dates.add(w.date);
    }
    return dates.size;
  }, [workouts, win.days]);

  function handleClick(stat) {
    setSelected(stat);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <span className={styles.controlsLabel}>Window</span>
        {WINDOWS.map(w => (
          <button
            key={w.id}
            type="button"
            className={`${styles.windowBtn} ${windowId === w.id ? styles.windowBtnActive : ''}`}
            onClick={() => setWindowId(w.id)}
          >
            {w.label}
          </button>
        ))}
        <span className={styles.summary}>
          {sessionCount} session{sessionCount === 1 ? '' : 's'} · {totalEngagements} muscle-engagements
        </span>
      </div>

      <div className={styles.bodies}>
        <div className={styles.bodyCol}>
          <div className={styles.bodyLabel}>Front</div>
          <div className={styles.modelHolder}>
            <Model
              data={exerciseData}
              type="anterior"
              bodyColor={BODY_COLOR}
              highlightedColors={HIGHLIGHTED_COLORS}
              style={{ width: '100%' }}
              onClick={handleClick}
            />
          </div>
        </div>
        <div className={styles.bodyCol}>
          <div className={styles.bodyLabel}>Back</div>
          <div className={styles.modelHolder}>
            <Model
              data={exerciseData}
              type="posterior"
              bodyColor={BODY_COLOR}
              highlightedColors={HIGHLIGHTED_COLORS}
              style={{ width: '100%' }}
              onClick={handleClick}
            />
          </div>
        </div>
      </div>

      {selected && (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <strong className={styles.detailMuscle}>{selected.muscle}</strong>
            <span className={styles.detailFreq}>
              freq {selected.data?.frequency ?? 0} · {win.label}
            </span>
            <button type="button" className={styles.detailClose} onClick={() => setSelected(null)} aria-label="Close">×</button>
          </div>
          {selected.data?.exercises?.length > 0 ? (
            <ul className={styles.detailList}>
              {Array.from(new Set(selected.data.exercises)).map(ex => {
                const count = selected.data.exercises.filter(e => e === ex).length;
                return (
                  <li key={ex}>
                    {ex} {count > 1 && <span className={styles.detailCount}>×{count}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.detailEmpty}>No exercises logged for this muscle in this window.</div>
          )}
        </div>
      )}

      <div className={styles.legend}>
        <span className={styles.legendLabel}>Less</span>
        <div className={styles.legendBar}>
          <div className={styles.legendChip} style={{ background: BODY_COLOR }} title="No work" />
          {HIGHLIGHTED_COLORS.map((c, i) => (
            <div key={i} className={styles.legendChip} style={{ background: c }} title={`Frequency ≥ ${i + 1}`} />
          ))}
        </div>
        <span className={styles.legendLabel}>More</span>
        <span className={styles.legendHint}>tap any muscle for details</span>
      </div>

      {totalEngagements === 0 && (
        <div className={styles.empty}>
          No workouts logged in this window. Switch to a longer window or log a workout to start filling in the heatmap.
        </div>
      )}
    </div>
  );
}
