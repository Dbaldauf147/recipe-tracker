import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, ReferenceLine } from 'recharts';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { saveField, saveWorkoutDraft, clearWorkoutDraft } from '../utils/firestoreSync';
import { exportWorkoutHistoryToCSV } from '../utils/exportData';
import { parseSetValue, formatSeconds, computeSetStats } from '../utils/setValue';
import { ExerciseLibrary, effectiveMuscleGroup } from './ExerciseLibrary';
import { BodyHeatmap } from './BodyHeatmap';
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

const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Biceps', 'Triceps', 'Abs', 'Forearms', 'Cardio', 'Yoga', 'Heat', 'Whole Body'];

const EXERCISES_BY_GROUP = {
  Chest: ['Warm up', 'Butterfly', 'Cable crossover low to high', 'Cable flys declined', 'Chest press', 'Close grip bench press', 'Decline Barbell Press', 'Decline press', 'Decline push-up', 'Dips', 'Dumbbell flys', 'Dumbbell press', 'Dumbbell press inclined', 'Dumbbell squeeze press', 'Incline press', 'Incline push-up', 'Inclined Barbell Press', 'Inclined machine press', 'Inclined smith machine press'],
  Back: ['Warm up', 'Back extensions', 'Back extensions - machine', 'Bent-over dumbbell row', 'Bent-over smith machine row', 'Cable lat pullover', 'Chin ups', 'Face pulls', 'Lat pull down (wide grip)', 'Lat pull downs (bar)', 'Lat pull downs (bar) underhand grip', 'Lat pull downs (machine)', 'Lat pulldown (vbar grip)', 'Middle grip row', 'One arm rows', 'Plate-loaded low row', 'Pull-ups', 'Seated cable row', 'Seated neutral grip row', 'Seated pronated machine row', 'Seated vertical row machine', 'Single arm cable row', 'Single arm lat pulldown', 'Standing bent-over dumbbell row', 'T bar machine', 'Two arm cable row', 'Weighted pull-up', 'Wide grip row'],
  Legs: ['Warm up', 'Air squats', 'Barbell squats', 'Bulgarian split squat', 'Calf raise', 'Curtsey lunges', 'Deadlifts', 'Dumbbell deadlift', 'Glute bridges', 'Good mornings', 'Hamstring curls', 'Hip thrust_barbell', 'Jump rope', 'Leg extensions', 'Leg press', 'Leg press calf raise', 'Romanian deadlifts - barbell', 'Romanian deadlifts - dumbbell', 'Seated abductors', 'Single leg extension', 'Single leg press', 'Squats - Barbell', 'Squats - Smith machine', 'Sumo squat', 'Sumo squat cable machine', 'Walk', 'Wall squats'],
  Shoulders: ['Warm up', 'Arm raises', 'Arm raises - Lateral', 'Cable lateral raise', 'Dumbbell shoulder press', 'Face pull', 'Shoulder press'],
  Biceps: ['Warm up', 'Bar curls', 'Barbell Curls', 'Bayesian bicep curl', 'Bicep curl', 'Bicep curl machine', 'Bicep hammer curls', 'Hammer rope curls', 'Preacher curl', 'Reverse bar bell curls'],
  Triceps: ['Warm up', 'Cable tricep kickback', 'Extension', 'Seated tricep', 'Triangle pushup', 'Tricep push down machine', 'Tricep pushdown', 'Tricep rope pushdowns'],
  Abs: ['Warm up', 'Ab crunch machine', 'Ab roller', 'Cable crunches', 'Cable woodchoppers', 'Cable woodchoppers - High to low', 'Deadbug', 'Dragon flag abs', 'Elbow plank', 'Hanging leg raise', 'Hanging leg raises knees bent', 'Hanging leg raises legs straight', 'Heel taps', 'Kneeling halo', 'Leg raises', 'Pallof press', 'Plank', 'Seated cable crunch', 'Side bend', 'Toe touches'],
  Forearms: ['Warm up', 'Wrist curls', 'Wrist extensions', 'Reverse wrist curls', 'Farmer walks'],
  Cardio: ['Walk', 'Run', 'Bike', 'Recumbent upright bike', 'Jump rope', 'Rowing machine', 'Elliptical', 'Stair climber'],
  Yoga: ['Yoga flow', 'Stretching', 'Foam rolling', 'Bikram hot yoga', 'Vinyasa', 'Yin'],
  Heat: ['Sauna', 'Hottub', 'Steam room'],
  'Whole Body': ['Warm up', 'Circuit training', 'HIIT'],
};

const DEFAULT_GYMS = ['Edge South Tower', 'Home', 'Other'];
const GYMS_KEY = 'sunday-workout-gyms';

function loadGyms() {
  try {
    const v = JSON.parse(localStorage.getItem(GYMS_KEY));
    if (Array.isArray(v) && v.length > 0) {
      return v.map(g => (typeof g === 'string' ? g.trim() : '')).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [...DEFAULT_GYMS];
}

function saveGyms(data, uid) {
  localStorage.setItem(GYMS_KEY, JSON.stringify(data));
  if (uid) saveField(uid, 'gyms', data);
}

const DEFAULT_WORKOUT_TYPES = ['Push', 'Pull', 'Legs', 'Full Body', 'Yoga'];

const LOG_COLUMN_DEFS = [
  { id: 'group', default: 100, min: 60 },
  { id: 'exercise', default: 220, min: 120 },
  { id: 'notes', default: 220, min: 120 },
  { id: 'time', default: 60, min: 40 },
  { id: 's1', default: 44, min: 32 },
  { id: 's2', default: 44, min: 32 },
  { id: 's3', default: 44, min: 32 },
  { id: 's4', default: 44, min: 32 },
  { id: 'weight', default: 80, min: 60 },
  { id: 'per', default: 80, min: 64 },
  { id: 'total', default: 70, min: 50 },
  { id: 'remove', default: 32, min: 28 },
];
const COL_WIDTHS_KEY = 'sunday-workout-log-col-widths';
const DEFAULT_COL_WIDTHS = LOG_COLUMN_DEFS.reduce((acc, c) => { acc[c.id] = c.default; return acc; }, {});

function loadColWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY)) || {};
    const merged = { ...DEFAULT_COL_WIDTHS };
    for (const c of LOG_COLUMN_DEFS) {
      if (typeof saved[c.id] === 'number' && saved[c.id] >= c.min) {
        merged[c.id] = saved[c.id];
      }
    }
    return merged;
  } catch { return { ...DEFAULT_COL_WIDTHS }; }
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr + 'T00:00:00').getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

const STORAGE_KEY = 'sunday-workout-log';
const LIBRARY_KEY = 'sunday-exercise-library';
const WORKOUT_TYPES_KEY = 'sunday-workout-types';

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

function loadWorkoutTypes() {
  try {
    const raw = localStorage.getItem(WORKOUT_TYPES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr.map(s => String(s)).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [...DEFAULT_WORKOUT_TYPES];
}

function saveWorkoutTypes(data, uid) {
  localStorage.setItem(WORKOUT_TYPES_KEY, JSON.stringify(data));
  if (uid) saveField(uid, 'workoutTypes', data);
}

const SKIP_DATES_KEY = 'sunday-workout-type-skip-dates';

function loadSkipDates() {
  try {
    const raw = localStorage.getItem(SKIP_DATES_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    }
  } catch { /* fall through */ }
  return {};
}

function saveSkipDates(map, uid) {
  localStorage.setItem(SKIP_DATES_KEY, JSON.stringify(map));
  if (uid) saveField(uid, 'workoutTypeSkipDates', map);
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
// edits keep totalReps/maxReps/avgReps/totalSeconds/maxSeconds/
// totalWeight/maxWeight in sync. Rep stats sum only rep cells; time
// stats sum only time cells (30s, 2m, 1:30 — see utils/setValue).
function enrichEntry(e) {
  const { editedFields: _editedFields, ...rest } = e;
  const sets = Array.isArray(rest.sets) ? rest.sets : [];
  const stats = computeSetStats(sets);
  const { totalReps, maxReps, avgReps, totalSeconds, maxSeconds } = stats;

  // Compute representative weight + max for stats. When per-set mode is
  // on, derive `weight` from the first non-empty setWeights value so any
  // older clients (or this app's history-flat list views) still render a
  // sensible number; maxWeight reflects the heaviest single set × 2 if
  // per-arm.
  let representativeWeight = rest.weight;
  let perSetMax = 0;
  if (rest.useSetWeights && Array.isArray(rest.setWeights)) {
    const nums = rest.setWeights
      .map(v => parseFloat(v || ''))
      .filter(n => !isNaN(n));
    if (nums.length > 0) {
      perSetMax = Math.max(...nums);
      const firstNonEmpty = rest.setWeights.find(v => (v || '').toString().trim() !== '');
      if (firstNonEmpty != null) representativeWeight = firstNonEmpty;
    }
  }
  const baseWeight = rest.useSetWeights && perSetMax > 0
    ? perSetMax
    : (parseFloat(rest.weight) || 0);
  const totalWeight = rest.perArm ? baseWeight * 2 : baseWeight;

  return {
    ...rest,
    weight: representativeWeight,
    totalReps,
    maxReps,
    avgReps,
    totalSeconds,
    maxSeconds,
    totalWeight,
    maxWeight: totalWeight,
  };
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
const WORKOUT_TARGET_OPTIONS = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'group', label: 'Group' },
  { value: 'exercise', label: 'Exercises' },
  { value: 'date', label: 'Date' },
  { value: 'gym', label: 'Gym' },
  { value: 'notes', label: 'Notes' },
  { value: 'rest', label: 'Rest Time' },
  { value: 'set1', label: 'Set 1' },
  { value: 'set2', label: 'Set 2' },
  { value: 'set3', label: 'Set 3' },
  { value: 'set4', label: 'Set 4' },
  { value: 'perSide', label: 'Per Arm/Leg' },
  { value: 'totalWt', label: 'Total Weight' },
  { value: 'workoutType', label: 'Workout Type' },
];

const WORKOUT_TARGET_BY_DISPLAY = {
  Group: 'group',
  Exercises: 'exercise',
  Date: 'date',
  Gym: 'gym',
  Notes: 'notes',
  'Rest Time': 'rest',
  'Set 1': 'set1',
  'Set 2': 'set2',
  'Set 3': 'set3',
  'Set 4': 'set4',
  'Per Arm/Leg': 'perSide',
  'Total Weight': 'totalWt',
  'Workout Type': 'workoutType',
};

function getCsvHeadersAndSample(text) {
  if (!text || !text.trim()) return { headers: [], sampleRow: [], delim: ',' };
  const delim = detectDelim(text);
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], sampleRow: [], delim };
  const headers = splitCsvLineQuoted(lines[0], delim);
  const sampleRow = lines.length > 1 ? splitCsvLineQuoted(lines[1], delim) : [];
  return { headers, sampleRow, delim };
}

function deriveColMapOverride(parsedColMap, ncols) {
  const result = {};
  for (let i = 0; i < ncols; i++) result[i] = 'ignore';
  for (const [display, idx] of Object.entries(parsedColMap || {})) {
    if (idx >= 0 && WORKOUT_TARGET_BY_DISPLAY[display]) {
      result[idx] = WORKOUT_TARGET_BY_DISPLAY[display];
    }
  }
  return result;
}

