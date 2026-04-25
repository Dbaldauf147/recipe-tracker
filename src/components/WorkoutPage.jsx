import { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { saveField } from '../utils/firestoreSync';
import { ExerciseLibrary } from './ExerciseLibrary';
import styles from './WorkoutPage.module.css';

const CHART_METRICS = {
  avgReps: { label: 'Avg Reps', field: 'avgReps' },
  totalReps: { label: 'Total Reps', field: 'totalReps' },
  maxReps: { label: 'Max Reps', field: 'maxReps' },
  weight: { label: 'Weight', field: 'totalWeight' },
  maxWeight: { label: 'Max Weight', field: 'maxWeight' },
};

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
  const [gym, setGym] = useState(GYMS[0]);
  const [entries, setEntries] = useState([emptyEntry()]);
  const [viewMode, setViewMode] = useState('log'); // 'log' | 'history' | 'charts' | 'exercises' | 'stats'
  const [exerciseLibrary, setExerciseLibrary] = useState(loadLibrary);
  const [historyGroup, setHistoryGroup] = useState('');
  const [chartGroup, setChartGroup] = useState('');
  const [chartExercise, setChartExercise] = useState('');
  const [chartLeftMetric, setChartLeftMetric] = useState('avgReps');
  const [chartRightMetric, setChartRightMetric] = useState('weight');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');

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

  // Time series for the selected exercise: one row per session, ordered by
  // date. Includes all metrics so the user can pick which one renders on each
  // axis without re-aggregating. Looks up history by exercise name (not
  // group) so a Push-grouped library exercise still finds Chest-grouped
  // history entries.
  const chartData = useMemo(() => {
    if (!chartExercise) return [];
    const history = exerciseHistoryByName[chartExercise.trim().toLowerCase()] || [];
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
  }, [chartExercise, exerciseHistoryByName]);

  // Augment chart data with a least-squares trend line on the right-axis
  // metric so the user can see overall progression at a glance, regardless
  // of session-to-session noise.
  const chartDataWithTrend = useMemo(() => {
    if (chartData.length < 2) return chartData;
    const field = CHART_METRICS[chartRightMetric].field;
    const n = chartData.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      const y = chartData[i][field];
      sumX += i;
      sumY += y;
      sumXY += i * y;
      sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return chartData;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return chartData.map((d, i) => ({ ...d, trend: intercept + slope * i }));
  }, [chartData, chartRightMetric]);

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
          ) : (() => {
            // Flatten workouts → one row per exercise. Date shows on the first
            // row of each workout day (rowSpan), keeping the grouping visible
            // while presenting everything as a single sortable-feeling table.
            const flatRows = [];
            for (const w of filteredHistory) {
              const dayEntries = (w.entries || []).filter(e => !historyGroup || e.group === historyGroup);
              dayEntries.forEach((e, idx) => {
                flatRows.push({ w, e, isFirstOfDay: idx === 0, dayCount: dayEntries.length });
              });
            }
            return (
              <div className={styles.historyTableWrap}>
                <table className={styles.historyTable}>
                  <colgroup>
                    <col className={styles.colDate} />
                    <col className={styles.colGroup} />
                    <col className={styles.colExercise} />
                    <col className={styles.colSet} />
                    <col className={styles.colSet} />
                    <col className={styles.colSet} />
                    <col className={styles.colSet} />
                    <col className={styles.colWeight} />
                    <col className={styles.colNotes} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Group</th>
                      <th>Exercise</th>
                      <th title="Set 1 reps">S1</th>
                      <th title="Set 2 reps">S2</th>
                      <th title="Set 3 reps">S3</th>
                      <th title="Set 4 reps">S4</th>
                      <th>Weight</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatRows.map(({ w, e, isFirstOfDay, dayCount }, ri) => {
                      // Coerce sets into a 4-slot array of strings regardless
                      // of how the data was saved (string array, number array,
                      // missing, object, etc.). This is defensive so the
                      // display works on legacy entries too.
                      const setsArr = Array.isArray(e.sets) ? e.sets : (e.sets ? Object.values(e.sets) : []);
                      const setVals = [0, 1, 2, 3].map(si => {
                        const v = setsArr[si];
                        if (v == null) return '';
                        const s = String(v).trim();
                        if (!s || /^#/.test(s)) return '';
                        return s;
                      });
                      const debugTitle = `sets: ${JSON.stringify(setsArr)}`;
                      return (
                        <tr key={ri} className={isFirstOfDay ? styles.historyRowDayStart : undefined}>
                          {isFirstOfDay && (
                            <td rowSpan={dayCount} className={styles.historyDateCell}>
                              <div className={styles.historyDateMain}>{formatDate(w.date)}</div>
                              <div className={styles.historyDateSub}>{w.gym}</div>
                            </td>
                          )}
                          <td><span className={styles.historyGroup}>{e.group}</span></td>
                          <td className={styles.historyExerciseCell} title={debugTitle}>{e.exercise}</td>
                          {setVals.map((reps, si) => (
                            <td
                              key={si}
                              className={styles.historySetCell}
                              title={reps ? `Set ${si + 1}: ${reps} reps` : `Set ${si + 1}: not done · ${debugTitle}`}
                              style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.95rem' }}
                            >
                              {reps !== '' ? reps : <span style={{ color: '#999', fontWeight: 400 }}>—</span>}
                            </td>
                          ))}
                          <td className={styles.historyWeightCell}>
                            {e.totalWeight ? `${e.totalWeight}${e.perArm ? ' (×2)' : ''}` : '—'}
                          </td>
                          <td className={styles.historyNotesCell}>{e.notes || ''}</td>
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
        const exerciseOptions = chartGroup ? (chartGroupSource[chartGroup] || []) : [];
        const leftMeta = CHART_METRICS[chartLeftMetric];
        const rightMeta = CHART_METRICS[chartRightMetric];
        const sessionCount = chartExercise
          ? (exerciseHistoryByName[chartExercise.trim().toLowerCase()] || []).length
          : 0;
        return (
          <div className={styles.chartsSection}>
            <div className={styles.chartFilterRow}>
              <select
                className={styles.groupSelect}
                value={chartGroup}
                onChange={e => { setChartGroup(e.target.value); setChartExercise(''); }}
              >
                <option value="">{usingLibrary ? 'Group' : 'Muscle Group'}</option>
                {groupNames.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select
                className={styles.exerciseSelect}
                value={chartExercise}
                onChange={e => setChartExercise(e.target.value)}
                disabled={!chartGroup}
              >
                <option value="">Exercise</option>
                {exerciseOptions.map(ex => {
                  const n = (exerciseHistoryByName[ex.trim().toLowerCase()] || []).length;
                  return <option key={ex} value={ex}>{ex}{n > 0 ? ` (${n})` : ''}</option>;
                })}
              </select>
            </div>
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
            </div>

            {!chartExercise ? (
              <div className={styles.empty}>
                {groupNames.length === 0
                  ? 'Import your exercise library or log workouts to see charts here.'
                  : usingLibrary
                    ? 'Pick a group and exercise from your library to see its trend over time.'
                    : 'Pick a muscle group and exercise to see its trend over time.'}
              </div>
            ) : sessionCount === 0 ? (
              <div className={styles.empty}>
                No sessions logged for <strong>{chartExercise}</strong> yet.
                {usingLibrary && ' (Names must match the workout log exactly.)'}
              </div>
            ) : chartData.length < 2 ? (
              <div className={styles.empty}>
                Only {chartData.length} session logged for {chartExercise}. Log at least 2 to see a chart.
              </div>
            ) : (
              <>
                <div className={styles.chartTitle}>{chartExercise}</div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartDataWithTrend} margin={{ top: 20, right: 40, left: 10, bottom: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        tickFormatter={d => {
                          if (!d) return '';
                          const [y, m, dd] = d.split('-');
                          return `${parseInt(m)}/${parseInt(dd)}/${y}`;
                        }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                        minTickGap={20}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 11, fill: '#dc2626' }}
                        axisLine={{ stroke: '#e5e7eb' }}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11, fill: '#3B6B9C' }}
                        axisLine={{ stroke: '#e5e7eb' }}
                        tickLine={false}
                      />
                      <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.82rem', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                            <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatDate(label)}</div>
                            <div style={{ color: '#dc2626' }}>{leftMeta.label}: {d[leftMeta.field]}</div>
                            <div style={{ color: '#3B6B9C' }}>{rightMeta.label}: {d[rightMeta.field]}</div>
                          </div>
                        );
                      }} />
                      <Legend verticalAlign="top" height={28} />
                      <Area
                        yAxisId="left"
                        type="stepAfter"
                        dataKey={leftMeta.field}
                        name={leftMeta.label}
                        stroke="#dc2626"
                        strokeWidth={2}
                        fill="#fca5a5"
                        fillOpacity={0.45}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Area
                        yAxisId="right"
                        type="stepAfter"
                        dataKey={rightMeta.field}
                        name={rightMeta.label}
                        stroke="#3B6B9C"
                        strokeWidth={2}
                        fill="#bfdbfe"
                        fillOpacity={0.45}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        yAxisId="right"
                        type="linear"
                        dataKey="trend"
                        name={`${rightMeta.label} trend`}
                        stroke="#3B6B9C"
                        strokeWidth={1.5}
                        strokeOpacity={0.6}
                        strokeDasharray="4 3"
                        dot={false}
                        activeDot={false}
                        legendType="none"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {(() => {
                  const first = chartData[0];
                  const last = chartData[chartData.length - 1];
                  const lf = leftMeta.field;
                  const rf = rightMeta.field;
                  const ld = last[lf] - first[lf];
                  const rd = last[rf] - first[rf];
                  const fmt = (v, d) => `${d > 0 ? '+' : ''}${v.toFixed(1)} (${d === 0 ? '0%' : `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%`})`;
                  const lPct = first[lf] ? ld / first[lf] : 0;
                  const rPct = first[rf] ? rd / first[rf] : 0;
                  return (
                    <div className={styles.chartSummary}>
                      <strong>{chartData.length} sessions</strong> · {formatDate(first.date)} → {formatDate(last.date)}
                      <span className={styles.chartDelta} style={{ color: '#dc2626' }}>
                        {leftMeta.label}: {first[lf]} → {last[lf]} {ld !== 0 && <em>{fmt(ld, lPct)}</em>}
                      </span>
                      <span className={styles.chartDelta} style={{ color: '#3B6B9C' }}>
                        {rightMeta.label}: {first[rf]} → {last[rf]} {rd !== 0 && <em>{fmt(rd, rPct)}</em>}
                      </span>
                    </div>
                  );
                })()}
              </>
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
