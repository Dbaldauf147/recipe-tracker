import { useState, useEffect, useMemo, useRef } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { saveField, loadWorkoutLogFromFirestore, saveWorkoutDraft, clearWorkoutDraft } from '../utils/firestoreSync';
import { ExerciseLibrary } from './ExerciseLibrary';
import styles from './WorkoutPage.module.css';

const CHART_METRICS = {
  avgReps: { label: 'Avg Reps', field: 'avgReps' },
  totalReps: { label: 'Total Reps', field: 'totalReps' },
  maxReps: { label: 'Max Reps', field: 'maxReps' },
  weight: { label: 'Weight', field: 'totalWeight' },
  maxWeight: { label: 'Max Weight', field: 'maxWeight' },
};

const NUM_CHART_SLOTS = 8;

function isWarmUp(name) {
  return /^\s*warm[-\s]?up\s*$/i.test(name || '');
}

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

const WORKOUT_TYPES = ['Push', 'Pull', 'Legs', 'Full Body'];

function daysSince(dateStr) {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr + 'T00:00:00').getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

const STORAGE_KEY = 'sunday-workout-log';
const LIBRARY_KEY = 'sunday-exercise-library';

function loadWorkouts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}

function saveWorkouts(data, uid) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if (uid) saveField(uid, 'workoutLog', data);
}

function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY)) || []; } catch { return []; }
}

function saveLibrary(data, uid) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(data));
  if (uid) saveField(uid, 'exerciseLibrary', data);
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

// Recompute derived fields from the user-editable fields. Used by both
// the Log Workout save path and the History inline-edit path so cell
// edits keep totalReps/maxReps/avgReps/totalWeight/maxWeight in sync.
function enrichEntry(e) {
  const sets = Array.isArray(e.sets) ? e.sets : [];
  const reps = sets.filter(s => s !== '' && s != null).map(Number).filter(n => !isNaN(n));
  const totalReps = reps.reduce((s, r) => s + r, 0);
  const maxReps = reps.length > 0 ? Math.max(...reps) : 0;
  const avgReps = reps.length > 0 ? parseFloat((totalReps / reps.length).toFixed(1)) : 0;
  const w = parseFloat(e.weight) || 0;
  const totalWeight = e.perArm ? w * 2 : w;
  return { ...e, totalReps, maxReps, avgReps, totalWeight, maxWeight: totalWeight };
}

const DEFAULT_LOG_ENTRY_COUNT = 8;

function blankEntries(n = DEFAULT_LOG_ENTRY_COUNT) {
  return Array.from({ length: n }, () => emptyEntry());
}

function padToMin(entries, min = DEFAULT_LOG_ENTRY_COUNT) {
  if (entries.length >= min) return entries;
  return [...entries, ...blankEntries(min - entries.length)];
}

// ---- CSV import ----------------------------------------------------------
// Splits one line of a tab- or comma-separated CSV. Returns array of cells.
function splitCsvLine(line, delim) {
  // Naive split — the source spreadsheet doesn't quote fields.
  return line.split(delim).map(s => s.trim());
}

