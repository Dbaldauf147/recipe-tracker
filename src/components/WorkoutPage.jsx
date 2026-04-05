import { useState, useEffect, useMemo } from 'react';
import { saveField } from '../utils/firestoreSync';
import styles from './WorkoutPage.module.css';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Biceps', 'Triceps', 'Abs', 'Forearms', 'Cardio', 'Yoga', 'Whole Body'];

const EXERCISES_BY_GROUP = {
  Chest: ['Warm up', 'Butterfly', 'Cable crossover low to high', 'Cable flys declined', 'Chest press', 'Close grip bench press', 'Decline Barbell Press', 'Decline press', 'Decline push-up', 'Dips', 'Dumbbell flys', 'Dumbbell press', 'Dumbbell press inclined', 'Dumbbell squeeze press', 'Incline press', 'Incline push-up', 'Inclined Barbell Press', 'Inclined machine press', 'Inclined smith machine press'],
  Back: ['Warm up', 'Back extensions', 'Back extensions - machine', 'Bent-over dumbbell row', 'Bent-over smith machine row', 'Cable lat pullover', 'Chin ups', 'Face pulls', 'Lat pull down (wide grip)', 'Lat pull downs (bar)', 'Lat pull downs (bar) underhand grip', 'Lat pull downs (machine)', 'Lat pulldown (vbar grip)', 'Middle grip row', 'One arm rows', 'Plate-loaded low row', 'Pull-ups', 'Seated cable row', 'Seated neutral grip row', 'Seated pronated machine row', 'Seated vertical row machine', 'Single arm cable row', 'Single arm lat pulldown', 'Standing bent-over dumbbell row', 'T bar machine', 'Two arm cable row', 'Weighted pull-up', 'Wide grip row'],
  Legs: ['Warm up', 'Air squats', 'Barbell squats', 'Bulgarian split squat', 'Calf raise', 'Curtsey lunges', 'Deadlifts', 'Dumbbell deadlift', 'Glute bridges', 'Good mornings', 'Hamstring curls', 'Hip thrust_barbell', 'Jump rope', 'Leg extensions', 'Leg press', 'Leg press calf raise', 'Romanian deadlifts - barbell', 'Romanian deadlifts - dumbbell', 'Seated abductors', 'Single leg extension', 'Single leg press', 'Squats - Barbell', 'Squats - Smith machine', 'Sumo squat', 'Sumo squat cable machine', 'Walk', 'Wall squats'],
  Shoulders: ['Warm up', 'Arm raises', 'Arm raises - Lateral', 'Cable lateral raise', 'Dumbbell shoulder press', 'Face pull', 'Shoulder press'],
  Biceps: ['Warm up', 'Bar curls', 'Barbell Curls', 'Bayesian bicep curl', 'Bicep curl', 'Bicep curl machine', 'Bicep hammer curls', 'Hammer rope curls', 'Reverse bar bell curls'],
  Triceps: ['Warm up', 'Cable tricep kickback', 'Extension', 'Seated tricep', 'Triangle pushup', 'Tricep push down machine', 'Tricep pushdown', 'Tricep rope pushdowns'],
  Abs: ['Warm up', 'Ab crunch machine', 'Ab roller', 'Cable crunches', 'Cable woodchoppers', 'Cable woodchoppers - High to low', 'Deadbug', 'Dragon flag abs', 'Elbow plank', 'Hanging leg raise', 'Hanging leg raises knees bent', 'Hanging leg raises legs straight', 'Heel taps', 'Kneeling halo', 'Leg raises', 'Pallof press', 'Plank', 'Seated cable crunch', 'Side bend', 'Toe touches'],
  Forearms: ['Warm up', 'Wrist curls', 'Reverse wrist curls', 'Farmer walks'],
  Cardio: ['Walk', 'Run', 'Bike', 'Recumbent upright bike', 'Jump rope', 'Rowing machine', 'Elliptical', 'Stair climber'],
  Yoga: ['Yoga flow', 'Stretching', 'Foam rolling'],
  'Whole Body': ['Warm up', 'Circuit training', 'HIIT'],
};

const GYMS = ['Edge South Tower', 'Home', 'Other'];

const STORAGE_KEY = 'sunday-workout-log';

function loadWorkouts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}

function saveWorkouts(data, uid) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if (uid) saveField(uid, 'workoutLog', data);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function emptyEntry() {
  return { group: '', exercise: '', sets: ['', '', '', ''], perArm: false, weight: '', notes: '', time: '2:00' };
}