function parseWorkoutCsv(text, overrideMap = null) {
  const delim = detectDelim(text);
  // Strip BOM (Google Sheets CSV export sometimes prepends one).
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { workouts: [], skippedRows: [], cleanings: [], headers: [], colMap: {}, sampleRow: [], delim: delim };
  const headers = splitCsvLineQuoted(lines[0], delim);

  let colGroup, colExercise, colDate, colGym, colNotes, colRest, colSet1, colSet2, colSet3, colSet4, colPerSide, colTotalWt, colWorkoutType;

  if (overrideMap && Object.keys(overrideMap).length > 0) {
    colGroup = colExercise = colDate = colGym = colNotes = colRest = -1;
    colSet1 = colSet2 = colSet3 = colSet4 = colPerSide = colTotalWt = colWorkoutType = -1;
    for (const [idxStr, target] of Object.entries(overrideMap)) {
      const idx = Number(idxStr);
      if (target === 'group') colGroup = idx;
      else if (target === 'exercise') colExercise = idx;
      else if (target === 'date') colDate = idx;
      else if (target === 'gym') colGym = idx;
      else if (target === 'notes') colNotes = idx;
      else if (target === 'rest') colRest = idx;
      else if (target === 'set1') colSet1 = idx;
      else if (target === 'set2') colSet2 = idx;
      else if (target === 'set3') colSet3 = idx;
      else if (target === 'set4') colSet4 = idx;
      else if (target === 'perSide') colPerSide = idx;
      else if (target === 'totalWt') colTotalWt = idx;
      else if (target === 'workoutType') colWorkoutType = idx;
    }
  } else {
    colGroup        = findCol(headers, ['group']);
    colExercise     = findCol(headers, ['exercises', 'exercise']);
    colDate         = findCol(headers, ['date']);
    colGym          = findCol(headers, ['gym', 'location']);
    colNotes        = findCol(headers, ['notes', 'note']);
    colRest         = findCol(headers, ['rest time', 'rest', 'time']);
    colSet1         = findCol(headers, ['set 1', 'set1', 's1', 'reps 1', 'set1 reps']);
    colSet2         = findCol(headers, ['set 2', 'set2', 's2', 'reps 2', 'set2 reps']);
    colSet3         = findCol(headers, ['set 3', 'set3', 's3', 'reps 3', 'set3 reps']);
    colSet4         = findCol(headers, ['set 4', 'set4', 's4', 'reps 4', 'set4 reps']);
    colPerSide      = findCol(headers, ['per arm/leg', 'per arm', 'per side', 'weight per side']);
    colTotalWt      = findCol(headers, ['total weight', 'weight']);
    colWorkoutType  = findCol(headers, ['workout type', 'type']);

    // Positional fallback only on auto-detect: if Set 1–4 weren't matched by
    // name but the row has a known anchor on each side (Notes/Date on the
    // left, Per Arm/Leg or Total Weight on the right), infer by position.
    if (colSet1 < 0 || colSet2 < 0 || colSet3 < 0 || colSet4 < 0) {
      const leftAnchor = colNotes >= 0 ? colNotes : (colGym >= 0 ? colGym : colDate);
      const rightAnchor = colPerSide >= 0 ? colPerSide : (colTotalWt >= 0 ? colTotalWt : -1);
      if (leftAnchor >= 0 && rightAnchor > leftAnchor) {
        const gap = rightAnchor - leftAnchor - 1;
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
  }

  if (colDate < 0 || colExercise < 0) {
    throw new Error('CSV must have Date and Exercises columns mapped (use the column-mapping panel below).');
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

    // The Per Arm/Leg column can be either a per-side numeric weight (old
    // Sheets format) or a Yes/No flag (this app's own export format).
    const perArmRaw = colPerSide >= 0 ? String(cells[colPerSide] ?? '').trim() : '';
    let perArmBool = null;
    let perSideNum = '';
    if (perArmRaw !== '') {
      if (/^(yes|true|y)$/i.test(perArmRaw)) perArmBool = true;
      else if (/^(no|false|n)$/i.test(perArmRaw)) perArmBool = false;
      else {
        const v = cleanCell(perArmRaw, 'Per Arm/Leg', 'float', fixes);
        if (v !== '') perSideNum = v;
      }
    }
    const totalWt = colTotalWt >= 0 ? cleanCell(cells[colTotalWt], 'Total Weight', 'float', fixes) : '';

    let weight = '';
    let perArm = false;
    if (perArmBool !== null) {
      perArm = perArmBool;
      weight = totalWt !== '' ? String(totalWt) : '';
    } else if (perSideNum !== '' && totalWt !== '') {
      perArm = Math.abs(perSideNum * 2 - totalWt) < 1;
      weight = String(perSideNum);
    } else if (perSideNum !== '') {
      weight = String(perSideNum);
      perArm = true;
    } else if (totalWt !== '') {
      weight = String(totalWt);
    }

    const workoutType = colWorkoutType >= 0 ? (cells[colWorkoutType] || '').trim() : '';

    const entry = { group, exercise, sets, perArm, weight, notes, time };
    if (fixes.length > 0) cleanings.push({ lineNum, date, exercise, fixes });

    if (!byDate.has(date)) byDate.set(date, { date, gym: gym || 'Edge South Tower', workoutType: '', entries: [] });
    const bucket = byDate.get(date);
    if (!bucket.gym && gym) bucket.gym = gym;
    if (!bucket.workoutType && workoutType) bucket.workoutType = workoutType;
    bucket.entries.push(entry);
  }

  const workouts = [];
  for (const w of byDate.values()) {
    const enriched = w.entries.map(e => {
      const { totalReps, maxReps, avgReps, totalSeconds, maxSeconds } = computeSetStats(e.sets);
      const wt = parseFloat(e.weight) || 0;
      const totalWeight = e.perArm ? wt * 2 : wt;
      return { ...e, totalReps, maxReps, avgReps, totalSeconds, maxSeconds, totalWeight, maxWeight: totalWeight };
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
    'Workout Type': colWorkoutType,
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

// Reads daily step counts that the mobile app pulled from Apple Health
// and saved into the dailyLog subcollection. Pure read-only on the web —
// you set up HealthKit syncing in the iOS app.
function StepsTab({ user }) {
  const [stepsByDate, setStepsByDate] = useState({});
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  useEffect(() => {
    if (!user?.uid) {
      setStepsByDate({});
      setLoading(false);
      return;
    }
    const ref = doc(db, 'users', user.uid, 'data', 'dailyLog');
    const unsub = onSnapshot(
      ref,
      snap => {
        const log = (snap.exists() && snap.data().log) || {};
        const map = {};
        for (const [date, day] of Object.entries(log)) {
          const s = (day || {}).steps;
          if (typeof s === 'number' && !isNaN(s)) map[date] = s;
        }
        setStepsByDate(map);
        setLoading(false);
      },
      err => { console.error('StepsTab subscription error:', err); setLoading(false); },
    );
    return () => unsub();
  }, [user?.uid]);

  const chartData = useMemo(() => {
    const out = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const steps = stepsByDate[iso];
      out.push({
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        iso,
        steps: typeof steps === 'number' ? Math.round(steps) : null,
      });
    }
    return out;
  }, [stepsByDate, range]);

  const recentValues = chartData.map(d => d.steps).filter(s => s != null);
  const total = recentValues.reduce((a, b) => a + b, 0);
  const avg = recentValues.length ? Math.round(total / recentValues.length) : 0;
  const best = recentValues.length ? Math.max(...recentValues) : 0;
  const target = 10000;

  if (loading) {
    return <div className={styles.statsSection}><p style={{ color: 'var(--color-text-muted)' }}>Loading…</p></div>;
  }

  if (recentValues.length === 0) {
    return (
      <div className={styles.statsSection}>
        <h3 style={{ marginTop: 0 }}>Steps</h3>
        <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          No step counts have synced yet. To start tracking:
        </p>
        <ol style={{ color: 'var(--color-text-muted)', lineHeight: 1.6, paddingLeft: '1.25rem' }}>
          <li>Open Prep Day on iPhone.</li>
          <li>Profile → enable <strong>Apple Health sync</strong>, allow Steps access.</li>
          <li>Open the Track Meals tab; the day's step count syncs in the background.</li>
        </ol>
        <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Once it's enabled, this tab will show your trend.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.statsSection}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Steps</h3>
        <div className={styles.tabs} style={{ marginBottom: 0 }}>
          {[7, 14, 30, 90, 365].map(r => (
            <button
              key={r}
              type="button"
              className={`${styles.tab} ${range === r ? styles.tabActive : ''}`}
              onClick={() => setRange(r)}
            >
              {r === 365 ? '1y' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.statCards} style={{ marginBottom: '1rem' }}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{avg.toLocaleString()}</div>
          <div className={styles.statLabel}>Daily average</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{best.toLocaleString()}</div>
          <div className={styles.statLabel}>Best day</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{total.toLocaleString()}</div>
          <div className={styles.statLabel}>Total · {recentValues.length}d</div>
        </div>
      </div>

      <div style={{ width: '100%', height: 320, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '1rem 0.5rem 0.75rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 12, left: -8, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={48} />
            <Tooltip
              formatter={(v) => [`${(v ?? 0).toLocaleString()} steps`, '']}
              labelStyle={{ fontWeight: 600 }}
              contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
            />
            <ReferenceLine
              y={target}
              stroke="#16a34a"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `${target.toLocaleString()}`, position: 'insideTopRight', fontSize: 10, fill: '#16a34a' }}
            />
            <Bar dataKey="steps" fill="#3B6B9C" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Recent days</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {chartData.slice().reverse().filter(d => d.steps != null).slice(0, 14).map(d => (
            <div
              key={d.iso}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0.75rem',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: '0.85rem',
              }}
            >
              <span style={{ color: 'var(--color-text)' }}>
                {new Date(d.iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span style={{ fontWeight: 700, color: d.steps >= target ? '#16a34a' : 'var(--color-text)' }}>
                {d.steps.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Reads daily sleep totals (in hours) that the mobile app pulled from
// Apple Health and saved into the dailyLog subcollection. Read-only on
// the web — the mobile tracker writes the snapshot whenever HealthKit
// returns a fresh sleep total for the active day.
function SleepTab({ user }) {
  const [sleepByDate, setSleepByDate] = useState({});
  const [breakdownByDate, setBreakdownByDate] = useState({});
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);
  const [expandedDate, setExpandedDate] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setSleepByDate({});
      setBreakdownByDate({});
      setLoading(false);
      return;
    }
    const ref = doc(db, 'users', user.uid, 'data', 'dailyLog');
    const unsub = onSnapshot(
      ref,
      snap => {
        const log = (snap.exists() && snap.data().log) || {};
        const sleepMap = {};
        const breakdownMap = {};
        for (const [date, day] of Object.entries(log)) {
          const d = day || {};
          const s = d.sleep;
          if (typeof s === 'number' && !isNaN(s)) sleepMap[date] = s;
          if (d.sleepBreakdown && typeof d.sleepBreakdown === 'object') {
            breakdownMap[date] = d.sleepBreakdown;
          }
        }
        setSleepByDate(sleepMap);
        setBreakdownByDate(breakdownMap);
        setLoading(false);
      },
      err => { console.error('SleepTab subscription error:', err); setLoading(false); },
    );
    return () => unsub();
  }, [user?.uid]);

  const chartData = useMemo(() => {
    const out = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const hours = sleepByDate[iso];
      out.push({
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        iso,
        hours: typeof hours === 'number' ? Math.round(hours * 10) / 10 : null,
      });
    }
    return out;
  }, [sleepByDate, range]);

  const recentValues = chartData.map(d => d.hours).filter(s => s != null);
  const total = recentValues.reduce((a, b) => a + b, 0);
  const avg = recentValues.length ? Math.round((total / recentValues.length) * 10) / 10 : 0;
  const best = recentValues.length ? Math.max(...recentValues) : 0;
  const worst = recentValues.length ? Math.min(...recentValues) : 0;
  const target = 8;

  if (loading) {
    return <div className={styles.statsSection}><p style={{ color: 'var(--color-text-muted)' }}>Loading…</p></div>;
  }

  if (recentValues.length === 0) {
    return (
      <div className={styles.statsSection}>
        <h3 style={{ marginTop: 0 }}>Sleep</h3>
        <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          No sleep data has synced yet. To start tracking:
        </p>
        <ol style={{ color: 'var(--color-text-muted)', lineHeight: 1.6, paddingLeft: '1.25rem' }}>
          <li>Make sure your iPhone or Apple Watch is recording sleep (or your sleep tracker writes to Apple Health).</li>
          <li>Open Prep Day on iPhone → Profile → enable <strong>Apple Health sync</strong> and grant Sleep Analysis access.</li>
          <li>Open the Track Meals tab; the last 30 days of sleep totals sync in the background.</li>
        </ol>
        <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Once it's enabled, this tab will show your trend.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.statsSection}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Sleep</h3>
        <div className={styles.tabs} style={{ marginBottom: 0 }}>
          {[7, 14, 30, 90, 365].map(r => (
            <button
              key={r}
              type="button"
              className={`${styles.tab} ${range === r ? styles.tabActive : ''}`}
              onClick={() => setRange(r)}
            >
              {r === 365 ? '1y' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.statCards} style={{ marginBottom: '1rem' }}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{avg}h</div>
          <div className={styles.statLabel}>Daily average</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{best}h</div>
          <div className={styles.statLabel}>Best night</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{worst}h</div>
          <div className={styles.statLabel}>Worst night</div>
        </div>
      </div>

      <div style={{ width: '100%', height: 320, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '1rem 0.5rem 0.75rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 12, left: -8, bottom: 5 }}
            onClick={(e) => {
              const iso = e?.activePayload?.[0]?.payload?.iso;
              if (iso) setExpandedDate(prev => (prev === iso ? null : iso));
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={36} unit="h" />
            <Tooltip
              formatter={(v) => [`${v}h`, '']}
              labelStyle={{ fontWeight: 600 }}
              contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
            />
            <ReferenceLine
              y={target}
              stroke="#7c3aed"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `${target}h goal`, position: 'insideTopRight', fontSize: 10, fill: '#7c3aed' }}
            />
            <Bar dataKey="hours" fill="#8b5cf6" radius={[4, 4, 0, 0]} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.4rem', fontStyle: 'italic' }}>
        Tap a bar — or any night below — to see REM, Core, Deep, and Awake.
      </p>

      {(() => {
        if (!expandedDate) return null;
        const breakdown = breakdownByDate[expandedDate] || {};
        const total = sleepByDate[expandedDate];
        const stages = [
          { key: 'rem',   label: 'REM',   value: breakdown.remHours,   color: '#7c3aed' },
          { key: 'core',  label: 'Core',  value: breakdown.coreHours,  color: '#3b82f6' },
          { key: 'deep',  label: 'Deep',  value: breakdown.deepHours,  color: '#0e7490' },
          { key: 'awake', label: 'Awake', value: breakdown.awakeHours, color: '#9ca3af' },
        ].filter(s => typeof s.value === 'number' && s.value > 0);
        const stageTotal = stages.reduce((a, s) => a + s.value, 0);
        const inBed = breakdown.inBedHours;
        const asleepLegacy = breakdown.asleepLegacyHours;
        const awake = breakdown.awakeHours;
        const hasAnyDetail =
          stageTotal > 0 ||
          (typeof inBed === 'number' && inBed > 0) ||
          (typeof asleepLegacy === 'number' && asleepLegacy > 0) ||
          (typeof awake === 'number' && awake > 0);
        return (
          <div style={{
            marginTop: '0.75rem',
            padding: '0.85rem 1rem',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ fontSize: '0.95rem' }}>
                {new Date(expandedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </strong>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                {total != null ? `${total}h asleep` : ''}
              </span>
            </div>
            {stageTotal > 0 && (
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: '0.6rem', marginBottom: '0.5rem' }}>
                {stages.map(s => (
                  <div key={s.key} title={`${s.label}: ${s.value}h`} style={{ flex: s.value, background: s.color }} />
                ))}
              </div>
            )}
            {hasAnyDetail ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.4rem 1rem', fontSize: '0.82rem', marginTop: stageTotal > 0 ? 0 : '0.5rem' }}>
                {stages.map(s => (
                  <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
                      {s.label}
                    </span>
                    <span style={{ fontVariant: 'tabular-nums', fontWeight: 600 }}>{s.value}h</span>
                  </div>
                ))}
                {stageTotal === 0 && typeof asleepLegacy === 'number' && asleepLegacy > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: '#8b5cf6' }} />
                      Asleep
                    </span>
                    <span style={{ fontVariant: 'tabular-nums', fontWeight: 600 }}>{Math.round(asleepLegacy * 10) / 10}h</span>
                  </div>
                )}
                {typeof inBed === 'number' && inBed > 0 && (
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}>
                    <span>In bed</span>
                    <span style={{ fontVariant: 'tabular-nums' }}>{Math.round(inBed * 10) / 10}h</span>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                Per-stage detail wasn't recorded for this night — only the total{total != null ? ` (${total}h)` : ''} synced.
                Apple Watch records REM/Core/Deep; older devices or third-party sleep apps may only log a single asleep total.
              </p>
            )}
            {stageTotal === 0 && !hasAnyDetail && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                To get stage detail, wear an Apple Watch overnight (Sleep mode enabled in Settings → Sleep) and re-sync from the mobile app.
              </p>
            )}
          </div>
        );
      })()}

      <div style={{ marginTop: '1.25rem' }}>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Recent nights</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {chartData.slice().reverse().filter(d => d.hours != null).slice(0, 14).map(d => {
            const breakdown = breakdownByDate[d.iso] || null;
            const isOpen = expandedDate === d.iso;
            const stages = breakdown ? [
              { key: 'rem',   label: 'REM',   value: breakdown.remHours,   color: '#7c3aed' },
              { key: 'core',  label: 'Core',  value: breakdown.coreHours,  color: '#3b82f6' },
              { key: 'deep',  label: 'Deep',  value: breakdown.deepHours,  color: '#0e7490' },
              { key: 'awake', label: 'Awake', value: breakdown.awakeHours, color: '#9ca3af' },
            ].filter(s => typeof s.value === 'number' && s.value > 0) : [];
            const stageTotal = stages.reduce((a, s) => a + s.value, 0);
            const inBed = breakdown?.inBedHours;
            const asleepLegacy = breakdown?.asleepLegacyHours;
            const hasDetail = stages.length > 0 ||
              (typeof inBed === 'number' && inBed > 0) ||
              (typeof asleepLegacy === 'number' && asleepLegacy > 0);

            return (
              <div key={d.iso} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setExpandedDate(isOpen ? null : d.iso)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ color: 'var(--color-text)', textAlign: 'left' }}>
                    {new Date(d.iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                  </span>
                  <span style={{ fontWeight: 700, color: d.hours >= target ? '#16a34a' : d.hours < 6 ? '#dc2626' : 'var(--color-text)' }}>
                    {d.hours}h
                  </span>
                </button>
                {isOpen && (
                  <div style={{ padding: '0 0.75rem 0.75rem', borderTop: '1px solid var(--color-border)' }}>
                    {stageTotal > 0 && (
                      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                        {stages.map(s => (
                          <div key={s.key} title={`${s.label}: ${s.value}h`} style={{ flex: s.value, background: s.color }} />
                        ))}
                      </div>
                    )}
                    {hasDetail ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.4rem 1rem', fontSize: '0.78rem' }}>
                        {stages.map(s => (
                          <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)' }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                              {s.label}
                            </span>
                            <span style={{ fontVariant: 'tabular-nums', color: 'var(--color-text)', fontWeight: 600 }}>{s.value}h</span>
                          </div>
                        ))}
                        {stageTotal === 0 && typeof asleepLegacy === 'number' && asleepLegacy > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)' }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: '#8b5cf6' }} />
                              Asleep
                            </span>
                            <span style={{ fontVariant: 'tabular-nums', color: 'var(--color-text)', fontWeight: 600 }}>{Math.round(asleepLegacy * 10) / 10}h</span>
                          </div>
                        )}
                        {typeof inBed === 'number' && inBed > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gridColumn: '1 / -1', paddingTop: 4, borderTop: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}>
                            <span>In bed</span>
                            <span style={{ fontVariant: 'tabular-nums' }}>{Math.round(inBed * 10) / 10}h</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        No per-stage detail synced for this night — wear an Apple Watch with Sleep tracking to capture REM/Core/Deep.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const OVERVIEW_CORE_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const OVERVIEW_MAIN_SLOTS = ['breakfast', 'lunch', 'dinner'];

// Bar charts shown at the top of the Overview tab. Pulls daily metrics
// (steps, sleep, meals tracked, % of daily targets, veg/fruit servings)
// from the dailyLog Firestore doc that the iOS app writes, and counts
// workouts directly from the in-memory workouts list. A single range
// selector drives every chart so the day axis stays aligned.
function OverviewBarCharts({ user, workouts }) {
  const [log, setLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sunday-daily-log') || '{}') || {}; }
    catch { return {}; }
  });
  const [range, setRange] = useState(30);

  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, 'users', user.uid, 'data', 'dailyLog');
    const unsub = onSnapshot(
      ref,
      snap => {
        const remote = (snap.exists() && snap.data().log) || {};
        setLog(prev => ({ ...prev, ...remote }));
      },
      err => { console.error('Overview subscription error:', err); },
    );
    return () => unsub();
  }, [user?.uid]);

  const goals = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('sunday-nutrition-goals') || 'null'); }
    catch { return null; }
  }, []);

  // Workouts indexed by ISO date, counting one per day rather than per entry.
  const workoutDates = useMemo(() => {
    const set = new Set();
    for (const w of workouts || []) {
      if (w?.date) set.add(w.date);
    }
    return set;
  }, [workouts]);

  const rows = useMemo(() => {
    const out = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const day = log[iso] || {};
      const entries = day.entries || [];
      const daySkipped = !!day.daySkipped;
      const skippedMeals = day.skippedMeals || [];

      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Steps & sleep are direct numbers from HealthKit sync.
      const steps = typeof day.steps === 'number' ? Math.round(day.steps) : null;
      const sleep = typeof day.sleep === 'number' ? Math.round(day.sleep * 10) / 10 : null;

      // Meals tracked: fraction of breakfast/lunch/dinner that were either
      // logged or explicitly skipped. Whole-day skip counts as 100%.
      let mealsPct = null;
      if (daySkipped) {
        mealsPct = 100;
      } else if (entries.length > 0 || skippedMeals.length > 0) {
        const accounted = new Set();
        for (const e of entries) {
          if (OVERVIEW_MAIN_SLOTS.includes(e.mealSlot)) accounted.add(e.mealSlot);
        }
        for (const s of skippedMeals) {
          if (OVERVIEW_MAIN_SLOTS.includes(s)) accounted.add(s);
        }
        mealsPct = Math.round((accounted.size / OVERVIEW_MAIN_SLOTS.length) * 100);
      }

      // % of daily targets: average of macro % toward goal (capped at 100)
      // across whatever core nutrients the user has goals set for.
      let targetPct = null;
      if (!daySkipped && goals && entries.length > 0) {
        const activeEntries = skippedMeals.length > 0
          ? entries.filter(e => !skippedMeals.includes(e.mealSlot))
          : entries;
        const skippedMain = skippedMeals.filter(s => OVERVIEW_MAIN_SLOTS.includes(s)).length;
        const activeFraction = Math.max(0, 1 - (skippedMain / 3));
        const totals = {};
        for (const k of OVERVIEW_CORE_KEYS) totals[k] = 0;
        for (const e of activeEntries) {
          for (const k of OVERVIEW_CORE_KEYS) totals[k] += e.nutrition?.[k] || 0;
        }
        const pcts = [];
        for (const k of OVERVIEW_CORE_KEYS) {
          const adj = (goals[k] || 0) * activeFraction;
          if (adj > 0) pcts.push(Math.min(100, (totals[k] / adj) * 100));
        }
        if (pcts.length > 0) {
          targetPct = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
        }
      }

      // Vegetables / fruit servings — null when the day has no entries so
      // missed days don't read as a real zero.
      let veg = null;
      let fruit = null;
      if (!daySkipped && entries.length > 0) {
        const activeEntries = skippedMeals.length > 0
          ? entries.filter(e => !skippedMeals.includes(e.mealSlot))
          : entries;
        if (activeEntries.length > 0) {
          let v = 0;
          let f = 0;
          for (const e of activeEntries) {
            v += e.nutrition?.vegServings || 0;
            f += e.nutrition?.fruitServings || 0;
          }
          veg = Math.round(v * 10) / 10;
          fruit = Math.round(f * 10) / 10;
        }
      }

      out.push({
        date: label,
        iso,
        workouts: workoutDates.has(iso) ? 1 : 0,
        steps,
        sleep,
        mealsPct,
        targetPct,
        veg,
        fruit,
      });
    }
    return out;
  }, [log, range, workoutDates, goals]);

  const workoutTotal = rows.reduce((s, r) => s + r.workouts, 0);

  // Aggregate daily workout flags into weekly totals. Weeks are ISO-style
  // Monday-based so the bar label always points at the Monday of that week.
  const workoutsByWeek = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!r.workouts) continue;
      const d = new Date(`${r.iso}T12:00:00`);
      const dow = (d.getDay() + 6) % 7; // 0 = Mon
      d.setDate(d.getDate() - dow);
      const key = d.toISOString().slice(0, 10);
      map.set(key, (map.get(key) || 0) + 1);
    }
    // Build a continuous series so empty weeks render as zero bars.
    const out = [];
    if (rows.length === 0) return out;
    const startIso = rows[0].iso;
    const endIso = rows[rows.length - 1].iso;
    const startD = new Date(`${startIso}T12:00:00`);
    startD.setDate(startD.getDate() - ((startD.getDay() + 6) % 7));
    const endD = new Date(`${endIso}T12:00:00`);
    const cur = new Date(startD);
    while (cur <= endD) {
      const key = cur.toISOString().slice(0, 10);
      out.push({
        weekStart: key,
        label: cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: map.get(key) || 0,
      });
      cur.setDate(cur.getDate() + 7);
    }
    return out;
  }, [rows]);
  const weeksWithWorkouts = workoutsByWeek.filter(w => w.count > 0).length;
  const weeklyAvg = workoutsByWeek.length
    ? Math.round((workoutTotal / workoutsByWeek.length) * 10) / 10
    : 0;
  const stepsAvg = (() => {
    const vals = rows.map(r => r.steps).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  })();
  const sleepAvg = (() => {
    const vals = rows.map(r => r.sleep).filter(v => v != null);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  })();
  const mealsAvg = (() => {
    const vals = rows.map(r => r.mealsPct).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  })();
  const targetAvg = (() => {
    const vals = rows.map(r => r.targetPct).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  })();

  const chartHeight = 200;
  const chartWrapStyle = {
    width: '100%',
    height: chartHeight,
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: '0.75rem 0.5rem 0.5rem',
  };

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 className={styles.statsHeading} style={{ margin: 0 }}>Daily metrics</h3>
        <div className={styles.tabs} style={{ marginBottom: 0 }}>
          {[7, 14, 30, 90, 365].map(r => (
            <button
              key={r}
              type="button"
              className={`${styles.tab} ${range === r ? styles.tabActive : ''}`}
              onClick={() => setRange(r)}
            >
              {r === 365 ? '1y' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Workouts per week <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>· {workoutTotal} total · avg {weeklyAvg}/wk · {weeksWithWorkouts}/{workoutsByWeek.length} active</span>
          </div>
          <div style={chartWrapStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workoutsByWeek} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  labelFormatter={(label, payload) => {
                    const ws = payload?.[0]?.payload?.weekStart;
                    return ws ? `Week of ${label}` : label;
                  }}
                  formatter={(v) => [`${v} workout${v === 1 ? '' : 's'}`, '']}
                  contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="count" fill="#3B6B9C" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Steps <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>· avg {stepsAvg.toLocaleString()}</span>
          </div>
          <div style={chartWrapStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={42} />
                <Tooltip formatter={(v) => [`${(v ?? 0).toLocaleString()} steps`, '']} contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={10000} stroke="#16a34a" strokeDasharray="5 3" strokeWidth={1.25} />
                <Bar dataKey="steps" fill="#16a34a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Sleep <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>· avg {sleepAvg}h</span>
          </div>
          <div style={chartWrapStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} unit="h" axisLine={false} tickLine={false} width={32} />
                <Tooltip formatter={(v) => [`${v ?? 0}h`, '']} contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={8} stroke="#6366f1" strokeDasharray="5 3" strokeWidth={1.25} />
                <Bar dataKey="sleep" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Meals tracked <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>· avg {mealsAvg}%</span>
          </div>
          <div style={chartWrapStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} unit="%" domain={[0, 100]} ticks={[0, 33, 67, 100]} axisLine={false} tickLine={false} width={36} />
                <Tooltip formatter={(v) => [v == null ? '—' : `${v}%`, '']} contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="5 3" strokeWidth={1.25} />
                <Bar dataKey="mealsPct" fill="#c96442" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            % of daily targets <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
              · {goals ? `avg ${targetAvg}%` : 'set goals to enable'}
            </span>
          </div>
          <div style={chartWrapStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} unit="%" domain={[0, 100]} ticks={[0, 50, 100]} axisLine={false} tickLine={false} width={36} />
                <Tooltip formatter={(v) => [v == null ? '—' : `${v}%`, '']} contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="5 3" strokeWidth={1.25} />
                <Bar dataKey="targetPct" fill="#ec4899" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Vegetables &amp; fruit <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>· servings/day</span>
          </div>
          <div style={chartWrapStyle}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip
                  formatter={(v, name) => [v == null ? '—' : `${v} servings`, name]}
                  contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="veg" name="Vegetables" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="fruit" name="Fruit" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

// Custom exercise picker for the Log Workout table. A native <select> can't
// hold a button, which is why the in-row "+ Add new exercise" affordance has
// to live in a portal-rendered popover anchored to the trigger.
function ExerciseSelector({ value, options, disabled, muscleGroup, onChange, onAddNew, className }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function close() {
    setOpen(false);
    setAdding(false);
    setNewName('');
  }

  useEffect(() => {
    if (!open) return undefined;
    function updatePos() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 220) });
    }
    updatePos();
    function onDocMouseDown(e) {
      if (menuRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      close();
    }
    function onScroll(e) {
      if (menuRef.current?.contains(e.target)) return;
      close();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  function commitNew() {
    const name = newName.trim();
    if (!name) return;
    onAddNew(name);
    close();
  }

  const menu = (
    <div
      ref={menuRef}
      className={styles.exSelectMenu}
      style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
    >
      <div className={styles.exSelectOptions}>
        {options.length === 0 ? (
          <div className={styles.exSelectEmpty}>
            No exercises in {muscleGroup || 'this group'} yet.
          </div>
        ) : (
          options.map(ex => (
            <button
              key={ex}
              type="button"
              className={`${styles.exSelectOption} ${ex === value ? styles.exSelectOptionActive : ''}`}
              onClick={() => { onChange(ex); close(); }}
            >{ex}</button>
          ))
        )}
      </div>
      {adding ? (
        <div className={styles.exSelectAddRow}>
          <input
            type="text"
            autoFocus
            placeholder={`New ${muscleGroup || ''} exercise`.trim()}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitNew(); }
              else if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setNewName(''); }
            }}
            className={styles.exSelectAddInput}
          />
          <button type="button" className={styles.exSelectAddConfirm} onClick={commitNew}>Add</button>
          <button type="button" className={styles.exSelectAddCancel} onClick={() => { setAdding(false); setNewName(''); }}>Cancel</button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.exSelectAddNew}
          disabled={!muscleGroup}
          onClick={() => setAdding(true)}
          title={!muscleGroup ? 'Pick a muscle group first' : `Add a new exercise to ${muscleGroup}`}
        >+ Add new exercise</button>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.logCell} ${styles.logExerciseSelect} ${styles.exSelectTrigger} ${className || ''}`}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.exSelectValue}>{value || '—'}</span>
        <span className={styles.exSelectCaret} aria-hidden="true">▾</span>
      </button>
      {open && createPortal(menu, document.body)}
    </>
  );
}

export function WorkoutPage({ onBack, user }) {
  const [workouts, setWorkouts] = useState(loadWorkouts);
  const [selectedDate, setSelectedDate] = useState(todayStr());

  // Long-open tabs drift: selectedDate is set once at mount, so a tab opened
  // yesterday and used today would save against yesterday's date. Refresh it
  // to today every time the tab regains focus, but only if the user hasn't
  // explicitly chosen a date for this session.
  const userPickedDateRef = useRef(false);
  useEffect(() => {
    function refreshIfStale() {
      if (document.hidden) return;
      if (userPickedDateRef.current) return;
      const today = todayStr();
      setSelectedDate(prev => (prev === today ? prev : today));
    }
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    refreshIfStale();
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, []);

  // Live-subscribe to the workoutLog Firestore doc so workouts saved on
  // the mobile app appear here within a second. The remote doc is the
  // source of truth — last write wins. Echoes from our own writes are
  // skipped via JSON-equality so they don't cause re-renders.
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, 'users', user.uid, 'data', 'workoutLog');
    const unsub = onSnapshot(
      ref,
      snap => {
        const remote = snap.exists() ? snap.data().workouts : null;
        if (!Array.isArray(remote) || remote.length === 0) return;
        setWorkouts(prev => {
          const sorted = [...remote].sort((a, b) => b.date.localeCompare(a.date));
          const sortedJson = JSON.stringify(sorted);
          if (sortedJson === JSON.stringify(prev)) return prev;
          try { localStorage.setItem(STORAGE_KEY, sortedJson); } catch { /* quota or disabled storage */ }
          return sorted;
        });
      },
      err => { console.error('Workout live sync error:', err); },
    );
    return () => unsub();
  }, [user?.uid]);
  const [gyms, setGymsState] = useState(loadGyms);
  const [gym, setGym] = useState(() => loadGyms()[0] || '');
  const [locationEditorOpen, setLocationEditorOpen] = useState(false);
  const [workoutType, setWorkoutType] = useState('');
  const [entries, setEntries] = useState(() => blankEntries());
  const [viewMode, setViewMode] = useState('log'); // 'log' | 'history' | 'charts' | 'body' | 'exercises' | 'steps' | 'sleep' | 'stats' (Overview)
  const [exerciseLibrary, setExerciseLibrary] = useState(loadLibrary);
  // Mirror the mobile app: per-user custom exercises and hidden defaults
  // live on the user doc so the picker matches across web + iOS.
  const [customExercises, setCustomExercises] = useState([]);
  const [hiddenExercises, setHiddenExercises] = useState([]);

  // Resolve the visible exercise list for a muscle group, merging every place
  // an exercise can live so the web stays in sync with the mobile app:
  //   - EXERCISES_BY_GROUP defaults
  //   - user's exerciseLibrary entries effectively in this group
  //   - user's customExercises (the mobile-only field) for this group
  //   - minus anything in hiddenExercises (defaults the user hid on mobile)
  // Deduped case-insensitively and sorted alphabetically.
  function exercisesForGroup(group) {
    if (!group) return [];
    const groupLc = group.toLowerCase();
    const builtin = EXERCISES_BY_GROUP[group] || [];
    const libraryForGroup = [];
    for (const item of exerciseLibrary || []) {
      if (item?.retired || !item?.exercise) continue;
      if (effectiveMuscleGroup(item)?.toLowerCase() === groupLc) {
        libraryForGroup.push(item.exercise);
      }
    }
    const custom = (customExercises || [])
      .filter(e => (e?.muscleGroup || '').toLowerCase() === groupLc)
      .map(e => e?.name)
      .filter(Boolean);
    const hiddenLc = new Set((hiddenExercises || []).map(n => String(n).toLowerCase()));
    const seen = new Set();
    const merged = [];
    for (const name of [...builtin, ...libraryForGroup, ...custom]) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (hiddenLc.has(key)) continue;
      merged.push(name);
    }
    merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return merged;
  }

  // Live-subscribe to the exerciseLibrary field on the user doc so
  // exercises added or edited on the mobile app appear here within a
  // second. Last write wins. Echoes from our own writes are skipped via
  // JSON-equality so they don't trigger spurious re-renders.
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      snap => {
        const data = snap.exists() ? snap.data() : null;
        const remoteLibrary = Array.isArray(data?.exerciseLibrary) ? data.exerciseLibrary : [];
        const remoteCustom = Array.isArray(data?.customExercises) ? data.customExercises : [];
        if (remoteLibrary.length > 0) {
          setExerciseLibrary(prev => {
            const remoteJson = JSON.stringify(remoteLibrary);
            if (remoteJson === JSON.stringify(prev)) return prev;
            try { localStorage.setItem(LIBRARY_KEY, remoteJson); } catch { /* quota or disabled storage */ }
            return remoteLibrary;
          });
        }
        setCustomExercises(remoteCustom);
        setHiddenExercises(Array.isArray(data?.hiddenExercises) ? data.hiddenExercises : []);

        // Backfill: the mobile app historically only wrote `customExercises`.
        // Promote any custom entries that aren't already in `exerciseLibrary`
        // so the Exercises tab (which only renders `exerciseLibrary`) shows
        // them. After this write the next snapshot will find no missing
        // entries, so no infinite loop.
        if (remoteCustom.length > 0) {
          const haveLc = new Set(
            remoteLibrary
              .map(e => (e?.exercise || '').trim().toLowerCase())
              .filter(Boolean),
          );
          const missing = remoteCustom.filter(c => {
            const n = String(c?.name || '').trim().toLowerCase();
            return n && !haveLc.has(n);
          });
          if (missing.length > 0) {
            const promoted = missing.map(c => ({
              exercise: c.name,
              primaryMuscles: '',
              secondaryMuscles: '',
              group: '',
              muscleGroup: c.muscleGroup || '',
              thisWeek: 0,
              lastWeek: 0,
              alternative: '',
              top: false,
              nickname: '',
              retired: false,
              videos: [],
              addedAt: new Date().toISOString(),
            }));
            const merged = [...promoted, ...remoteLibrary];
            setExerciseLibrary(merged);
            try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(merged)); } catch { /* quota */ }
            saveField(user.uid, 'exerciseLibrary', merged).catch(err => {
              console.warn('exerciseLibrary backfill from customExercises failed:', err);
            });
          }
        }
      },
      err => { console.error('Exercise library live sync error:', err); },
    );
    return () => unsub();
  }, [user?.uid]);

  // User's exercises grouped by their assigned muscle group. This is the
  // source of truth for the Log Workout exercise dropdown — pick a muscle
  // group, see only the exercises you've put in that group.
  const exercisesByMuscleGroup = useMemo(() => {
    const map = {};
    for (const item of exerciseLibrary || []) {
      if (item?.retired) continue;
      if (!item?.exercise) continue;
      const mg = effectiveMuscleGroup(item);
      if (!mg) continue;
      if (!map[mg]) map[mg] = [];
      if (!map[mg].includes(item.exercise)) map[mg].push(item.exercise);
    }
    for (const mg of Object.keys(map)) map[mg].sort((a, b) => a.localeCompare(b));
    return map;
  }, [exerciseLibrary]);
  const [workoutTypes, setWorkoutTypes] = useState(loadWorkoutTypes);
  const [typeSkipDates, setTypeSkipDates] = useState(loadSkipDates);
  const [editingTypes, setEditingTypes] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [historyGroup, setHistoryGroup] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [historyGym, setHistoryGym] = useState('');
  const [historyExercise, setHistoryExercise] = useState('');
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [bulkWeightInput, setBulkWeightInput] = useState('');
  const [bulkNotesInput, setBulkNotesInput] = useState('');
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
  const [userColMap, setUserColMap] = useState(null);
  const [importMode, setImportMode] = useState('merge');
  const [logImageProcessing, setLogImageProcessing] = useState(false);
  const [logImageError, setLogImageError] = useState('');
  const [logImageInfo, setLogImageInfo] = useState('');
  const logImageFileRef = useRef(null);

  const [colWidths, setColWidths] = useState(loadColWidths);
  useEffect(() => {
    try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);
  const colResizeRef = useRef(null);

  function startColResize(colId, e) {
    e.preventDefault();
    e.stopPropagation();
    const def = LOG_COLUMN_DEFS.find(c => c.id === colId);
    colResizeRef.current = {
      colId,
      startX: e.clientX,
      startWidth: colWidths[colId],
      minWidth: def?.min || 30,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add(styles.colResizing);
  }
  function onColResizeMove(e) {
    const s = colResizeRef.current;
    if (!s) return;
    const next = Math.max(s.minWidth, s.startWidth + (e.clientX - s.startX));
    setColWidths(prev => prev[s.colId] === next ? prev : ({ ...prev, [s.colId]: next }));
  }
  function onColResizeEnd(e) {
    if (!colResizeRef.current) return;
    colResizeRef.current = null;
    e.currentTarget.classList.remove(styles.colResizing);
  }
  function renderColResizer(colId) {
    return (
      <span
        className={styles.colResizer}
        onPointerDown={ev => startColResize(colId, ev)}
        onPointerMove={onColResizeMove}
        onPointerUp={onColResizeEnd}
        onPointerCancel={onColResizeEnd}
      />
    );
  }
  const logTableWidth = LOG_COLUMN_DEFS.reduce((s, c) => s + (colWidths[c.id] || 0), 0);

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
      const result = parseWorkoutCsv(importText, userColMap);
      if (result.workouts.length === 0) {
        setImportError('No valid rows found. Make sure Date and Exercises are mapped to columns with data.');
        // Even on no rows, keep headers visible so user can fix mapping.
        if (!userColMap) {
          const { headers } = getCsvHeadersAndSample(importText);
          if (headers.length > 0) {
            setUserColMap(deriveColMapOverride(result.colMap, headers.length));
          }
        }
        setImportPreview(result.headers && result.headers.length > 0 ? result : null);
        return;
      }
      setImportPreview(result);
      if (!userColMap) {
        setUserColMap(deriveColMapOverride(result.colMap, result.headers.length));
      }
    } catch (err) {
      setImportError(err.message || 'Parse failed');
      // Try to extract headers anyway so the mapping panel can render.
      const { headers, sampleRow } = getCsvHeadersAndSample(importText);
      if (headers.length > 0) {
        setImportPreview({ workouts: [], skippedRows: [], cleanings: [], headers, colMap: {}, sampleRow });
        if (!userColMap) {
          const blank = {};
          for (let i = 0; i < headers.length; i++) blank[i] = 'ignore';
          setUserColMap(blank);
        }
      }
    }
  }

  function changeColumnMapping(idx, target) {
    const next = { ...(userColMap || {}) };
    // If target is a non-ignore value, clear any other column already mapped
    // to it (each target except 'ignore' should have at most one source).
    if (target !== 'ignore') {
      for (const [k, v] of Object.entries(next)) {
        if (v === target && Number(k) !== idx) next[k] = 'ignore';
      }
    }
    next[idx] = target;
    setUserColMap(next);
    setImportError('');
    try {
      const result = parseWorkoutCsv(importText, next);
      if (result.workouts.length === 0) {
        setImportError('No valid rows with current mapping. Check that Date and Exercises point to columns with data.');
      }
      setImportPreview(result);
    } catch (err) {
      setImportError(err.message || 'Parse failed');
      const { headers, sampleRow } = getCsvHeadersAndSample(importText);
      setImportPreview({ workouts: [], skippedRows: [], cleanings: [], headers, colMap: {}, sampleRow });
    }
  }

  function handleConfirmImport() {
    if (!importPreview || importPreview.workouts.length === 0) return;
    let next;
    if (importMode === 'replace') {
      const existingDays = workouts.length;
      if (existingDays > 0 && !window.confirm(
        `This will REPLACE all ${existingDays} existing workout day${existingDays === 1 ? '' : 's'} with ${importPreview.workouts.length} day${importPreview.workouts.length === 1 ? '' : 's'} from the CSV. This can't be undone. Continue?`
      )) return;
      next = [...importPreview.workouts].sort((a, b) => b.date.localeCompare(a.date));
    } else {
      const importedDates = new Set(importPreview.workouts.map(w => w.date));
      next = [
        ...importPreview.workouts,
        ...workouts.filter(w => !importedDates.has(w.date)),
      ].sort((a, b) => b.date.localeCompare(a.date));
    }
    setWorkouts(next);
    saveWorkouts(next, user?.uid);
    clearSelectedRows();
    setShowImport(false);
    setImportText('');
    setImportPreview(null);
    setImportError('');
    setUserColMap(null);
    setImportMode('merge');
    const verb = importMode === 'replace' ? 'Replaced workout history with' : 'Imported';
    alert(`${verb} ${importPreview.workouts.length} workout day${importPreview.workouts.length === 1 ? '' : 's'}.`);
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
      setGym(existing.gym || gyms[0] || '');
      setWorkoutType(existing.workoutType || '');
      setEntries(padToMin(existing.entries.length > 0 ? existing.entries : []));
    } else {
      setEntries(blankEntries());
      setWorkoutType('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setEntries(prev => prev.map((e, i) => i === idx
      ? { ...e, [field]: value, editedFields: { ...e.editedFields, [field]: true } }
      : e));
  }

  // Find the most recent prior log of the given exercise at the given gym
  // location. Returns null if none.
  function lastLogForExerciseAt(exerciseName, gymName) {
    if (!exerciseName) return null;
    const key = exerciseName.trim().toLowerCase();
    const history = exerciseHistoryByName[key] || [];
    let best = null;
    for (const h of history) {
      if (h.gym !== gymName) continue;
      if (!best || (h.date || '').localeCompare(best.date || '') > 0) best = h;
    }
    return best;
  }

  // Refill an entry's value-fields (weight/sets/time/perArm/notes) from the
  // last log of its exercise at the given location. If there's no history at
  // that location, clears the value-fields. Auto-filled fields are stripped
  // from editedFields so they don't show the manual-edit highlight.
  function applyLastFromLocation(entry, gymName) {
    const next = { ...entry };
    const last = entry.exercise ? lastLogForExerciseAt(entry.exercise, gymName) : null;
    if (last) {
      next.notes = last.notes != null ? String(last.notes) : '';
      next.weight = last.weight != null ? String(last.weight) : '';
      next.time = last.time ? String(last.time) : '2:00';
      next.perArm = !!last.perArm;
      next.sets = Array.isArray(last.sets)
        ? last.sets.slice(0, 4).map(s => (s == null ? '' : String(s)))
        : ['', '', '', ''];
      while (next.sets.length < 4) next.sets.push('');
    } else {
      next.notes = '';
      next.weight = '';
      next.time = '2:00';
      next.perArm = false;
      next.sets = ['', '', '', ''];
    }
    const ef = { ...next.editedFields };
    delete ef.notes; delete ef.weight; delete ef.time; delete ef.perArm;
    delete ef.set0; delete ef.set1; delete ef.set2; delete ef.set3;
    next.editedFields = ef;
    return next;
  }

  // Pick exercise + carry forward weight/sets/notes/etc. from the *most recent*
  // logged workout for that exercise at the currently selected location.
  // Auto-filled fields are NOT marked as edited so the highlight stays
  // reserved for values the user typed by hand.
  function pickExercise(idx, exerciseName) {
    setEntries(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const withExercise = { ...e, exercise: exerciseName, editedFields: { ...e.editedFields, exercise: true } };
      return applyLastFromLocation(withExercise, gym);
    }));
  }

  // Creates a new exercise in the library, tagged to `muscleGroup` so it
  // shows up in that group's dropdown on the very next render.
  function addExerciseToLibrary(name, muscleGroup) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    const dup = (exerciseLibrary || []).find(
      e => e?.exercise && e.exercise.trim().toLowerCase() === lower
    );
    if (dup) {
      alert(`"${dup.exercise}" already exists in your exercises.`);
      return false;
    }
    const newEx = {
      exercise: trimmed,
      primaryMuscles: '',
      secondaryMuscles: '',
      group: '',
      muscleGroup: muscleGroup || '',
      thisWeek: 0,
      lastWeek: 0,
      alternative: '',
      top: false,
      nickname: '',
      retired: false,
      videos: [],
      addedAt: new Date().toISOString(),
    };
    const next = [newEx, ...(exerciseLibrary || [])];
    setExerciseLibrary(next);
    saveLibrary(next, user?.uid);
    // Also mirror to customExercises so the mobile picker (which reads that
    // field rather than exerciseLibrary) shows the new exercise immediately.
    if (muscleGroup && user?.uid) {
      const customNext = [...(customExercises || [])];
      const dupCustom = customNext.some(
        e => e?.name && e.name.trim().toLowerCase() === lower
      );
      if (!dupCustom) {
        customNext.push({ name: trimmed, muscleGroup });
        setCustomExercises(customNext);
        saveField(user.uid, 'customExercises', customNext).catch(() => {});
      }
    }
    return true;
  }

  // Switching the location refills every row that has an exercise selected
  // with the last values from that location.
  function handleGymChange(newGym) {
    setGym(newGym);
    setEntries(prev => prev.map(e => (e.exercise ? applyLastFromLocation(e, newGym) : e)));
  }

  // ---- Locations CRUD ----------------------------------------------------
  function commitGyms(next) {
    setGymsState(next);
    saveGyms(next, user?.uid);
  }

  function renameGym(oldName, newName) {
    if (!newName || newName === oldName) return;
    if (gyms.includes(newName)) {
      alert(`A location named "${newName}" already exists.`);
      return;
    }
    commitGyms(gyms.map(g => (g === oldName ? newName : g)));
    // Bulk-rename existing workouts so location-aware history lookups keep
    // matching after the rename.
    const touchesWorkouts = workouts.some(w => w.gym === oldName);
    if (touchesWorkouts) {
      const nextWorkouts = workouts.map(w => (w.gym === oldName ? { ...w, gym: newName } : w));
      setWorkouts(nextWorkouts);
      saveWorkouts(nextWorkouts, user?.uid);
    }
    if (gym === oldName) setGym(newName);
  }

  function deleteGym(name) {
    if (gyms.length <= 1) {
      alert('Keep at least one location.');
      return;
    }
    if (!window.confirm(`Delete "${name}"? Existing workouts logged here keep the label but it won't appear in the dropdown.`)) {
      return;
    }
    const nextGyms = gyms.filter(g => g !== name);
    commitGyms(nextGyms);
    if (gym === name) setGym(nextGyms[0]);
  }

  function addGym() {
    const base = 'New location';
    let candidate = base;
    let n = 1;
    while (gyms.includes(candidate)) { n += 1; candidate = `${base} ${n}`; }
    commitGyms([...gyms, candidate]);
  }

  function updateSet(entryIdx, setIdx, value) {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      const sets = [...e.sets];
      sets[setIdx] = value;
      return { ...e, sets, editedFields: { ...e.editedFields, [`set${setIdx}`]: true } };
    }));
  }

  // Click a set cell's checkmark to mark that set as completed — turns the
  // cell green so you can glance at the row and see what's left to do mid
  // workout. The flag persists with the workout when saved.
  function toggleSetDone(entryIdx, setIdx) {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      const setDone = Array.isArray(e.setDone) ? [...e.setDone] : [false, false, false, false];
      while (setDone.length < 4) setDone.push(false);
      setDone[setIdx] = !setDone[setIdx];
      return { ...e, setDone };
    }));
  }

  function updateSetWeight(entryIdx, setIdx, value) {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      const setWeights = Array.isArray(e.setWeights) ? [...e.setWeights] : ['', '', '', ''];
      while (setWeights.length < 4) setWeights.push('');
      setWeights[setIdx] = value;
      return { ...e, setWeights, editedFields: { ...e.editedFields, [`setWeight${setIdx}`]: true } };
    }));
  }

  function setEntryUseSetWeights(entryIdx, on) {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      if (on) {
        const seed = e.weight || '';
        const setWeights = [seed, seed, seed, seed];
        return { ...e, useSetWeights: true, setWeights, editedFields: { ...e.editedFields, weight: true } };
      } else {
        const next = { ...e, useSetWeights: false };
        delete next.setWeights;
        return next;
      }
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
    // After a save, allow auto-refresh to pull the date back to today on the
    // next visibility change — the user is unlikely to want to keep logging
    // against a past date once they've committed one.
    userPickedDateRef.current = false;
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
      const meaningful = entries
        .filter(e => e.group && e.exercise)
        .map(e => {
          const rest = { ...e };
          delete rest.editedFields;
          return rest;
        });
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

  function updateHistorySetWeight(date, originalIdx, setIdx, value) {
    const next = workouts.map(w => {
      if (w.date !== date) return w;
      const entries = w.entries.map((e, i) => {
        if (i !== originalIdx) return e;
        const setWeights = Array.isArray(e.setWeights) ? [...e.setWeights] : ['', '', '', ''];
        while (setWeights.length < 4) setWeights.push('');
        setWeights[setIdx] = value;
        return enrichEntry({ ...e, setWeights });
      });
      return { ...w, entries };
    });
    commitWorkouts(next);
  }

  function setHistoryUseSetWeights(date, originalIdx, on) {
    const next = workouts.map(w => {
      if (w.date !== date) return w;
      const entries = w.entries.map((e, i) => {
        if (i !== originalIdx) return e;
        if (on) {
          const seed = e.weight || '';
          return enrichEntry({ ...e, useSetWeights: true, setWeights: [seed, seed, seed, seed] });
        } else {
          const stripped = { ...e, useSetWeights: false };
          delete stripped.setWeights;
          return enrichEntry(stripped);
        }
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
  function setHistoryGymForDate(date, newGym) {
    if (!newGym) return;
    commitWorkouts(workouts.map(w => w.date === date ? { ...w, gym: newGym } : w));
  }

  // ---- Bulk-edit helpers (History tab) ----------------------------------
  function rowKey(date, idx) { return `${date}::${idx}`; }
  function parseRowKey(k) {
    const sep = k.indexOf('::');
    return { date: k.slice(0, sep), idx: parseInt(k.slice(sep + 2), 10) };
  }
  function toggleRowSelected(date, idx) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      const k = rowKey(date, idx);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }
  function clearSelectedRows() { setSelectedRows(new Set()); }
  function setVisibleRowsSelected(visibleKeys, select) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (select) visibleKeys.forEach(k => next.add(k));
      else visibleKeys.forEach(k => next.delete(k));
      return next;
    });
  }
  // Group selection by date so we touch each workout-day only once.
  function selectionByDate() {
    const byDate = new Map();
    for (const k of selectedRows) {
      const { date, idx } = parseRowKey(k);
      if (!byDate.has(date)) byDate.set(date, new Set());
      byDate.get(date).add(idx);
    }
    return byDate;
  }
  function bulkUpdateField(field, value) {
    if (selectedRows.size === 0) return;
    const byDate = selectionByDate();
    const next = workouts.map(w => {
      const idxSet = byDate.get(w.date);
      if (!idxSet) return w;
      const entries = w.entries.map((e, i) => {
        if (!idxSet.has(i)) return e;
        const updated = { ...e, [field]: value };
        if (field === 'group') updated.exercise = '';
        return enrichEntry(updated);
      });
      return { ...w, entries };
    });
    commitWorkouts(next);
  }
  function bulkSetGym(newGym) {
    if (!newGym || selectedRows.size === 0) return;
    const dates = new Set();
    for (const k of selectedRows) dates.add(parseRowKey(k).date);
    commitWorkouts(workouts.map(w => dates.has(w.date) ? { ...w, gym: newGym } : w));
  }
  function bulkDeleteSelected() {
    if (selectedRows.size === 0) return;
    const n = selectedRows.size;
    if (!window.confirm(`Delete ${n} exercise${n === 1 ? '' : 's'}? This can't be undone.`)) return;
    const byDate = selectionByDate();
    const next = workouts
      .map(w => {
        const idxSet = byDate.get(w.date);
        if (!idxSet) return w;
        return { ...w, entries: w.entries.filter((_, i) => !idxSet.has(i)) };
      })
      .filter(w => w.entries.length > 0);
    commitWorkouts(next);
    clearSelectedRows();
  }
  function setHistoryDate(oldDate, newDate) {
    if (!newDate || newDate === oldDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    if (workouts.some(w => w.date === newDate)) {
      window.alert(`There's already a workout logged on ${newDate}. Pick a different date or merge manually.`);
      return;
    }
    commitWorkouts(workouts.map(w => w.date === oldDate ? { ...w, date: newDate } : w));
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

  // Effective last-activity date per type — the newer of an actual saved
  // workout and a manual "skip" recorded by the user. wasSkipped lets the
  // pill differentiate when the most recent activity is a skip vs a real
  // session. Mirror of the mobile app's effectiveLastByType.
  const effectiveLastByType = useMemo(() => {
    const m = {};
    for (const t of workoutTypes) {
      const workoutDate = lastByType[t]?.date || '';
      const skipDate = typeSkipDates?.[t] || '';
      if (skipDate && skipDate > workoutDate) {
        m[t] = { date: skipDate, wasSkipped: true };
      } else if (workoutDate) {
        m[t] = { date: workoutDate, wasSkipped: false };
      }
    }
    return m;
  }, [lastByType, typeSkipDates, workoutTypes]);

  const suggestedType = useMemo(() => {
    if (workoutTypes.length === 0) return '';
    let suggested = workoutTypes[0];
    let suggestedDate = effectiveLastByType[suggested]?.date || '';
    for (const t of workoutTypes) {
      const d = effectiveLastByType[t]?.date || '';
      if (!d) return t; // never done yet — suggest immediately
      if (suggestedDate && d < suggestedDate) {
        suggested = t;
        suggestedDate = d;
      }
    }
    return suggested;
  }, [effectiveLastByType, workoutTypes]);

  function skipWorkoutType(t) {
    const today = todayStr();
    const next = { ...typeSkipDates, [t]: today };
    setTypeSkipDates(next);
    saveSkipDates(next, user?.uid);
  }

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
    // The table reflects the selected type: refill from that type's
    // last workout, or clear to a blank slate if it's never been done.
    if (lastByType[t]) {
      fillFromLast(t);
    } else {
      setEntries(blankEntries());
    }
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
        // Spread the entry first so `gym` from the workout (not the entry, which
        // doesn't normally carry one) is the source of truth for location.
        map[key].push({ ...e, date: w.date, gym: w.gym });
      }
    }
    return map;
  }, [workouts]);

  // Dropdown options derived from actual logged workouts so the user only
  // sees gyms/exercises they've actually used. Exercise list narrows to the
  // selected group when one is active.
  const historyGyms = useMemo(() => {
    const set = new Set();
    for (const w of workouts) if (w.gym) set.add(w.gym);
    return Array.from(set).sort();
  }, [workouts]);

  const historyExercises = useMemo(() => {
    const set = new Set();
    for (const w of workouts) {
      for (const e of w.entries || []) {
        if (!e.exercise) continue;
        if (historyGroup && e.group !== historyGroup) continue;
        set.add(e.exercise);
      }
    }
    return Array.from(set).sort();
  }, [workouts, historyGroup]);

  // Drop the exercise filter if a group change made the current selection
  // disappear from the dropdown options.
  useEffect(() => {
    if (historyExercise && !historyExercises.includes(historyExercise)) {
      setHistoryExercise('');
    }
  }, [historyExercise, historyExercises]);

  const filteredHistory = useMemo(() => {
    return workouts.filter(w => {
      if (historyStartDate && w.date < historyStartDate) return false;
      if (historyEndDate && w.date > historyEndDate) return false;
      if (historyGym && !(w.gym || '').toLowerCase().includes(historyGym.toLowerCase())) return false;
      const entries = w.entries || [];
      if (historyGroup && !entries.some(e => e.group === historyGroup)) return false;
      if (historyExercise && !entries.some(e => e.exercise === historyExercise)) return false;
      return true;
    });
  }, [workouts, historyStartDate, historyEndDate, historyGym, historyGroup, historyExercise]);

  const hasActiveHistoryFilters = !!(historyGroup || historyStartDate || historyEndDate || historyGym || historyExercise);
  function exportHistory() {
    const rows = [];
    for (const w of filteredHistory) {
      for (const e of (w.entries || [])) {
        if (historyGroup && e.group !== historyGroup) continue;
        if (historyExercise && e.exercise !== historyExercise) continue;
        rows.push({
          date: w.date,
          workoutType: w.workoutType || '',
          gym: w.gym || '',
          group: e.group || '',
          exercise: e.exercise || '',
          notes: e.notes || '',
          sets: Array.isArray(e.sets) ? e.sets : [],
          weight: e.weight,
          perArm: !!e.perArm,
          time: e.time || '',
        });
      }
    }
    if (rows.length === 0) {
      window.alert('Nothing to export — adjust the filters or log a workout first.');
      return;
    }
    exportWorkoutHistoryToCSV(rows);
  }
  function clearHistoryFilters() {
    setHistoryGroup('');
    setHistoryStartDate('');
    setHistoryEndDate('');
    setHistoryGym('');
    setHistoryExercise('');
  }

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

  // On each page load, default the chart slots to the most-recently-logged
  // exercises so the dashboard reflects current training. Walks workouts
  // newest-first and picks unique exercises in last-seen order. Fires once
  // per mount, the first time workouts arrive (handles the Firestore-sync
  // race where workouts is empty on the initial render). After that, any
  // user customization within the session sticks. Reloading the page resets
  // to the latest defaults again — that's the requested behavior.
  const chartDefaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (chartDefaultsAppliedRef.current) return;
    if (!workouts || workouts.length === 0) return;
    const sortedWorkouts = [...workouts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const seen = new Set();
    const ordered = [];
    for (const w of sortedWorkouts) {
      for (const e of w.entries || []) {
        if (!e.exercise || isWarmUp(e.exercise)) continue;
        const k = e.exercise.trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        ordered.push({ exercise: e.exercise, group: e.group || '' });
        if (ordered.length >= NUM_CHART_SLOTS) break;
      }
      if (ordered.length >= NUM_CHART_SLOTS) break;
    }
    if (ordered.length === 0) return;
    chartDefaultsAppliedRef.current = true;
    const libByExercise = {};
    for (const item of exerciseLibrary || []) {
      if (item?.exercise) libByExercise[item.exercise.trim().toLowerCase()] = item.group || '';
    }
    const next = Array.from({ length: NUM_CHART_SLOTS }, (_, i) => {
      const it = ordered[i];
      if (!it) return { group: '', exercise: '' };
      const libGroup = libByExercise[it.exercise.trim().toLowerCase()];
      return { group: libGroup || it.group || '', exercise: it.exercise };
    });
    setChartSlots(next);
    try { localStorage.setItem('sunday-chart-slots', JSON.stringify(next)); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workouts, exerciseLibrary]);

  const stats = useMemo(() => {
    const last30 = workouts.filter(w => {
      const diff = (Date.now() - new Date(w.date).getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 30;
    });
    return { totalWorkouts: last30.length };
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
        {['log', 'history', 'charts', 'body', 'exercises', 'steps', 'sleep', 'stats'].map(tab => (
          <button key={tab} className={`${styles.tab} ${viewMode === tab ? styles.tabActive : ''}`} onClick={() => setViewMode(tab)}>
            {tab === 'log' ? 'Log Workout'
              : tab === 'history' ? 'History'
              : tab === 'charts' ? 'Charts'
              : tab === 'body' ? 'Body Map'
              : tab === 'exercises' ? 'Exercises'
              : tab === 'steps' ? 'Steps'
              : tab === 'sleep' ? 'Sleep'
              : 'Overview'}
          </button>
        ))}
      </div>

      {viewMode === 'log' && (
        <div className={styles.logSection}>
          <div className={styles.dateRow}>
            <input type="date" className={styles.dateInput} value={selectedDate} onChange={e => { userPickedDateRef.current = true; setSelectedDate(e.target.value); }} />
            <select className={styles.gymSelect} value={gym} onChange={e => handleGymChange(e.target.value)}>
              {gyms.map(g => <option key={g} value={g}>{g}</option>)}
              {gym && !gyms.includes(gym) && <option value={gym}>{gym}</option>}
            </select>
            <button
              type="button"
              className={styles.gymManageBtn}
              onClick={() => setLocationEditorOpen(o => !o)}
              title="Manage locations"
              aria-label="Manage locations"
              aria-expanded={locationEditorOpen}
            >
              ✎
            </button>
          </div>

          {locationEditorOpen && (
            <div className={styles.gymEditor}>
              <div className={styles.gymEditorTitle}>Locations</div>
              {gyms.map((g) => (
                <div key={g} className={styles.gymEditorRow}>
                  <input
                    type="text"
                    defaultValue={g}
                    className={styles.gymEditorInput}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next || next === g) { e.target.value = g; return; }
                      renameGym(g, next);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  />
                  <button
                    type="button"
                    className={styles.gymEditorDelBtn}
                    onClick={() => deleteGym(g)}
                    title={`Delete "${g}"`}
                    aria-label={`Delete ${g}`}
                    disabled={gyms.length <= 1}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className={styles.gymEditorAddBtn} onClick={addGym}>
                + Add location
              </button>
            </div>
          )}

          <div className={styles.workoutTypeRow}>
            <span className={styles.workoutTypeLabel}>Workout type:</span>
            {workoutTypes.map(t => {
              const effective = effectiveLastByType[t];
              const days = daysSince(effective?.date);
              const isSuggested = t === suggestedType && !workoutType;
              const isActive = workoutType === t;
              const lastReal = lastByType[t];
              const subLabel = effective
                ? (days === 0
                    ? (effective.wasSkipped ? 'skipped today' : 'today')
                    : `${days}d ago${effective.wasSkipped ? ' (skipped)' : ''}`)
                : 'never';
              if (editingTypes) {
                return (
                  <span
                    key={t}
                    className={`${styles.workoutTypePill} ${styles.workoutTypePillEditing || ''}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }}
                  >
                    <span className={styles.workoutTypePillName}>{t}</span>
                    <button
                      type="button"
                      onClick={() => skipWorkoutType(t)}
                      title={`Skip ${t} today — resets the days-ago counter without logging a workout`}
                      style={{
                        border: '1px solid currentColor',
                        background: 'transparent',
                        color: 'inherit',
                        borderRadius: '0.4rem',
                        padding: '0.1rem 0.4rem',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                      }}
                    >
                      ⏭ Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (workoutTypes.length <= 1) {
                          window.alert('Keep at least one workout type. Add a new one before removing this.');
                          return;
                        }
                        if (!window.confirm(`Remove "${t}"? Past workouts tagged "${t}" stay tagged.`)) return;
                        const next = workoutTypes.filter(x => x !== t);
                        setWorkoutTypes(next);
                        saveWorkoutTypes(next, user?.uid);
                        if (workoutType === t) setWorkoutType('');
                      }}
                      title={`Remove "${t}" from your workout types`}
                      style={{
                        border: '1px solid currentColor',
                        background: 'transparent',
                        color: 'inherit',
                        borderRadius: '0.4rem',
                        padding: '0.1rem 0.4rem',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                      }}
                    >
                      × Remove
                    </button>
                  </span>
                );
              }
              return (
                <button
                  key={t}
                  className={`${styles.workoutTypePill} ${isActive ? styles.workoutTypePillActive : ''} ${isSuggested ? styles.workoutTypePillSuggested : ''}`}
                  onClick={() => handleTypeClick(t)}
                  title={lastReal ? `Last ${t}: ${daysSince(lastReal.date)} day${daysSince(lastReal.date) === 1 ? '' : 's'} ago (${formatDate(lastReal.date)})` : `Never done ${t}`}
                  type="button"
                >
                  <span className={styles.workoutTypePillName}>
                    {isSuggested && '⭐ '}{t}
                  </span>
                  <span className={styles.workoutTypePillSub}>
                    {subLabel}
                  </span>
                </button>
              );
            })}

            {addingType ? (
              <input
                autoFocus
                className={styles.workoutTypeInput}
                type="text"
                placeholder="New type name"
                value={newTypeName}
                onChange={e => setNewTypeName(e.target.value)}
                onBlur={() => {
                  const name = newTypeName.trim();
                  if (name && !workoutTypes.some(x => x.toLowerCase() === name.toLowerCase())) {
                    const next = [...workoutTypes, name];
                    setWorkoutTypes(next);
                    saveWorkoutTypes(next, user?.uid);
                  }
                  setNewTypeName('');
                  setAddingType(false);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    setNewTypeName('');
                    setAddingType(false);
                  }
                }}
              />
            ) : (
              <button
                className={styles.workoutTypeAddBtn}
                onClick={() => setAddingType(true)}
                type="button"
                title="Add a new workout type"
              >
                + Add
              </button>
            )}
            <button
              className={`${styles.workoutTypeEditBtn} ${editingTypes ? styles.workoutTypeEditBtnActive : ''}`}
              onClick={() => setEditingTypes(v => !v)}
              type="button"
              title={editingTypes ? 'Done editing' : 'Edit / remove workout types'}
            >
              {editingTypes ? '✓ Done' : '✎ Edit'}
            </button>

            {workoutType && lastByType[workoutType] && !editingTypes && (
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

          {workoutType && lastByType[workoutType] && (() => {
            const last = lastByType[workoutType];
            const days = daysSince(last.date);
            const visibleEntries = (last.entries || []).filter(e => e.exercise);
            return (
              <div className={styles.lastWorkoutPreview}>
                <div className={styles.lastWorkoutPreviewHeader}>
                  Last {workoutType}: {formatDate(last.date)} · {days}d ago
                  {last.gym ? ` · ${last.gym}` : ''}
                </div>
                {visibleEntries.length === 0 ? (
                  <div className={styles.lastWorkoutPreviewEmpty}>No exercises were logged.</div>
                ) : (
                  <ul className={styles.lastWorkoutPreviewList}>
                    {visibleEntries.map((e, i) => {
                      const setsArr = Array.isArray(e.sets) ? e.sets : [];
                      const repsStr = setsArr
                        .filter(s => s !== '' && s != null)
                        .join('/');
                      const wt = parseFloat(e.weight);
                      const wtStr = !isNaN(wt) && wt > 0
                        ? ` @ ${wt}${e.perArm ? '×2' : ''}`
                        : '';
                      return (
                        <li key={i}>
                          <span className={styles.lastWorkoutExercise}>{e.exercise}</span>
                          {repsStr && <span className={styles.lastWorkoutSets}> · {repsStr}</span>}
                          {wtStr && <span className={styles.lastWorkoutSets}>{wtStr}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })()}

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
            <table
              className={styles.logTable}
              style={{ width: logTableWidth, minWidth: 0, tableLayout: 'fixed' }}
            >
              <colgroup>
                {LOG_COLUMN_DEFS.map(c => (
                  <col key={c.id} style={{ width: colWidths[c.id] }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className={styles.logGroupCol}>Group{renderColResizer('group')}</th>
                  <th className={styles.logExerciseCol}>Exercise{renderColResizer('exercise')}</th>
                  <th className={styles.logNotesCol}>Notes{renderColResizer('notes')}</th>
                  <th className={styles.logTimeCol}>Time{renderColResizer('time')}</th>
                  <th className={styles.logSetCol}>S1{renderColResizer('s1')}</th>
                  <th className={styles.logSetCol}>S2{renderColResizer('s2')}</th>
                  <th className={styles.logSetCol}>S3{renderColResizer('s3')}</th>
                  <th className={styles.logSetCol}>S4{renderColResizer('s4')}</th>
                  <th className={styles.logWeightCol}>Weight{renderColResizer('weight')}</th>
                  <th className={styles.logPerCol} title="Weight is per leg/arm (totals double)">Per leg/arm{renderColResizer('per')}</th>
                  <th className={styles.logTotalCol}>Total{renderColResizer('total')}</th>
                  <th className={styles.logRemoveCol}>{renderColResizer('remove')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  let baseW = parseFloat(entry.weight) || 0;
                  if (entry.useSetWeights && Array.isArray(entry.setWeights)) {
                    const nums = entry.setWeights.map(v => parseFloat(v || '')).filter(n => !isNaN(n));
                    if (nums.length > 0) baseW = Math.max(...nums);
                  }
                  const total = entry.perArm ? baseW * 2 : baseW;
                  const ed = entry.editedFields || {};
                  const editedCls = (field) => ed[field] ? styles.manuallyEdited : '';
                  return (
                    <tr key={i}>
                      <td>
                        <select className={`${styles.logCell} ${styles.logGroupSelect} ${editedCls('group')}`} value={entry.group} onChange={e => { updateEntry(i, 'group', e.target.value); pickExercise(i, ''); }}>
                          <option value="">—</option>
                          {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td>
                        <ExerciseSelector
                          value={entry.exercise}
                          options={exercisesForGroup(entry.group)}
                          disabled={!entry.group}
                          muscleGroup={entry.group}
                          className={editedCls('exercise')}
                          onChange={(name) => pickExercise(i, name)}
                          onAddNew={(name) => {
                            if (addExerciseToLibrary(name, entry.group)) {
                              pickExercise(i, name);
                            }
                          }}
                        />
                      </td>
                      <td>
                        <input className={`${styles.logCell} ${editedCls('notes')}`} type="text" value={entry.notes} onChange={e => updateEntry(i, 'notes', e.target.value)} placeholder="" />
                      </td>
                      <td>
                        <input className={`${styles.logCell} ${styles.logTimeInput} ${editedCls('time')}`} type="text" value={entry.time} onChange={e => updateEntry(i, 'time', e.target.value)} placeholder="2:00" />
                      </td>
                      {entry.sets.map((s, si) => {
                        const done = !!(entry.setDone || [])[si];
                        return (
                          <td
                            key={si}
                            className={done ? styles.logSetCellDone : styles.logSetCell}
                            onClick={() => toggleSetDone(i, si)}
                            title={done ? 'Click to un-mark this set' : 'Click to mark this set complete'}
                          >
                            <input
                              className={`${styles.logCell} ${styles.logSetInput} ${editedCls(`set${si}`)}`}
                              type="text"
                              inputMode="text"
                              value={s}
                              onChange={e => updateSet(i, si, e.target.value)}
                              onClick={e => e.stopPropagation()}
                              title="Reps (12), seconds (30s), minutes (2m), hours (1h), or m:ss (1:30)"
                            />
                            {entry.useSetWeights && (
                              <input
                                className={`${styles.logCell} ${styles.logSetWeightInput} ${editedCls(`setWeight${si}`)}`}
                                type="number"
                                value={(entry.setWeights || [])[si] ?? ''}
                                onChange={e => updateSetWeight(i, si, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                placeholder="lb"
                                title={`Set ${si + 1} weight`}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td>
                        {entry.useSetWeights ? (
                          <button
                            type="button"
                            className={`${styles.logCell} ${styles.logWeightInput} ${styles.perSetBadge}`}
                            onClick={() => setEntryUseSetWeights(i, false)}
                            title="Switch back to a single weight for all sets"
                          >
                            PER SET
                          </button>
                        ) : (
                          <span className={styles.weightCellWrap}>
                            <input className={`${styles.logCell} ${styles.logWeightInput} ${editedCls('weight')}`} type="number" value={entry.weight} onChange={e => updateEntry(i, 'weight', e.target.value)} placeholder="" />
                            <button
                              type="button"
                              className={styles.perSetToggleBtn}
                              onClick={() => setEntryUseSetWeights(i, true)}
                              title="Use a different weight per set"
                            >↕</button>
                          </span>
                        )}
                      </td>
                      <td className={`${styles.logPerCell} ${editedCls('perArm')}`}>
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
            <input
              type="date"
              className={styles.dateInput}
              value={historyStartDate}
              onChange={e => setHistoryStartDate(e.target.value)}
              aria-label="Start date"
            />
            <span className={styles.dateSep}>–</span>
            <input
              type="date"
              className={styles.dateInput}
              value={historyEndDate}
              onChange={e => setHistoryEndDate(e.target.value)}
              aria-label="End date"
            />
            <input
              type="text"
              list="historyGymOptions"
              className={styles.groupSelect}
              placeholder="All Locations"
              value={historyGym}
              onChange={e => setHistoryGym(e.target.value)}
              aria-label="Filter by location"
            />
            <datalist id="historyGymOptions">
              {historyGyms.map(g => <option key={g} value={g} />)}
            </datalist>
            <select className={styles.groupSelect} value={historyGroup} onChange={e => setHistoryGroup(e.target.value)}>
              <option value="">All Groups</option>
              {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className={styles.groupSelect} value={historyExercise} onChange={e => setHistoryExercise(e.target.value)}>
              <option value="">All Exercises</option>
              {historyExercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
            </select>
            {hasActiveHistoryFilters && (
              <button className={styles.clearBtn} onClick={clearHistoryFilters}>Clear</button>
            )}
            <button
              className={styles.clearBtn}
              onClick={exportHistory}
              title="Download a .csv file (opens in Excel) of the currently filtered history"
            >Export</button>
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
                .filter(({ e }) =>
                  (!historyGroup || e.group === historyGroup) &&
                  (!historyExercise || e.exercise === historyExercise)
                );
              visible.forEach(({ e, originalIdx }, idx) => {
                flatRows.push({ w, e, originalIdx, isFirstOfDay: idx === 0, dayCount: visible.length });
              });
            }
            const visibleKeys = flatRows.map(({ w, originalIdx }) => rowKey(w.date, originalIdx));
            const visibleSelectedCount = visibleKeys.reduce((n, k) => n + (selectedRows.has(k) ? 1 : 0), 0);
            const allVisibleSelected = visibleKeys.length > 0 && visibleSelectedCount === visibleKeys.length;
            const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
            return (
              <div className={styles.logTableWrap}>
                {selectedRows.size > 0 && (
                  <div className={styles.bulkBar}>
                    <span className={styles.bulkCount}>{selectedRows.size} selected</span>
                    <select
                      className={styles.bulkSelect}
                      value=""
                      onChange={ev => { if (ev.target.value) bulkUpdateField('group', ev.target.value); }}
                    >
                      <option value="">Set group…</option>
                      {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select
                      className={styles.bulkSelect}
                      value=""
                      onChange={ev => { if (ev.target.value) bulkUpdateField('exercise', ev.target.value); }}
                    >
                      <option value="">Set exercise…</option>
                      {(() => {
                        // Aggregate every group's visible list (defaults + customs - hidden)
                        // so bulk-edit choices match the mobile picker exactly.
                        const all = new Set();
                        for (const g of MUSCLE_GROUPS) {
                          for (const ex of exercisesForGroup(g)) all.add(ex);
                        }
                        return Array.from(all)
                          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
                          .map(ex => <option key={ex} value={ex}>{ex}</option>);
                      })()}
                    </select>
                    <select
                      className={styles.bulkSelect}
                      value=""
                      onChange={ev => { if (ev.target.value) bulkSetGym(ev.target.value); }}
                    >
                      <option value="">Set location…</option>
                      {gyms.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <input
                      type="number"
                      className={styles.bulkInput}
                      placeholder="Weight"
                      value={bulkWeightInput}
                      onChange={ev => setBulkWeightInput(ev.target.value)}
                      onKeyDown={ev => {
                        if (ev.key === 'Enter' && bulkWeightInput !== '') {
                          bulkUpdateField('weight', bulkWeightInput);
                          setBulkWeightInput('');
                        }
                      }}
                    />
                    <button
                      className={styles.bulkApplyBtn}
                      disabled={bulkWeightInput === ''}
                      onClick={() => { bulkUpdateField('weight', bulkWeightInput); setBulkWeightInput(''); }}
                    >Apply weight</button>
                    <input
                      type="text"
                      className={styles.bulkInput}
                      placeholder="Notes"
                      value={bulkNotesInput}
                      onChange={ev => setBulkNotesInput(ev.target.value)}
                      onKeyDown={ev => {
                        if (ev.key === 'Enter') {
                          bulkUpdateField('notes', bulkNotesInput);
                          setBulkNotesInput('');
                        }
                      }}
                    />
                    <button
                      className={styles.bulkApplyBtn}
                      onClick={() => { bulkUpdateField('notes', bulkNotesInput); setBulkNotesInput(''); }}
                    >Apply notes</button>
                    <button className={styles.bulkPerBtn} onClick={() => bulkUpdateField('perArm', true)} title="Mark as per arm/leg">Per arm/leg ✓</button>
                    <button className={styles.bulkPerBtn} onClick={() => bulkUpdateField('perArm', false)} title="Unmark per arm/leg">Per arm/leg ✗</button>
                    <button className={styles.bulkDeleteBtn} onClick={bulkDeleteSelected}>Delete</button>
                    <button className={styles.bulkClearBtn} onClick={clearSelectedRows}>Clear</button>
                  </div>
                )}
                <table className={styles.logTable}>
                  <thead>
                    <tr>
                      <th className={styles.logSelectCol}>
                        <input
                          type="checkbox"
                          aria-label="Select all visible"
                          checked={allVisibleSelected}
                          ref={el => { if (el) el.indeterminate = someVisibleSelected; }}
                          onChange={() => setVisibleRowsSelected(visibleKeys, !allVisibleSelected)}
                        />
                      </th>
                      <th>Date</th>
                      <th className={styles.logGroupCol}>Group</th>
                      <th className={styles.logExerciseCol}>Exercise</th>
                      <th className={styles.logNotesCol}>Notes</th>
                      <th className={styles.logSetCol} title="Set 1 reps">S1</th>
                      <th className={styles.logSetCol}>S2</th>
                      <th className={styles.logSetCol}>S3</th>
                      <th className={styles.logSetCol}>S4</th>
                      <th className={styles.logWeightCol}>Weight</th>
                      <th className={styles.logPerCol} title="Per leg/arm">Per leg/arm</th>
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
                      const setWeightsArr = Array.isArray(e.setWeights) ? e.setWeights : [];
                      const setWeightVals = [0, 1, 2, 3].map(si => {
                        const v = setWeightsArr[si];
                        return v == null ? '' : String(v);
                      });
                      let baseWt = parseFloat(e.weight) || 0;
                      if (e.useSetWeights && setWeightsArr.length > 0) {
                        const nums = setWeightsArr.map(v => parseFloat(v || '')).filter(n => !isNaN(n));
                        if (nums.length > 0) baseWt = Math.max(...nums);
                      }
                      const total = e.perArm ? baseWt * 2 : baseWt;
                      const rk = rowKey(w.date, originalIdx);
                      const isSelected = selectedRows.has(rk);
                      return (
                        <tr
                          key={`${w.date}-${originalIdx}`}
                          className={`${isFirstOfDay ? styles.historyRowDayStart : ''} ${isSelected ? styles.historyRowSelected : ''}`.trim() || undefined}
                        >
                          <td className={styles.logSelectCell}>
                            <input
                              type="checkbox"
                              aria-label="Select row"
                              checked={isSelected}
                              onChange={() => toggleRowSelected(w.date, originalIdx)}
                            />
                          </td>
                          {isFirstOfDay && (
                            <td rowSpan={dayCount} className={styles.historyDateCell}>
                              <input
                                type="date"
                                className={styles.historyDateInput}
                                value={w.date}
                                onChange={ev => setHistoryDate(w.date, ev.target.value)}
                                title="Edit date"
                              />
                              <div className={styles.historyDateMain}>{formatDate(w.date)}</div>
                              <select
                                className={styles.historyGymSelect}
                                value={w.gym || ''}
                                onChange={ev => setHistoryGymForDate(w.date, ev.target.value)}
                                title="Edit location"
                              >
                                {w.gym && !gyms.includes(w.gym) && (
                                  <option value={w.gym}>{w.gym}</option>
                                )}
                                {gyms.map(g => <option key={g} value={g}>{g}</option>)}
                              </select>
                              <select
                                className={styles.historyTypeSelect}
                                value={w.workoutType || ''}
                                onChange={ev => setHistoryWorkoutType(w.date, ev.target.value)}
                                title="Tag this workout's type"
                              >
                                <option value="">No type</option>
                                {workoutTypes.map(t => <option key={t} value={t}>{t}</option>)}
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
                              {(() => {
                                const list = e.group ? exercisesForGroup(e.group) : [];
                                // Keep the currently-selected exercise visible even if it
                                // differs only in casing/whitespace from a list entry —
                                // <select> matches value case-sensitively, so a near-miss
                                // would render as blank instead of the saved exercise.
                                if (e.exercise && !list.includes(e.exercise)) {
                                  list.unshift(e.exercise);
                                }
                                return list.map(ex => (
                                  <option key={ex} value={ex}>{ex}</option>
                                ));
                              })()}
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
                          {setVals.map((reps, si) => {
                            const done = !!(e.setDone || [])[si];
                            return (
                              <td
                                key={si}
                                className={done ? styles.logSetCellDone : styles.logSetCell}
                                title={done ? 'Marked complete in the original workout' : undefined}
                              >
                                <input
                                  className={`${styles.logCell} ${styles.logSetInput}`}
                                  type="text"
                                  inputMode="text"
                                  value={reps}
                                  onChange={ev => updateHistorySetField(w.date, originalIdx, si, ev.target.value)}
                                  title="Reps (12), seconds (30s), minutes (2m), hours (1h), or m:ss (1:30)"
                                />
                                {e.useSetWeights && (
                                  <input
                                    className={`${styles.logCell} ${styles.logSetWeightInput}`}
                                    type="number"
                                    value={setWeightVals[si]}
                                    onChange={ev => updateHistorySetWeight(w.date, originalIdx, si, ev.target.value)}
                                    placeholder="lb"
                                    title={`Set ${si + 1} weight`}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td>
                            {e.useSetWeights ? (
                              <button
                                type="button"
                                className={`${styles.logCell} ${styles.logWeightInput} ${styles.perSetBadge}`}
                                onClick={() => setHistoryUseSetWeights(w.date, originalIdx, false)}
                                title="Switch back to a single weight for all sets"
                              >
                                PER SET
                              </button>
                            ) : (
                              <span className={styles.weightCellWrap}>
                                <input
                                  className={`${styles.logCell} ${styles.logWeightInput}`}
                                  type="number"
                                  value={e.weight ?? ''}
                                  onChange={ev => updateHistoryField(w.date, originalIdx, 'weight', ev.target.value)}
                                />
                                <button
                                  type="button"
                                  className={styles.perSetToggleBtn}
                                  onClick={() => setHistoryUseSetWeights(w.date, originalIdx, true)}
                                  title="Use a different weight per set"
                                >↕</button>
                              </span>
                            )}
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

      {viewMode === 'body' && (
        <BodyHeatmap workouts={workouts} exerciseLibrary={exerciseLibrary} />
      )}

      {viewMode === 'exercises' && (
        <ExerciseLibrary
          library={exerciseLibrary}
          onChange={(next) => {
            // Diff to detect deletions so we can also drop the matching
            // customExercises entry — otherwise the snapshot backfill
            // (which promotes customExercises into exerciseLibrary) would
            // immediately resurrect anything the user just removed here.
            const nextNames = new Set(
              (next || [])
                .map(e => (e?.exercise || '').trim().toLowerCase())
                .filter(Boolean),
            );
            const removed = new Set(
              (exerciseLibrary || [])
                .map(e => (e?.exercise || '').trim().toLowerCase())
                .filter(n => n && !nextNames.has(n)),
            );
            setExerciseLibrary(next);
            saveLibrary(next, user?.uid);
            if (removed.size > 0 && user?.uid) {
              const trimmedCustom = (customExercises || []).filter(c => {
                const n = String(c?.name || '').trim().toLowerCase();
                return !(n && removed.has(n));
              });
              if (trimmedCustom.length !== (customExercises || []).length) {
                setCustomExercises(trimmedCustom);
                saveField(user.uid, 'customExercises', trimmedCustom).catch(() => {});
              }
            }
          }}
        />
      )}

      {viewMode === 'steps' && (
        <StepsTab user={user} />
      )}

      {viewMode === 'sleep' && (
        <SleepTab user={user} />
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

          <OverviewBarCharts user={user} workouts={workouts} />
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
              Upload a <code>.csv</code> / <code>.tsv</code> file or paste below. Columns are auto-detected
              and adjustable in the mapping panel — recognized targets: <code style={{ fontSize: '0.78rem' }}>Date, Exercises, Group, Gym/Location, Notes, Rest Time, Set 1–4, Per Arm/Leg (number or Yes/No), Total Weight, Workout Type</code>.
              Choose <strong>Merge</strong> or <strong>Replace</strong> below.
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
                      setUserColMap(null);
                      // Auto-parse so user sees preview + mapping immediately.
                      try {
                        const result = parseWorkoutCsv(text);
                        const ncols = (result.headers || []).length;
                        if (ncols > 0) {
                          setImportPreview(result);
                          setUserColMap(deriveColMapOverride(result.colMap, ncols));
                        }
                      } catch (err) {
                        setImportError(err.message || 'Parse failed');
                        const { headers, sampleRow } = getCsvHeadersAndSample(text);
                        if (headers.length > 0) {
                          setImportPreview({ workouts: [], skippedRows: [], cleanings: [], headers, colMap: {}, sampleRow });
                          const blank = {};
                          for (let i = 0; i < headers.length; i++) blank[i] = 'ignore';
                          setUserColMap(blank);
                        }
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
              onChange={e => {
                setImportText(e.target.value);
                setImportPreview(null);
                setImportError('');
                setUserColMap(null);
              }}
            />
            {importError && (
              <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 0.75rem', borderRadius: 6, marginTop: '0.5rem', fontSize: '0.82rem' }}>
                {importError}
              </div>
            )}
            <fieldset style={{
              marginTop: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '0.5rem 0.85rem 0.6rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}>
              <legend style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', padding: '0 0.35rem' }}>
                Import mode
              </legend>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  style={{ marginTop: '0.18rem' }}
                />
                <span>
                  <strong>Merge by date</strong>
                  <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.78rem' }}>
                    Replace only the workout days that appear in the CSV. Other days stay.
                  </span>
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  style={{ marginTop: '0.18rem' }}
                />
                <span>
                  <strong style={{ color: '#991B1B' }}>Replace all history</strong>
                  <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.78rem' }}>
                    Delete every existing workout and replace with the CSV. Can&apos;t be undone.
                  </span>
                </span>
              </label>
            </fieldset>
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
                  disabled={importPreview.workouts.length === 0}
                  style={{
                    flex: 1,
                    background: importPreview.workouts.length === 0
                      ? '#9ca3af'
                      : (importMode === 'replace' ? '#dc2626' : '#16a34a'),
                  }}
                  title={importMode === 'replace' ? 'Replace ALL workout history with the CSV' : 'Merge by date — only days in the CSV are replaced'}
                >
                  {importMode === 'replace' ? 'Replace all' : 'Import'} {importPreview.workouts.length} workout{importPreview.workouts.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
            {importPreview && userColMap && importPreview.headers && importPreview.headers.length > 0 && (
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem 0.85rem',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: 'var(--color-surface-alt)',
              }}>
                <div style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--color-text-muted)',
                  marginBottom: '0.5rem',
                }}>
                  Column mapping
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {importPreview.headers.map((h, i) => {
                    const sample = (importPreview.sampleRow || [])[i] || '';
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: 'var(--color-text-muted)',
                          background: 'var(--color-surface)',
                          padding: '0.2rem 0.45rem',
                          borderRadius: 6,
                          border: '1px solid var(--color-border)',
                          flexShrink: 0,
                          minWidth: 38,
                          textAlign: 'center',
                        }}>
                          {i + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {h || <em style={{ color: 'var(--color-text-muted)' }}>(no header)</em>}
                          </span>
                          {sample && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={sample}>
                              e.g. {sample}
                            </span>
                          )}
                        </div>
                        <select
                          value={userColMap[i] || 'ignore'}
                          onChange={e => changeColumnMapping(i, e.target.value)}
                          style={{
                            padding: '0.35rem 0.5rem',
                            border: '1px solid var(--color-border)',
                            borderRadius: 6,
                            fontSize: '0.85rem',
                            background: 'var(--color-surface)',
                            color: 'var(--color-text)',
                            cursor: 'pointer',
                            minWidth: 130,
                          }}
                        >
                          {WORKOUT_TARGET_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem', lineHeight: 1.4 }}>
                  Date and Exercises are required. Changing a mapping re-parses the preview below.
                </div>
              </div>
            )}
            {importPreview && importPreview.workouts.length > 0 && (() => {
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