function detectDelim(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

function isJunkCell(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return !s || /^#(N\/A|DIV\/0!|ERROR!|VALUE!|REF!|NAME\?|NULL!)/i.test(s);
}

function cleanInt(v) {
  if (isJunkCell(v)) return '';
  const n = parseFloat(String(v).trim());
  return isNaN(n) ? '' : String(n);
}

function cleanFloat(v) {
  if (isJunkCell(v)) return '';
  const n = parseFloat(String(v).trim());
  return isNaN(n) ? '' : n;
}

// Parse "M/D/YYYY" or "YYYY-MM-DD" → "YYYY-MM-DD"
function normalizeDate(s) {
  if (!s) return '';
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  let yyyy = m[3];
  if (yyyy.length === 2) yyyy = (parseInt(yyyy) >= 70 ? '19' : '20') + yyyy;
  const mm = String(parseInt(m[1])).padStart(2, '0');
  const dd = String(parseInt(m[2])).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Find a column index by trying any of several header aliases (case-insensitive,
// allows leading/trailing whitespace).
function findCol(headers, aliases) {
  const norm = headers.map(h => h.trim().toLowerCase());
  for (const alias of aliases) {
    const i = norm.indexOf(alias.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

// Robust split — handles quoted CSV fields (Google Sheets CSV export wraps
// any field containing a comma/quote/newline in double quotes and escapes
// embedded quotes by doubling them).
function splitCsvLineQuoted(line, delim) {
  if (delim !== ',') return splitCsvLine(line, delim);
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parse a workout CSV (the user's spreadsheet format) into the workoutLog
 * shape, plus a per-row cleaning report so the user can see exactly which
 * cells we sanitized and which rows we had to skip.
 */
function parseWorkoutCsv(text) {
  const delim = detectDelim(text);
  // Strip BOM (Google Sheets CSV export sometimes prepends one).
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { workouts: [], skippedRows: [], cleanings: [], headers: [], colMap: {}, sampleRow: [] };
  const headers = splitCsvLineQuoted(lines[0], delim);

  const colGroup    = findCol(headers, ['group']);
  const colExercise = findCol(headers, ['exercises', 'exercise']);
  const colDate     = findCol(headers, ['date']);
  const colGym      = findCol(headers, ['gym', 'location']);
  const colNotes    = findCol(headers, ['notes', 'note']);
  let colRest       = findCol(headers, ['rest time', 'rest']);
  let colSet1       = findCol(headers, ['set 1', 'set1', 's1', 'reps 1', 'set1 reps']);
  let colSet2       = findCol(headers, ['set 2', 'set2', 's2', 'reps 2', 'set2 reps']);
  let colSet3       = findCol(headers, ['set 3', 'set3', 's3', 'reps 3', 'set3 reps']);
  let colSet4       = findCol(headers, ['set 4', 'set4', 's4', 'reps 4', 'set4 reps']);
  const colPerSide  = findCol(headers, ['per arm/leg', 'per arm', 'per side', 'weight per side']);
  const colTotalWt  = findCol(headers, ['total weight', 'weight']);

  if (colDate < 0 || colExercise < 0) {
    throw new Error('CSV must have Date and Exercises columns at minimum');
  }

  // Positional fallback: if Set 1–4 weren't matched by name but the row has
  // a known anchor on each side (Notes/Date on the left, Per Arm/Leg or
  // Total Weight on the right), infer the missing columns by position.
  if (colSet1 < 0 || colSet2 < 0 || colSet3 < 0 || colSet4 < 0) {
    const leftAnchor = colNotes >= 0 ? colNotes : (colGym >= 0 ? colGym : colDate);
    const rightAnchor = colPerSide >= 0 ? colPerSide : (colTotalWt >= 0 ? colTotalWt : -1);
    if (leftAnchor >= 0 && rightAnchor > leftAnchor) {
      const gap = rightAnchor - leftAnchor - 1;
      // Common shapes: 5 cells = Rest Time + Set 1-4, 4 cells = Set 1-4 only.
      if (gap === 5) {
        if (colRest < 0) colRest = leftAnchor + 1;
        if (colSet1 < 0) colSet1 = leftAnchor + 2;
        if (colSet2 < 0) colSet2 = leftAnchor + 3;
        if (colSet3 < 0) colSet3 = leftAnchor + 4;
        if (colSet4 < 0) colSet4 = leftAnchor + 5;
      } else if (gap === 4) {
        if (colSet1 < 0) colSet1 = leftAnchor + 1;
        if (colSet2 < 0) colSet2 = leftAnchor + 2;
        if (colSet3 < 0) colSet3 = leftAnchor + 3;
        if (colSet4 < 0) colSet4 = leftAnchor + 4;
      }
    }
  }

  // Helper that records cleaned-cell details for the report.
  function cleanCell(raw, colName, type, fixes) {
    if (raw == null || raw === '') return '';
    const s = String(raw).trim();
    if (!s) return '';
    if (isJunkCell(s)) {
      fixes.push(`${colName}: removed "${s}"`);
      return '';
    }
    if (type === 'int' || type === 'float') {
      const n = parseFloat(s);
      if (isNaN(n)) {
        fixes.push(`${colName}: not a number "${s}"`);
        return '';
      }
      return type === 'int' ? String(n) : n;
    }
    return s;
  }

  const byDate = new Map();
  const skippedRows = [];
  const cleanings = []; // [{ lineNum, date, exercise, fixes: [...] }]

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1;
    const cells = splitCsvLineQuoted(lines[i], delim);
    const dateRaw = cells[colDate] || '';
    const date = normalizeDate(dateRaw);
    const exercise = (cells[colExercise] || '').trim();

    if (!date && !exercise) {
      skippedRows.push({ lineNum, reason: 'blank date and exercise', raw: lines[i] });
      continue;
    }
    if (!date) {
      skippedRows.push({ lineNum, reason: `bad date "${dateRaw}"`, raw: lines[i] });
      continue;
    }
    if (!exercise) {
      skippedRows.push({ lineNum, reason: 'missing exercise', raw: lines[i] });
      continue;
    }

    const fixes = [];
    const group = (cells[colGroup] || '').trim();
    if (!group) fixes.push('Group: blank');
    const gym = colGym >= 0 ? (cells[colGym] || '').trim() : '';
    const notes = colNotes >= 0 ? (cells[colNotes] || '').trim() : '';
    const time = colRest >= 0 ? (cells[colRest] || '').trim() || '2:00' : '2:00';

    const sets = [
      cleanCell(cells[colSet1], 'Set 1', 'int', fixes),
      cleanCell(cells[colSet2], 'Set 2', 'int', fixes),
      cleanCell(cells[colSet3], 'Set 3', 'int', fixes),
      cleanCell(cells[colSet4], 'Set 4', 'int', fixes),
    ];
    const perSide = colPerSide >= 0 ? cleanCell(cells[colPerSide], 'Per Arm/Leg', 'float', fixes) : '';
    const totalWt = colTotalWt >= 0 ? cleanCell(cells[colTotalWt], 'Total Weight', 'float', fixes) : '';

    let weight = '';
    let perArm = false;
    if (perSide !== '' && totalWt !== '') {
      perArm = Math.abs(perSide * 2 - totalWt) < 1;
      weight = String(perSide);
    } else if (perSide !== '') {
      weight = String(perSide);
      perArm = true;
    } else if (totalWt !== '') {
      weight = String(totalWt);
    }

    const entry = { group, exercise, sets, perArm, weight, notes, time };
    if (fixes.length > 0) cleanings.push({ lineNum, date, exercise, fixes });

    if (!byDate.has(date)) byDate.set(date, { date, gym: gym || 'Edge South Tower', entries: [] });
    const bucket = byDate.get(date);
    if (!bucket.gym && gym) bucket.gym = gym;
    bucket.entries.push(entry);
  }

  const workouts = [];
  for (const w of byDate.values()) {
    const enriched = w.entries.map(e => {
      const reps = e.sets.filter(s => s !== '').map(Number).filter(n => !isNaN(n));
      const totalReps = reps.reduce((s, r) => s + r, 0);
      const maxReps = reps.length > 0 ? Math.max(...reps) : 0;
      const avgReps = reps.length > 0 ? parseFloat((totalReps / reps.length).toFixed(1)) : 0;
      const wt = parseFloat(e.weight) || 0;
      const totalWeight = e.perArm ? wt * 2 : wt;
      return { ...e, totalReps, maxReps, avgReps, totalWeight, maxWeight: totalWeight };
    });
    workouts.push({ ...w, entries: enriched, savedAt: new Date().toISOString() });
  }
  // Diagnostic data so the UI can show which header maps to which index +
  // what's actually in that cell on the first data row.
  const sampleRow = lines.length > 1 ? splitCsvLineQuoted(lines[1], delim) : [];
  const colMap = {
    Group: colGroup,
    Exercises: colExercise,
    Date: colDate,
    Gym: colGym,
    Notes: colNotes,
    'Rest Time': colRest,
    'Set 1': colSet1,
    'Set 2': colSet2,
    'Set 3': colSet3,
    'Set 4': colSet4,
    'Per Arm/Leg': colPerSide,
    'Total Weight': colTotalWt,
  };
  return { workouts, skippedRows, cleanings, headers, colMap, sampleRow, delim };
}

// Re-emit the parsed workouts as a cleaned CSV using the same column
// structure as the user's source sheet. They can paste this back over their
// spreadsheet to replace junk values with blanks.
function buildCleanedCsv(workouts) {
  const header = [
    'Group', 'Exercises', 'Date', 'Gym', 'Notes', 'Rest Time',
    'Set 1', 'Set 2', 'Set 3', 'Set 4', 'Per Arm/Leg', 'Total Weight',
    'Max Weight', 'Reps', 'Max Reps',
  ];
  const sortedDates = [...workouts].sort((a, b) => a.date.localeCompare(b.date));
  const rows = [header.join('\t')];
  for (const w of sortedDates) {
    // M/D/YYYY to match source sheet format.
    const [yyyy, mm, dd] = w.date.split('-');
    const dateOut = `${parseInt(mm)}/${parseInt(dd)}/${yyyy}`;
    for (const e of w.entries) {
      const perSide = parseFloat(e.weight) || '';
      const total = e.perArm ? perSide * 2 : perSide;
      rows.push([
        e.group || '',
        e.exercise || '',
        dateOut,
        w.gym || '',
        e.notes || '',
        e.time || '',
        e.sets[0] || '',
        e.sets[1] || '',
        e.sets[2] || '',
        e.sets[3] || '',
        perSide === '' ? '' : perSide,
        total === '' ? '' : total,
        e.maxWeight || '',
        e.avgReps || '',
        e.maxReps || '',
      ].join('\t'));
    }
  }
  return rows.join('\n');
}

export function WorkoutPage({ onBack, user }) {
  const [workouts, setWorkouts] = useState(loadWorkouts);
  const [selectedDate, setSelectedDate] = useState(todayStr());

  // Hydrate from Firestore on mount so workouts saved on the mobile app
  // appear here. Merges with whatever is in localStorage — Firestore wins
  // for dates that exist in both, local-only dates are preserved.
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadWorkoutLogFromFirestore(user.uid);
        if (cancelled || remote === null) return;
        setWorkouts(prev => {
          const remoteDates = new Set(remote.map(w => w.date));
          const localOnly = prev.filter(w => !remoteDates.has(w.date));
          const merged = [...remote, ...localOnly].sort((a, b) => b.date.localeCompare(a.date));
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
          return merged;
        });
      } catch (err) {
        console.error('Workout cloud hydrate error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);
  const [gym, setGym] = useState(GYMS[0]);
  const [workoutType, setWorkoutType] = useState('');
  const [entries, setEntries] = useState(() => blankEntries());
  const [viewMode, setViewMode] = useState('log'); // 'log' | 'history' | 'charts' | 'exercises' | 'stats'
  const [exerciseLibrary, setExerciseLibrary] = useState(loadLibrary);
  const [historyGroup, setHistoryGroup] = useState('');
  const [chartSlots, setChartSlots] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sunday-chart-slots') || 'null');
      if (Array.isArray(saved)) {
        return Array.from({ length: NUM_CHART_SLOTS }, (_, i) => saved[i] || { group: '', exercise: '' });
      }
    } catch {}
    return Array.from({ length: NUM_CHART_SLOTS }, () => ({ group: '', exercise: '' }));
  });
  const [chartLeftMetric, setChartLeftMetric] = useState('avgReps');
  const [chartRightMetric, setChartRightMetric] = useState('weight');
  const [chartView, setChartView] = useState('custom'); // 'custom' or a group name like 'Push'

  function setSlot(idx, patch) {
    setChartSlots(prev => {
      const next = prev.map((s, i) => i === idx ? { ...s, ...patch } : s);
      try { localStorage.setItem('sunday-chart-slots', JSON.stringify(next)); } catch {}
      return next;
    });
  }
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [logImageProcessing, setLogImageProcessing] = useState(false);
  const [logImageError, setLogImageError] = useState('');
  const [logImageInfo, setLogImageInfo] = useState('');
  const logImageFileRef = useRef(null);

  async function handleLogImage(blob) {
    if (!blob) return;
    setLogImageError('');
    setLogImageInfo('');
    setLogImageProcessing(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const res = await fetch('/api/parse-workout-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      const incoming = (data.entries || []).filter(e => e.exercise || e.group);
      if (incoming.length === 0) {
        throw new Error("Couldn't read any exercises from that image — try a clearer screenshot.");
      }
      // Fill empty rows from the top first; if the table is full or there
      // are leftover incoming rows, append them to the end.
      setEntries(prev => {
        const next = [...prev];
        let pos = 0;
        for (const e of incoming) {
          while (pos < next.length && (next[pos].exercise || next[pos].group)) pos++;
          if (pos < next.length) {
            next[pos] = e;
            pos++;
          } else {
            next.push(e);
          }
        }
        return padToMin(next);
      });
      setLogImageInfo(`Imported ${incoming.length} exercise${incoming.length === 1 ? '' : 's'} — review then click Save Workout.`);
    } catch (err) {
      setLogImageError(err.message || 'Failed to read image');
    } finally {
      setLogImageProcessing(false);
    }
  }

  function handleParseImport() {
    setImportError('');
    try {
      const result = parseWorkoutCsv(importText);
      if (result.workouts.length === 0) {
        setImportError('No valid rows found. Check that the CSV has Date and Exercises columns.');
        return;
      }
      setImportPreview(result);
    } catch (err) {
      setImportError(err.message || 'Parse failed');
    }
  }

  function handleConfirmImport() {
    if (!importPreview) return;
    // Replace any existing workouts on the imported dates.
    const importedDates = new Set(importPreview.workouts.map(w => w.date));
    const merged = [
      ...importPreview.workouts,
      ...workouts.filter(w => !importedDates.has(w.date)),
    ].sort((a, b) => b.date.localeCompare(a.date));
    setWorkouts(merged);
    saveWorkouts(merged, user?.uid);
    setShowImport(false);
    setImportText('');
    setImportPreview(null);
    setImportError('');
    alert(`Imported ${importPreview.workouts.length} workout day${importPreview.workouts.length === 1 ? '' : 's'}.`);
  }

  /**
   * Force-push the current localStorage workouts to Firestore. Useful if
   * the user imported / saved while signed-out, or the auto-write silently
   * skipped (so the mobile app's `users/{uid}.workoutLog` is empty even
   * though localStorage has all the data).
   */
  async function handlePushToCloud() {
    if (!user?.uid) {
      alert('You must be signed in to push workouts to the cloud.');
      return;
    }
    try {
      await saveField(user.uid, 'workoutLog', workouts);
      alert(`Pushed ${workouts.length} workout day${workouts.length === 1 ? '' : 's'} to Firestore. The mobile app should see them after a sync.`);
    } catch (err) {
      console.error('Push to cloud error:', err);
      alert(`Push failed: ${err.message || err}`);
    }
  }

  function handleDownloadCleaned() {
    if (!importPreview) return;
    const csv = buildCleanedCsv(importPreview.workouts);
    const blob = new Blob([csv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workouts-cleaned-${new Date().toISOString().slice(0, 10)}.tsv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Load today's workout if it exists
  useEffect(() => {
    const existing = workouts.find(w => w.date === selectedDate);
    if (existing) {
      setGym(existing.gym || GYMS[0]);
      setWorkoutType(existing.workoutType || '');
      setEntries(padToMin(existing.entries.length > 0 ? existing.entries : []));
    } else {
      setEntries(blankEntries());
      setWorkoutType('');
    }
  }, [selectedDate]);

  // Listen for clipboard image paste while on the Log tab so the user can
  // hit Cmd/Ctrl-V right after taking a screenshot without first clicking
  // into the dropzone.
  useEffect(() => {
    if (viewMode !== 'log') return;
    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type?.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            handleLogImage(blob);
            return;
          }
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

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

    const enriched = validEntries.map(enrichEntry);

    const workout = { date: selectedDate, gym, workoutType, entries: enriched, savedAt: new Date().toISOString() };
    const next = [workout, ...workouts.filter(w => w.date !== selectedDate)].sort((a, b) => b.date.localeCompare(a.date));
    setWorkouts(next);
    saveWorkouts(next, user?.uid);
    // Clear the in-progress draft so mobile stops showing the unsaved version.
    if (user?.uid) clearWorkoutDraft(user.uid).catch(() => {});
    alert('Workout saved!');
  }

  // Auto-save the in-progress draft to Firestore so other devices (mobile)
  // can see what's being typed live. Debounced so we don't fire on every
  // keystroke. Only meaningful if at least one entry has a group+exercise.
  const draftDebounceRef = useRef(null);
  useEffect(() => {
    if (!user?.uid) return;
    clearTimeout(draftDebounceRef.current);
    draftDebounceRef.current = setTimeout(() => {
      const meaningful = entries.filter(e => e.group && e.exercise);
      if (meaningful.length === 0) return;
      saveWorkoutDraft(user.uid, {
        date: selectedDate,
        gym,
        workoutType,
        entries: meaningful,
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(draftDebounceRef.current);
  }, [user?.uid, selectedDate, gym, workoutType, entries]);

  // Inline edits on the History tab. Each handler mutates the workouts
  // array, re-enriches the touched entry, and persists to localStorage +
  // Firestore. Deleting the last entry of a workout removes the whole
  // workout day.
  function commitWorkouts(next) {
    setWorkouts(next);
    saveWorkouts(next, user?.uid);
  }
  function updateHistoryField(date, originalIdx, field, value) {
    const next = workouts.map(w => {
      if (w.date !== date) return w;
      const entries = w.entries.map((e, i) => {
        if (i !== originalIdx) return e;
        const updated = { ...e, [field]: value };
        if (field === 'group') updated.exercise = ''; // exercise list depends on group
        return enrichEntry(updated);
      });
      return { ...w, entries };
    });
    commitWorkouts(next);
  }
  function updateHistorySetField(date, originalIdx, setIdx, value) {
    const next = workouts.map(w => {
      if (w.date !== date) return w;
      const entries = w.entries.map((e, i) => {
        if (i !== originalIdx) return e;
        const sets = Array.isArray(e.sets) ? [...e.sets] : ['', '', '', ''];
        while (sets.length < 4) sets.push('');
        sets[setIdx] = value;
        return enrichEntry({ ...e, sets });
      });
      return { ...w, entries };
    });
    commitWorkouts(next);
  }
  function deleteHistoryEntry(date, originalIdx) {
    const next = workouts
      .map(w => w.date === date ? { ...w, entries: w.entries.filter((_, i) => i !== originalIdx) } : w)
      .filter(w => w.entries.length > 0);
    commitWorkouts(next);
  }
  function deleteHistoryDay(date) {
    if (!window.confirm(`Delete the entire ${date} workout? This can't be undone.`)) return;
    commitWorkouts(workouts.filter(w => w.date !== date));
  }
  function setHistoryWorkoutType(date, type) {
    commitWorkouts(workouts.map(w => w.date === date ? { ...w, workoutType: type } : w));
  }

  // Stats
  // Most recent saved workout for each tagged type. Lets us suggest the
  // type that's been longest since done and auto-fill from the last
  // instance for a quick starting point.
  const lastByType = useMemo(() => {
    const m = {};
    for (const w of workouts) {
      if (!w.workoutType) continue;
      if (!m[w.workoutType] || w.date > m[w.workoutType].date) {
        m[w.workoutType] = w;
      }
    }
    return m;
  }, [workouts]);

  const suggestedType = useMemo(() => {
    let suggested = WORKOUT_TYPES[0];
    let suggestedDate = lastByType[suggested]?.date || '';
    for (const t of WORKOUT_TYPES) {
      const d = lastByType[t]?.date || '';
      if (!d) return t; // never done yet — suggest immediately
      if (suggestedDate && d < suggestedDate) {
        suggested = t;
        suggestedDate = d;
      }
    }
    return suggested;
  }, [lastByType]);

  function fillFromLast(t) {
    const last = lastByType[t];
    if (!last) return;
    const fill = (last.entries || []).map(e => ({
      group: e.group || '',
      exercise: e.exercise || '',
      sets: Array.isArray(e.sets) ? e.sets.map(s => (s == null ? '' : String(s))) : ['', '', '', ''],
      perArm: !!e.perArm,
      weight: e.weight != null ? String(e.weight) : '',
      notes: e.notes || '',
      time: e.time || '2:00',
    }));
    while (fill.length < 4) fill[fill.length] = undefined; // no-op padding marker
    setEntries(padToMin(fill.filter(Boolean)));
  }

  function handleTypeClick(t) {
    if (workoutType === t) return;
    setWorkoutType(t);
    // If today's date already has a saved workout, persist the new type
    // immediately so "days ago" updates without making the user re-save.
    const existing = workouts.find(w => w.date === selectedDate);
    if (existing) {
      const next = workouts.map(w => w.date === selectedDate ? { ...w, workoutType: t } : w);
      setWorkouts(next);
      saveWorkouts(next, user?.uid);
      return;
    }
    // Fresh day — only auto-fill when the table is still empty so we
    // don't clobber data the user has already started entering.
    const hasData = entries.some(e => e.exercise || e.group);
    if (!hasData) fillFromLast(t);
  }

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

  // Same data keyed by exercise name only (case-insensitive). Lets Charts
  // look up history by exercise regardless of which muscle group it was
  // logged under — the saved workouts use anatomy groups (Chest/Back) while
  // the imported library uses movement patterns (Push/Pull).
  const exerciseHistoryByName = useMemo(() => {
    const map = {};
    for (const w of workouts) {
      for (const e of w.entries || []) {
        if (!e.exercise) continue;
        const key = e.exercise.trim().toLowerCase();
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

  // Library-driven groupings for the Charts picker. Falls back to the
  // groups present in the saved workouts when the library is empty so the
  // tab still works before the user imports their exercise list.
  const libraryByGroup = useMemo(() => {
    const map = {};
    for (const item of exerciseLibrary || []) {
      if (!item?.exercise) continue;
      if (item.retired) continue;
      const g = item.group || 'Other';
      if (!map[g]) map[g] = [];
      map[g].push(item.exercise);
    }
    for (const g of Object.keys(map)) {
      map[g] = Array.from(new Set(map[g])).sort();
    }
    return map;
  }, [exerciseLibrary]);

  // Build the list of muscle groups + exercises that actually appear in the
  // saved workouts. Used as a fallback when no library is imported yet.
  const groupsWithHistory = useMemo(() => {
    const map = {};
    for (const key of Object.keys(exerciseHistory)) {
      const [g, ex] = key.split('|');
      if (!g || !ex) continue;
      if (!map[g]) map[g] = new Set();
      map[g].add(ex);
    }
    const out = {};
    for (const g of Object.keys(map)) out[g] = Array.from(map[g]).sort();
    return out;
  }, [exerciseHistory]);

  // The picker prefers the imported library (richer + the user's preferred
  // taxonomy); falls back to whatever groups appear in the saved workouts.
  const chartGroupSource = useMemo(() => {
    return Object.keys(libraryByGroup).length > 0 ? libraryByGroup : groupsWithHistory;
  }, [libraryByGroup, groupsWithHistory]);

  // Build a single exercise's time series. Looks up by name (not group)
  // so a Push-grouped library entry still finds Chest-grouped history.
  function buildChartData(exerciseName) {
    if (!exerciseName) return [];
    const history = exerciseHistoryByName[exerciseName.trim().toLowerCase()] || [];
    return [...history]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(h => ({
        date: h.date,
        avgReps: Number(h.avgReps) || 0,
        totalReps: Number(h.totalReps) || 0,
        maxReps: Number(h.maxReps) || 0,
        totalWeight: Number(h.totalWeight) || 0,
        maxWeight: Number(h.maxWeight) || 0,
      }));
  }

  function withTrend(data, rightField) {
    if (data.length < 2) return data;
    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      const y = data[i][rightField];
      sumX += i;
      sumY += y;
      sumXY += i * y;
      sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return data;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return data.map((d, i) => ({ ...d, trend: intercept + slope * i }));
  }

  // Auto-fill empty chart slots with the six most-logged exercises once
  // workout history is available, so the dashboard isn't blank on first
  // visit. Uses library group when known so the slot's group dropdown
  // pre-selects correctly.
  useEffect(() => {
    if (chartSlots.some(s => s.exercise)) return;
    const counts = {};
    for (const w of workouts) {
      for (const e of w.entries || []) {
        if (!e.exercise || isWarmUp(e.exercise)) continue;
        const k = e.exercise.trim().toLowerCase();
        if (!counts[k]) counts[k] = { exercise: e.exercise, count: 0, group: e.group || '' };
        counts[k].count += 1;
      }
    }
    const top = Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, NUM_CHART_SLOTS);
    if (top.length === 0) return;
    const libByExercise = {};
    for (const item of exerciseLibrary || []) {
      if (item?.exercise) libByExercise[item.exercise.trim().toLowerCase()] = item.group || '';
    }
    const next = Array.from({ length: NUM_CHART_SLOTS }, (_, i) => {
      const it = top[i];
      if (!it) return { group: '', exercise: '' };
      const libGroup = libByExercise[it.exercise.trim().toLowerCase()];
      return { group: libGroup || it.group || '', exercise: it.exercise };
    });
    setChartSlots(next);
    try { localStorage.setItem('sunday-chart-slots', JSON.stringify(next)); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workouts, exerciseLibrary]);

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
        <button
          className={styles.backBtn}
          style={{ marginLeft: 'auto' }}
          onClick={handlePushToCloud}
          title="Re-push all local workouts to Firestore (rescue if the mobile app shows 0 workouts)"
          disabled={!user?.uid}
        >
          ⬆ Push to Cloud ({workouts.length})
        </button>
        <button
          className={styles.backBtn}
          onClick={() => setShowImport(true)}
          title="Import historical workouts from a CSV"
        >
          Import CSV
        </button>
      </div>

      <div className={styles.tabs}>
        {['log', 'history', 'charts', 'exercises', 'stats'].map(tab => (
          <button key={tab} className={`${styles.tab} ${viewMode === tab ? styles.tabActive : ''}`} onClick={() => setViewMode(tab)}>
            {tab === 'log' ? 'Log Workout' : tab === 'history' ? 'History' : tab === 'charts' ? 'Charts' : tab === 'exercises' ? 'Exercises' : 'Stats & PRs'}
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

          <div className={styles.workoutTypeRow}>
            <span className={styles.workoutTypeLabel}>Workout type:</span>
            {WORKOUT_TYPES.map(t => {
              const last = lastByType[t];
              const days = daysSince(last?.date);
              const isSuggested = t === suggestedType && !workoutType;
              const isActive = workoutType === t;
              return (
                <button
                  key={t}
                  className={`${styles.workoutTypePill} ${isActive ? styles.workoutTypePillActive : ''} ${isSuggested ? styles.workoutTypePillSuggested : ''}`}
                  onClick={() => handleTypeClick(t)}
                  title={last ? `Last ${t}: ${days} day${days === 1 ? '' : 's'} ago (${formatDate(last.date)})` : `Never done ${t}`}
                  type="button"
                >
                  <span className={styles.workoutTypePillName}>{isSuggested && '⭐ '}{t}</span>
                  <span className={styles.workoutTypePillSub}>
                    {last ? `${days}d ago` : 'never'}
                  </span>
                </button>
              );
            })}
            {workoutType && lastByType[workoutType] && (
              <button
                className={styles.workoutTypeRefill}
                onClick={() => fillFromLast(workoutType)}
                type="button"
                title={`Replace the table with your last ${workoutType} workout`}
              >
                ↻ Refill from last {workoutType}
              </button>
            )}
          </div>

          <input
            ref={logImageFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleLogImage(file);
              e.target.value = '';
            }}
          />
          <div
            className={styles.logImageDrop}
            onClick={() => !logImageProcessing && logImageFileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add(styles.logImageDropActive); }}
            onDragLeave={e => e.currentTarget.classList.remove(styles.logImageDropActive)}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.classList.remove(styles.logImageDropActive);
              if (logImageProcessing) return;
              const file = e.dataTransfer.files?.[0];
              if (file?.type?.startsWith('image/')) handleLogImage(file);
            }}
          >
            {logImageProcessing ? (
              <span>🧠 Reading workout from image…</span>
            ) : (
              <span>📸 Paste a workout screenshot (Cmd/Ctrl-V), drop an image here, or click to browse — we&apos;ll fill the table for you.</span>
            )}
          </div>
          {logImageError && <div className={styles.logImageError}>{logImageError}</div>}
          {logImageInfo && <div className={styles.logImageInfo}>{logImageInfo}</div>}

          <div className={styles.logTableWrap}>
            <table className={styles.logTable}>
              <thead>
                <tr>
                  <th className={styles.logGroupCol}>Group</th>
                  <th className={styles.logExerciseCol}>Exercise</th>
                  <th className={styles.logNotesCol}>Notes</th>
                  <th className={styles.logTimeCol}>Time</th>
                  <th className={styles.logSetCol}>S1</th>
                  <th className={styles.logSetCol}>S2</th>
                  <th className={styles.logSetCol}>S3</th>
                  <th className={styles.logSetCol}>S4</th>
                  <th className={styles.logWeightCol}>Weight</th>
                  <th className={styles.logPerCol} title="Weight is per arm/leg (totals double)">×2</th>
                  <th className={styles.logTotalCol}>Total</th>
                  <th className={styles.logRemoveCol}></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const w = parseFloat(entry.weight) || 0;
                  const total = entry.perArm ? w * 2 : w;
                  return (
                    <tr key={i}>
                      <td>
                        <select className={`${styles.logCell} ${styles.logGroupSelect}`} value={entry.group} onChange={e => { updateEntry(i, 'group', e.target.value); updateEntry(i, 'exercise', ''); }}>
                          <option value="">—</option>
                          {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className={`${styles.logCell} ${styles.logExerciseSelect}`} value={entry.exercise} onChange={e => updateEntry(i, 'exercise', e.target.value)} disabled={!entry.group}>
                          <option value="">—</option>
                          {(EXERCISES_BY_GROUP[entry.group] || []).map(ex => <option key={ex} value={ex}>{ex}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className={styles.logCell} type="text" value={entry.notes} onChange={e => updateEntry(i, 'notes', e.target.value)} placeholder="" />
                      </td>
                      <td>
                        <input className={`${styles.logCell} ${styles.logTimeInput}`} type="text" value={entry.time} onChange={e => updateEntry(i, 'time', e.target.value)} placeholder="2:00" />
                      </td>
                      {entry.sets.map((s, si) => (
                        <td key={si}>
                          <input className={`${styles.logCell} ${styles.logSetInput}`} type="number" value={s} onChange={e => updateSet(i, si, e.target.value)} />
                        </td>
                      ))}
                      <td>
                        <input className={`${styles.logCell} ${styles.logWeightInput}`} type="number" value={entry.weight} onChange={e => updateEntry(i, 'weight', e.target.value)} placeholder="" />
                      </td>
                      <td className={styles.logPerCell}>
                        <input type="checkbox" checked={entry.perArm} onChange={e => updateEntry(i, 'perArm', e.target.checked)} title="Per arm/leg — total doubles the weight" />
                      </td>
                      <td className={styles.logTotalCell}>{total > 0 ? total : ''}</td>
                      <td className={styles.logRemoveCell}>
                        {entries.length > 1 && (
                          <button className={styles.logRemoveBtn} onClick={() => removeEntry(i)} title="Remove row">×</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
          ) : (() => {
            // Flatten workouts → one row per exercise, preserving the
            // original entry index inside w.entries so inline-edit
            // handlers can mutate the right slot even when the visible
            // list is filtered by group.
            const flatRows = [];
            for (const w of filteredHistory) {
              const visible = (w.entries || [])
                .map((e, originalIdx) => ({ e, originalIdx }))
                .filter(({ e }) => !historyGroup || e.group === historyGroup);
              visible.forEach(({ e, originalIdx }, idx) => {
                flatRows.push({ w, e, originalIdx, isFirstOfDay: idx === 0, dayCount: visible.length });
              });
            }
            return (
              <div className={styles.logTableWrap}>
                <table className={styles.logTable}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className={styles.logGroupCol}>Group</th>
                      <th className={styles.logExerciseCol}>Exercise</th>
                      <th className={styles.logNotesCol}>Notes</th>
                      <th className={styles.logSetCol} title="Set 1 reps">S1</th>
                      <th className={styles.logSetCol}>S2</th>
                      <th className={styles.logSetCol}>S3</th>
                      <th className={styles.logSetCol}>S4</th>
                      <th className={styles.logWeightCol}>Weight</th>
                      <th className={styles.logPerCol} title="Per arm/leg">×2</th>
                      <th className={styles.logTotalCol}>Total</th>
                      <th className={styles.logRemoveCol}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatRows.map(({ w, e, originalIdx, isFirstOfDay, dayCount }, ri) => {
                      const setsArr = Array.isArray(e.sets) ? e.sets : (e.sets ? Object.values(e.sets) : []);
                      const setVals = [0, 1, 2, 3].map(si => {
                        const v = setsArr[si];
                        return v == null ? '' : String(v);
                      });
                      const wt = parseFloat(e.weight) || 0;
                      const total = e.perArm ? wt * 2 : wt;
                      return (
                        <tr key={`${w.date}-${originalIdx}`} className={isFirstOfDay ? styles.historyRowDayStart : undefined}>
                          {isFirstOfDay && (
                            <td rowSpan={dayCount} className={styles.historyDateCell}>
                              <div className={styles.historyDateMain}>{formatDate(w.date)}</div>
                              <div className={styles.historyDateSub}>{w.gym}</div>
                              <select
                                className={styles.historyTypeSelect}
                                value={w.workoutType || ''}
                                onChange={ev => setHistoryWorkoutType(w.date, ev.target.value)}
                                title="Tag this workout's type"
                              >
                                <option value="">No type</option>
                                {WORKOUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <button
                                className={styles.historyDeleteDayBtn}
                                onClick={() => deleteHistoryDay(w.date)}
                                title={`Delete the ${w.date} workout`}
                                type="button"
                              >Delete day</button>
                            </td>
                          )}
                          <td>
                            <select
                              className={`${styles.logCell} ${styles.logGroupSelect}`}
                              value={e.group || ''}
                              onChange={ev => updateHistoryField(w.date, originalIdx, 'group', ev.target.value)}
                            >
                              <option value="">—</option>
                              {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                          </td>
                          <td>
                            <select
                              className={`${styles.logCell} ${styles.logExerciseSelect}`}
                              value={e.exercise || ''}
                              onChange={ev => updateHistoryField(w.date, originalIdx, 'exercise', ev.target.value)}
                              disabled={!e.group}
                            >
                              <option value="">—</option>
                              {(EXERCISES_BY_GROUP[e.group] || (e.exercise ? [e.exercise] : [])).map(ex => (
                                <option key={ex} value={ex}>{ex}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className={styles.logCell}
                              type="text"
                              value={e.notes || ''}
                              onChange={ev => updateHistoryField(w.date, originalIdx, 'notes', ev.target.value)}
                            />
                          </td>
                          {setVals.map((reps, si) => (
                            <td key={si}>
                              <input
                                className={`${styles.logCell} ${styles.logSetInput}`}
                                type="number"
                                value={reps}
                                onChange={ev => updateHistorySetField(w.date, originalIdx, si, ev.target.value)}
                              />
                            </td>
                          ))}
                          <td>
                            <input
                              className={`${styles.logCell} ${styles.logWeightInput}`}
                              type="number"
                              value={e.weight ?? ''}
                              onChange={ev => updateHistoryField(w.date, originalIdx, 'weight', ev.target.value)}
                            />
                          </td>
                          <td className={styles.logPerCell}>
                            <input
                              type="checkbox"
                              checked={!!e.perArm}
                              onChange={ev => updateHistoryField(w.date, originalIdx, 'perArm', ev.target.checked)}
                              title="Per arm/leg — total doubles the weight"
                            />
                          </td>
                          <td className={styles.logTotalCell}>{total > 0 ? total : ''}</td>
                          <td className={styles.logRemoveCell}>
                            <button
                              className={styles.logRemoveBtn}
                              onClick={() => deleteHistoryEntry(w.date, originalIdx)}
                              title="Delete this exercise"
                              type="button"
                            >×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {viewMode === 'charts' && (() => {
        const groupNames = Object.keys(chartGroupSource).sort();
        const usingLibrary = Object.keys(libraryByGroup).length > 0;
        const leftMeta = CHART_METRICS[chartLeftMetric];
        const rightMeta = CHART_METRICS[chartRightMetric];
        const fmtDelta = (v, pct) => `${v > 0 ? '+' : ''}${v.toFixed(1)} (${pct === 0 ? '0%' : `${pct > 0 ? '+' : ''}${(pct * 100).toFixed(0)}%`})`;

        // Renders title + chart + summary for a single exercise. Returns
        // an empty-state element if the exercise has too little history.
        function renderChartContent(exercise) {
          if (!exercise) return <div className={styles.chartCardEmpty}>Pick a group + exercise</div>;
          const data = buildChartData(exercise);
          if (data.length === 0) return <div className={styles.chartCardEmpty}>No sessions logged for {exercise}</div>;
          if (data.length < 2) return <div className={styles.chartCardEmpty}>Need 2+ sessions to chart {exercise}</div>;
          const dataT = withTrend(data, rightMeta.field);
          const first = data[0];
          const last = data[data.length - 1];
          const ld = last[leftMeta.field] - first[leftMeta.field];
          const rd = last[rightMeta.field] - first[rightMeta.field];
          const lPct = first[leftMeta.field] ? ld / first[leftMeta.field] : 0;
          const rPct = first[rightMeta.field] ? rd / first[rightMeta.field] : 0;
          return (
            <>
              <div className={styles.chartCardTitle}>{exercise}</div>
              <div className={styles.chartCardChart}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dataT} margin={{ top: 12, right: 36, left: 4, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      tickFormatter={d => {
                        if (!d) return '';
                        const [, m, dd] = d.split('-');
                        return `${parseInt(m)}/${parseInt(dd)}`;
                      }}
                      minTickGap={28}
                      height={24}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#dc2626' }} axisLine={false} tickLine={false} width={36} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#3B6B9C' }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.82rem', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                          <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatDate(label)}</div>
                          <div style={{ color: '#dc2626' }}>{leftMeta.label}: {d[leftMeta.field]}</div>
                          <div style={{ color: '#3B6B9C' }}>{rightMeta.label}: {d[rightMeta.field]}</div>
                        </div>
                      );
                    }} />
                    <Area yAxisId="left" type="stepAfter" dataKey={leftMeta.field} stroke="#dc2626" strokeWidth={2} fill="#fca5a5" fillOpacity={0.45} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                    <Area yAxisId="right" type="stepAfter" dataKey={rightMeta.field} stroke="#3B6B9C" strokeWidth={2} fill="#bfdbfe" fillOpacity={0.45} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                    <Line yAxisId="right" type="linear" dataKey="trend" stroke="#3B6B9C" strokeWidth={1.25} strokeOpacity={0.6} strokeDasharray="4 3" dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.chartCardSummary}>
                <span className={styles.chartCardSessions}>{data.length} sessions</span>
                <span style={{ color: '#dc2626' }}>{first[leftMeta.field]}→{last[leftMeta.field]}{ld !== 0 ? ` ${fmtDelta(ld, lPct)}` : ''}</span>
                <span style={{ color: '#3B6B9C' }}>{first[rightMeta.field]}→{last[rightMeta.field]}{rd !== 0 ? ` ${fmtDelta(rd, rPct)}` : ''}</span>
              </div>
            </>
          );
        }

        // Build the list of exercises to render in group view: every
        // library entry in the chosen group that has ≥1 session, sorted
        // by session count so the busiest exercises render first.
        const groupViewExercises = chartView !== 'custom'
          ? (chartGroupSource[chartView] || [])
              .filter(ex => !isWarmUp(ex))
              .map(ex => ({ exercise: ex, count: (exerciseHistoryByName[ex.trim().toLowerCase()] || []).length }))
              .filter(x => x.count >= 1)
              .sort((a, b) => b.count - a.count)
          : [];

        // For the "Fill 8 with most recent" buttons: ranks each library
        // exercise in the chosen group by the most recent log date.
        function fillSlotsFromGroup(group) {
          const exercises = chartGroupSource[group] || [];
          const ranked = exercises
            .filter(ex => !isWarmUp(ex))
            .map(ex => {
              const history = exerciseHistoryByName[ex.trim().toLowerCase()] || [];
              let lastDate = '';
              for (const h of history) if (h.date > lastDate) lastDate = h.date;
              return { exercise: ex, lastDate };
            })
            .filter(x => x.lastDate)
            .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
          const next = Array.from({ length: NUM_CHART_SLOTS }, (_, i) => {
            const it = ranked[i];
            return it ? { group, exercise: it.exercise } : { group: '', exercise: '' };
          });
          setChartSlots(next);
          try { localStorage.setItem('sunday-chart-slots', JSON.stringify(next)); } catch {}
        }

        return (
          <div className={styles.chartsSection}>
            <div className={styles.chartFilterRow}>
              <label className={styles.chartMetricLabel}>
                <span style={{ color: '#dc2626' }}>● Left axis</span>
                <select
                  className={styles.chartMetricSelect}
                  value={chartLeftMetric}
                  onChange={e => setChartLeftMetric(e.target.value)}
                >
                  {Object.entries(CHART_METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </label>
              <label className={styles.chartMetricLabel}>
                <span style={{ color: '#3B6B9C' }}>● Right axis</span>
                <select
                  className={styles.chartMetricSelect}
                  value={chartRightMetric}
                  onChange={e => setChartRightMetric(e.target.value)}
                >
                  {Object.entries(CHART_METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </label>
              <span className={styles.chartHint}>
                {groupNames.length === 0
                  ? 'Import your library or log workouts to populate charts.'
                  : `${usingLibrary ? 'Groups come from your library.' : ''}`}
              </span>
            </div>

            <div className={styles.chartViewRow}>
              <span className={styles.chartViewLabel}>View:</span>
              <button
                className={`${styles.chartViewBtn} ${chartView === 'custom' ? styles.chartViewBtnActive : ''}`}
                onClick={() => setChartView('custom')}
              >My {NUM_CHART_SLOTS}</button>
              {groupNames.map(g => (
                <button
                  key={g}
                  className={`${styles.chartViewBtn} ${chartView === g ? styles.chartViewBtnActive : ''}`}
                  onClick={() => setChartView(g)}
                >All {g}</button>
              ))}
            </div>

            {chartView === 'custom' && groupNames.length > 0 && (
              <div className={styles.chartViewRow}>
                <span className={styles.chartViewLabel}>Fill {NUM_CHART_SLOTS} with most recent:</span>
                {groupNames.map(g => (
                  <button
                    key={g}
                    className={styles.chartViewBtn}
                    onClick={() => fillSlotsFromGroup(g)}
                  >{g}</button>
                ))}
              </div>
            )}

            {chartView === 'custom' ? (
              <div className={styles.chartGrid}>
                {chartSlots.map((slot, idx) => {
                  const exerciseOptions = slot.group ? (chartGroupSource[slot.group] || []) : [];
                  return (
                    <div key={idx} className={styles.chartCard}>
                      <div className={styles.chartCardSelectors}>
                        <select
                          className={styles.chartCardSelect}
                          value={slot.group}
                          onChange={e => setSlot(idx, { group: e.target.value, exercise: '' })}
                        >
                          <option value="">Group</option>
                          {groupNames.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <select
                          className={styles.chartCardSelect}
                          value={slot.exercise}
                          onChange={e => setSlot(idx, { exercise: e.target.value })}
                          disabled={!slot.group}
                        >
                          <option value="">Exercise</option>
                          {exerciseOptions.filter(ex => !isWarmUp(ex)).map(ex => {
                            const n = (exerciseHistoryByName[ex.trim().toLowerCase()] || []).length;
                            return <option key={ex} value={ex}>{ex}{n > 0 ? ` (${n})` : ''}</option>;
                          })}
                        </select>
                      </div>
                      {renderChartContent(slot.exercise)}
                    </div>
                  );
                })}
              </div>
            ) : groupViewExercises.length === 0 ? (
              <div className={styles.empty}>
                No <strong>{chartView}</strong> exercises with logged sessions yet.
              </div>
            ) : (
              <div className={styles.chartGrid}>
                {groupViewExercises.map(({ exercise }) => (
                  <div key={exercise} className={styles.chartCard}>
                    {renderChartContent(exercise)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {viewMode === 'exercises' && (
        <ExerciseLibrary
          library={exerciseLibrary}
          onChange={(next) => { setExerciseLibrary(next); saveLibrary(next, user?.uid); }}
        />
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

      {showImport && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, padding: '1rem',
          }}
          onClick={() => setShowImport(false)}
        >
          <div
            style={{
              background: 'var(--color-surface)', borderRadius: 12, padding: '1.25rem',
              width: '100%', maxWidth: 720, maxHeight: '85vh', overflow: 'auto',
              boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Import Workout CSV</h2>
              <button
                style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                onClick={() => setShowImport(false)}
              >×</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
              Upload a <code>.csv</code> / <code>.tsv</code> file (most reliable for full history) or paste below.
              Supported columns:{' '}
              <code style={{ fontSize: '0.78rem' }}>Group, Exercises, Date, Gym, Notes, Rest Time, Set 1–4, Per Arm/Leg, Total Weight</code>.
              Existing workouts on the same dates will be replaced.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <label
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.45rem 0.8rem', borderRadius: 8, cursor: 'pointer',
                  background: 'var(--color-accent)', color: '#fff', fontWeight: 600,
                  fontSize: '0.85rem',
                }}
              >
                Choose file…
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                      const text = String(ev.target?.result || '');
                      setImportText(text);
                      setImportPreview(null);
                      setImportError('');
                      // Auto-parse so user sees preview immediately.
                      try {
                        const result = parseWorkoutCsv(text);
                        if (result.workouts.length > 0) setImportPreview(result);
                      } catch (err) {
                        setImportError(err.message || 'Parse failed');
                      }
                    };
                    reader.onerror = () => setImportError('Could not read the file');
                    reader.readAsText(file);
                    // Allow re-uploading the same file.
                    e.target.value = '';
                  }}
                />
              </label>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                or paste below ↓
              </span>
            </div>
            <textarea
              style={{
                width: '100%', minHeight: 180, padding: '0.6rem', borderRadius: 8,
                border: '1px solid var(--color-border)', fontFamily: 'monospace', fontSize: '0.78rem',
                background: 'var(--color-surface-alt)', resize: 'vertical', color: 'var(--color-text)',
              }}
              placeholder="Or paste your CSV/TSV content here..."
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportPreview(null); setImportError(''); }}
            />
            {importError && (
              <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 0.75rem', borderRadius: 6, marginTop: '0.5rem', fontSize: '0.82rem' }}>
                {importError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button
                className={styles.saveBtn}
                onClick={handleParseImport}
                disabled={!importText.trim()}
                style={{ flex: 1 }}
              >
                Parse & Preview
              </button>
              {importPreview && (
                <button
                  className={styles.saveBtn}
                  onClick={handleConfirmImport}
                  style={{ flex: 1, background: '#16a34a' }}
                >
                  Import {importPreview.workouts.length} workout{importPreview.workouts.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
            {importPreview && (() => {
              const totalExercises = importPreview.workouts.reduce((s, w) => s + w.entries.length, 0);
              const cleanedRowKeys = new Set(importPreview.cleanings.map(c => `${c.date}|${c.exercise}|${c.lineNum}`));
              return (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                    <strong>{importPreview.workouts.length}</strong> day{importPreview.workouts.length === 1 ? '' : 's'},{' '}
                    <strong>{totalExercises}</strong> exercises ·{' '}
                    <span style={{ color: '#92400E' }}>{importPreview.cleanings.length} row{importPreview.cleanings.length === 1 ? '' : 's'} cleaned</span> ·{' '}
                    <span style={{ color: '#991B1B' }}>{importPreview.skippedRows.length} skipped</span>
                  </div>

                  <button
                    className={styles.saveBtn}
                    onClick={handleDownloadCleaned}
                    style={{ background: '#0ea5e9', marginBottom: '0.75rem', width: '100%' }}
                  >
                    Download Cleaned CSV (TSV) — paste back into your sheet
                  </button>

                  <details style={{ marginBottom: '0.75rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '0.5rem 0.6rem' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#1E3A8A', fontSize: '0.84rem' }}>
                      Column mapping (delim: {importPreview.delim === '\t' ? 'TAB' : importPreview.delim || '?'}) — verify Set 1–4 read the right values
                    </summary>
                    <table style={{ width: '100%', fontSize: '0.78rem', marginTop: '0.4rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: '#1E3A8A' }}>
                          <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem' }}>Field</th>
                          <th style={{ textAlign: 'right', padding: '0.3rem 0.4rem' }}>Col #</th>
                          <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem' }}>Header at that index</th>
                          <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem' }}>First-row value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(importPreview.colMap).map(([field, idx]) => {
                          const headerVal = idx >= 0 ? (importPreview.headers[idx] ?? '') : '';
                          const sampleVal = idx >= 0 ? (importPreview.sampleRow[idx] ?? '') : '';
                          const notFound = idx < 0;
                          return (
                            <tr key={field} style={{ borderTop: '1px solid #BFDBFE', background: notFound ? '#FEE2E2' : undefined }}>
                              <td style={{ padding: '0.25rem 0.4rem', fontWeight: 600 }}>{field}</td>
                              <td style={{ padding: '0.25rem 0.4rem', textAlign: 'right' }}>{idx >= 0 ? idx : 'NOT FOUND'}</td>
                              <td style={{ padding: '0.25rem 0.4rem', fontFamily: 'monospace', color: '#1E3A8A' }}>{String(headerVal)}</td>
                              <td style={{ padding: '0.25rem 0.4rem', fontFamily: 'monospace' }}>{String(sampleVal) || <span style={{ color: '#999' }}>(empty)</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ fontSize: '0.72rem', color: '#1E3A8A', marginTop: '0.4rem', fontStyle: 'italic' }}>
                      First data row had {importPreview.sampleRow.length} cells. If "First-row value" for Set 1–4 looks wrong (e.g. shows "2:00" instead of a number), your spreadsheet has an extra column the parser doesn't know about.
                    </div>
                    <div style={{ marginTop: '0.6rem', fontSize: '0.74rem', color: '#1E3A8A' }}>
                      <strong>All headers in your file (showing index : header → first-row value):</strong>
                      <div style={{ marginTop: '0.3rem', fontFamily: 'monospace', fontSize: '0.72rem', background: '#fff', padding: '0.4rem', borderRadius: 4, maxHeight: 160, overflow: 'auto' }}>
                        {importPreview.headers.map((h, i) => (
                          <div key={i}>
                            <strong>{i}:</strong> "{h}" → "{importPreview.sampleRow[i] ?? ''}"
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>

                  {importPreview.cleanings.length > 0 && (
                    <details style={{ marginBottom: '0.75rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.5rem 0.6rem' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#92400E', fontSize: '0.84rem' }}>
                        {importPreview.cleanings.length} row{importPreview.cleanings.length === 1 ? '' : 's'} had cleanups
                      </summary>
                      <div style={{ maxHeight: 180, overflow: 'auto', marginTop: '0.4rem', fontSize: '0.78rem', color: '#78350F' }}>
                        {importPreview.cleanings.map((c, i) => (
                          <div key={i} style={{ marginBottom: '0.3rem' }}>
                            <strong>L{c.lineNum} · {c.date} · {c.exercise}</strong>: {c.fixes.join('; ')}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {importPreview.skippedRows.length > 0 && (
                    <details style={{ marginBottom: '0.75rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, padding: '0.5rem 0.6rem' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#991B1B', fontSize: '0.84rem' }}>
                        {importPreview.skippedRows.length} row{importPreview.skippedRows.length === 1 ? '' : 's'} skipped (couldn't import)
                      </summary>
                      <div style={{ maxHeight: 180, overflow: 'auto', marginTop: '0.4rem', fontSize: '0.78rem', color: '#7F1D1D' }}>
                        {importPreview.skippedRows.map((s, i) => (
                          <div key={i} style={{ marginBottom: '0.3rem' }}>
                            <strong>L{s.lineNum}</strong> ({s.reason}): <code style={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{s.raw.slice(0, 120)}{s.raw.length > 120 ? '…' : ''}</code>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
                    <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                      <thead style={{ background: 'var(--color-surface-alt)', position: 'sticky', top: 0 }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '0.4rem' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '0.4rem' }}>Group</th>
                          <th style={{ textAlign: 'left', padding: '0.4rem' }}>Exercise</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem' }}>Sets (reps)</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem' }}>Wt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.workouts.flatMap(w =>
                          w.entries.map((e, i) => {
                            // Find a matching cleaning entry for this row to highlight it.
                            const wasCleaned = importPreview.cleanings.some(
                              c => c.date === w.date && c.exercise === e.exercise,
                            );
                            return (
                              <tr key={`${w.date}-${i}`} style={{ borderTop: '1px solid var(--color-border-light)', background: wasCleaned ? '#FEF3C7' : undefined }}>
                                <td style={{ padding: '0.35rem 0.4rem', whiteSpace: 'nowrap' }}>{w.date}</td>
                                <td style={{ padding: '0.35rem 0.4rem' }}>{e.group}</td>
                                <td style={{ padding: '0.35rem 0.4rem' }}>{e.exercise}{wasCleaned && <span title="cleaned" style={{ marginLeft: 4, color: '#92400E' }}>⚠</span>}</td>
                                <td style={{ padding: '0.35rem 0.4rem', textAlign: 'right' }}>{e.sets.filter(s => s !== '').join(', ')}</td>
                                <td style={{ padding: '0.35rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  {e.weight ? `${e.weight}${e.perArm ? ' ×2' : ''}` : '—'}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