export function WorkoutPage({ onBack, user }) {
  const [workouts, setWorkouts] = useState(loadWorkouts);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [gym, setGym] = useState(GYMS[0]);
  const [entries, setEntries] = useState([emptyEntry()]);
  const [viewMode, setViewMode] = useState('log'); // 'log' | 'history' | 'stats'
  const [historyGroup, setHistoryGroup] = useState('');

  // Load today's workout if it exists
  useEffect(() => {
    const existing = workouts.find(w => w.date === selectedDate);
    if (existing) {
      setGym(existing.gym || GYMS[0]);
      setEntries(existing.entries.length > 0 ? existing.entries : [emptyEntry()]);
    } else {
      setEntries([emptyEntry()]);
    }
  }, [selectedDate]);

  function updateEntry(idx, field, value) {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  }

  function updateSet(entryIdx, setIdx, value) {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      const sets = [...e.sets];
      sets[setIdx] = value;
      return { ...e, sets };
    }));
  }

  function addEntry() {
    setEntries(prev => [...prev, emptyEntry()]);
  }

  function removeEntry(idx) {
    setEntries(prev => prev.filter((_, i) => i !== idx));
  }

  function saveWorkout() {
    const validEntries = entries.filter(e => e.group && e.exercise);
    if (validEntries.length === 0) return;

    const enriched = validEntries.map(e => {
      const reps = e.sets.filter(s => s !== '').map(Number).filter(n => !isNaN(n));
      const totalReps = reps.reduce((s, r) => s + r, 0);
      const maxReps = reps.length > 0 ? Math.max(...reps) : 0;
      const avgReps = reps.length > 0 ? (totalReps / reps.length).toFixed(1) : '0';
      const w = parseFloat(e.weight) || 0;
      const totalWeight = e.perArm ? w * 2 : w;
      return { ...e, totalReps, maxReps, avgReps: parseFloat(avgReps), totalWeight, maxWeight: totalWeight };
    });

    const workout = { date: selectedDate, gym, entries: enriched, savedAt: new Date().toISOString() };
    const next = [workout, ...workouts.filter(w => w.date !== selectedDate)].sort((a, b) => b.date.localeCompare(a.date));
    setWorkouts(next);
    saveWorkouts(next, user?.uid);
    alert('Workout saved!');
  }

  // Stats
  const exerciseHistory = useMemo(() => {
    const map = {};
    for (const w of workouts) {
      for (const e of w.entries || []) {
        const key = `${e.group}|${e.exercise}`;
        if (!map[key]) map[key] = [];
        map[key].push({ date: w.date, ...e });
      }
    }
    return map;
  }, [workouts]);

  const filteredHistory = useMemo(() => {
    if (!historyGroup) return workouts;
    return workouts.filter(w => w.entries?.some(e => e.group === historyGroup));
  }, [workouts, historyGroup]);

  // Workout frequency stats
  const stats = useMemo(() => {
    const groupCounts = {};
    const exerciseCounts = {};
    const last30 = workouts.filter(w => {
      const diff = (Date.now() - new Date(w.date).getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 30;
    });
    for (const w of last30) {
      for (const e of w.entries || []) {
        groupCounts[e.group] = (groupCounts[e.group] || 0) + 1;
        exerciseCounts[e.exercise] = (exerciseCounts[e.exercise] || 0) + 1;
      }
    }
    return {
      totalWorkouts: last30.length,
      groupCounts: Object.entries(groupCounts).sort((a, b) => b[1] - a[1]),
      exerciseCounts: Object.entries(exerciseCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [workouts]);

  // Personal records
  const prs = useMemo(() => {
    const map = {};
    for (const w of workouts) {
      for (const e of w.entries || []) {
        const key = e.exercise;
        if (!key || !e.maxWeight) continue;
        if (!map[key] || e.maxWeight > map[key].weight) {
          map[key] = { weight: e.maxWeight, reps: e.maxReps, date: w.date };
        }
      }
    }
    return Object.entries(map).sort((a, b) => b[1].weight - a[1].weight).slice(0, 15);
  }, [workouts]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>← Back</button>
        <h1 className={styles.title}>Workout Tracker</h1>
      </div>

      <div className={styles.tabs}>
        {['log', 'history', 'stats'].map(tab => (
          <button key={tab} className={`${styles.tab} ${viewMode === tab ? styles.tabActive : ''}`} onClick={() => setViewMode(tab)}>
            {tab === 'log' ? 'Log Workout' : tab === 'history' ? 'History' : 'Stats & PRs'}
          </button>
        ))}
      </div>

      {viewMode === 'log' && (
        <div className={styles.logSection}>
          <div className={styles.dateRow}>
            <input type="date" className={styles.dateInput} value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
            <select className={styles.gymSelect} value={gym} onChange={e => setGym(e.target.value)}>
              {GYMS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {entries.map((entry, i) => (
            <div key={i} className={styles.entryCard}>
              <div className={styles.entryHeader}>
                <select className={styles.groupSelect} value={entry.group} onChange={e => { updateEntry(i, 'group', e.target.value); updateEntry(i, 'exercise', ''); }}>
                  <option value="">Muscle Group</option>
                  {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select className={styles.exerciseSelect} value={entry.exercise} onChange={e => updateEntry(i, 'exercise', e.target.value)} disabled={!entry.group}>
                  <option value="">Exercise</option>
                  {(EXERCISES_BY_GROUP[entry.group] || []).map(ex => <option key={ex} value={ex}>{ex}</option>)}
                </select>
                {entries.length > 1 && (
                  <button className={styles.removeBtn} onClick={() => removeEntry(i)}>×</button>
                )}
              </div>
              <div className={styles.setsRow}>
                <div className={styles.setsGrid}>
                  {entry.sets.map((s, si) => (
                    <div key={si} className={styles.setCell}>
                      <label className={styles.setLabel}>Set {si + 1}</label>
                      <input className={styles.setInput} type="number" value={s} onChange={e => updateSet(i, si, e.target.value)} placeholder="reps" />
                    </div>
                  ))}
                </div>
                <div className={styles.weightCell}>
                  <label className={styles.setLabel}>Weight</label>
                  <input className={styles.setInput} type="number" value={entry.weight} onChange={e => updateEntry(i, 'weight', e.target.value)} placeholder="lbs" />
                </div>
                <label className={styles.perArmLabel}>
                  <input type="checkbox" checked={entry.perArm} onChange={e => updateEntry(i, 'perArm', e.target.checked)} />
                  Per arm
                </label>
              </div>
              <input className={styles.notesInput} value={entry.notes} onChange={e => updateEntry(i, 'notes', e.target.value)} placeholder="Notes (machine settings, form cues...)" />
            </div>
          ))}

          <div className={styles.actions}>
            <button className={styles.addExerciseBtn} onClick={addEntry}>+ Add Exercise</button>
            <button className={styles.saveBtn} onClick={saveWorkout}>Save Workout</button>
          </div>
        </div>
      )}

      {viewMode === 'history' && (
        <div className={styles.historySection}>
          <div className={styles.filterRow}>
            <select className={styles.groupSelect} value={historyGroup} onChange={e => setHistoryGroup(e.target.value)}>
              <option value="">All Groups</option>
              {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <span className={styles.historyCount}>{filteredHistory.length} workouts</span>
          </div>
          {filteredHistory.length === 0 ? (
            <div className={styles.empty}>No workouts logged yet</div>
          ) : (
            filteredHistory.slice(0, 30).map((w, wi) => (
              <div key={wi} className={styles.historyCard}>
                <div className={styles.historyDate}>
                  <span className={styles.historyDateText}>{formatDate(w.date)}</span>
                  <span className={styles.historyGym}>{w.gym}</span>
                  <span className={styles.historyExCount}>{w.entries?.length || 0} exercises</span>
                </div>
                <div className={styles.historyEntries}>
                  {(w.entries || []).filter(e => !historyGroup || e.group === historyGroup).map((e, ei) => (
                    <div key={ei} className={styles.historyEntry}>
                      <span className={styles.historyGroup}>{e.group}</span>
                      <span className={styles.historyExercise}>{e.exercise}</span>
                      <span className={styles.historySets}>{e.sets?.filter(s => s).join(' / ') || '—'}</span>
                      <span className={styles.historyWeight}>{e.totalWeight ? `${e.totalWeight} lbs` : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {viewMode === 'stats' && (
        <div className={styles.statsSection}>
          <div className={styles.statCards}>
            <div className={styles.statCard}>
              <div className={styles.statValue}>{stats.totalWorkouts}</div>
              <div className={styles.statLabel}>Workouts (30d)</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statValue}>{workouts.length}</div>
              <div className={styles.statLabel}>Total Workouts</div>
            </div>
          </div>

          <h3 className={styles.statsHeading}>Muscle Groups (30d)</h3>
          <div className={styles.barChart}>
            {stats.groupCounts.map(([group, count]) => (
              <div key={group} className={styles.barRow}>
                <span className={styles.barLabel}>{group}</span>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${(count / (stats.groupCounts[0]?.[1] || 1)) * 100}%` }} />
                </div>
                <span className={styles.barValue}>{count}</span>
              </div>
            ))}
          </div>

          <h3 className={styles.statsHeading}>Top Exercises (30d)</h3>
          {stats.exerciseCounts.map(([ex, count], i) => (
            <div key={i} className={styles.topExRow}>
              <span className={styles.topExRank}>{i + 1}</span>
              <span className={styles.topExName}>{ex}</span>
              <span className={styles.topExCount}>{count}x</span>
            </div>
          ))}

          <h3 className={styles.statsHeading}>Personal Records</h3>
          {prs.length > 0 ? prs.map(([ex, pr], i) => (
            <div key={i} className={styles.prRow}>
              <span className={styles.prExercise}>{ex}</span>
              <span className={styles.prWeight}>{pr.weight} lbs</span>
              <span className={styles.prReps}>{pr.reps} reps</span>
              <span className={styles.prDate}>{formatDate(pr.date)}</span>
            </div>
          )) : <div className={styles.empty}>Log workouts with weights to track PRs</div>}
        </div>
      )}
    </div>
  );
}
