import { useState, useMemo, useRef } from 'react';
import styles from './ExerciseLibrary.module.css';
import { ExerciseDemo, ExerciseDemoThumb } from './ExerciseDemo';
import { EXERCISE_TYPES, effectiveExerciseType, normalizeExerciseType } from '../utils/exerciseTypes';

const HEADER_ALIASES = {
  exercise: ['workout', 'exercise', 'exercises', 'name'],
  primaryMuscles: ['primary muscles', 'primary'],
  secondaryMuscles: ['secondary muscles', 'secondary'],
  group: ['group'],
  exerciseType: ['type', 'exercise type'],
  thisWeek: ['this week'],
  lastWeek: ['last week'],
  alternative: ['alternative', 'alt'],
  top: ['top'],
  nickname: ['knickname', 'nickname'],
};
const VIDEO_HEADERS = ['insta', 'insta 2', 'insta 3', 'insta 4', 'insta 5', 'video', 'video 2', 'video 3', 'video 4', 'video 5'];

function detectDelim(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  return tabs > 0 ? '\t' : ',';
}

function splitLine(line, delim) {
  if (delim !== ',') return line.split(delim).map(s => s.trim());
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

function findColIdx(headers, aliases) {
  const norm = headers.map(h => h.trim().toLowerCase());
  for (const a of aliases) {
    const i = norm.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

function cleanCell(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s === '—' || s === '-' || s === '–') return '';
  return s;
}

function toInt(v) {
  const s = cleanCell(v);
  if (!s) return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

export function parseExerciseLibrary(text) {
  const delim = detectDelim(text);
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitLine(lines[0], delim);
  const idx = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    idx[field] = findColIdx(headers, aliases);
  }
  const videoIdxs = [];
  const normHeaders = headers.map(h => h.trim().toLowerCase());
  for (const v of VIDEO_HEADERS) {
    const i = normHeaders.indexOf(v);
    if (i >= 0) videoIdxs.push(i);
  }
  if (videoIdxs.length === 0) {
    for (let i = 0; i < headers.length; i++) {
      if (/^(insta|video)/i.test(headers[i].trim())) videoIdxs.push(i);
    }
  }
  if (idx.exercise < 0) throw new Error('CSV must have an Exercise/Workout column');

  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitLine(lines[li], delim);
    const exercise = cleanCell(cells[idx.exercise]);
    if (!exercise) continue;
    const alternative = idx.alternative >= 0 ? cleanCell(cells[idx.alternative]) : '';
    const retired = alternative.toLowerCase() === 'retired';
    const videos = videoIdxs.map(i => cleanCell(cells[i])).filter(Boolean);
    out.push({
      exercise,
      primaryMuscles: idx.primaryMuscles >= 0 ? cleanCell(cells[idx.primaryMuscles]) : '',
      secondaryMuscles: idx.secondaryMuscles >= 0 ? cleanCell(cells[idx.secondaryMuscles]) : '',
      group: idx.group >= 0 ? cleanCell(cells[idx.group]) : '',
      // Round-trips the exported "Type" column; unrecognised values fall back
      // to '' so the picker re-infers rather than inventing a third bucket.
      exerciseType: idx.exerciseType >= 0 ? normalizeExerciseType(cells[idx.exerciseType]) : '',
      thisWeek: idx.thisWeek >= 0 ? toInt(cells[idx.thisWeek]) : 0,
      lastWeek: idx.lastWeek >= 0 ? toInt(cells[idx.lastWeek]) : 0,
      alternative: retired ? '' : alternative,
      top: idx.top >= 0 ? cleanCell(cells[idx.top]).toLowerCase() === 'x' : false,
      nickname: idx.nickname >= 0 ? cleanCell(cells[idx.nickname]) : '',
      retired,
      videos,
    });
  }
  return out;
}

const MUSCLE_GROUP_LOOKUP = {
  Abs: ['Ab crunch machine', 'Cable crunches', 'Cable woodchoppers', 'Cable woodchoppers - High to low', 'Deadbug', 'Dragon flag abs', 'Elbow plank', 'Hanging leg raise', 'Hanging leg raises knees bent', 'Hanging leg raises legs straight', 'Heel taps', 'Kneeling halo', 'Leg raises', 'Pallof press', 'Plank', 'Seated cable crunch', 'Side bend', 'Toe touches'],
  Back: ['Back extensions', 'Back extensions - machine', 'Bent-over dumbbell row', 'Bent-over smith machine row', 'Cable lat pullover', 'Chin ups', 'Face pulls', 'Lat pull down (wide grip)', 'Lat pull downs (bar)', 'Lat pull downs (bar) underhand grip', 'Lat pull downs (machine)', 'Lat pulldown (vbar grip)', 'Middle grip row', 'One arm rows', 'Plate-loaded low row', 'Pull-ups', 'Seated cable row', 'Seated neutral grip row', 'Seated pronated machine row', 'Seated vertical row machine', 'Single arm cable row', 'Single arm lat pulldown', 'Standing bent-over dumbbell row', 'T bar machine', 'Two arm cable row', 'Weighted pull-up', 'Wide grip row'],
  Biceps: ['Bar curls', 'Bayesian bicep curl', 'Bicep curl', 'Bicep curl machine', 'Bicep hammer curls', 'Hammer rope curls', 'Preacher curl'],
  Cardio: ['Recumbent upright bike'],
  Chest: ['Butterfly', 'Cable crossover low to high', 'Cable flys declined', 'Chest press', 'Decline Barbell Press', 'Decline press', 'Decline push-up', 'Dumbbell flys', 'Dumbbell press', 'Dumbbell press inclined', 'Dumbbell squeeze press', 'Incline press', 'Inclined Barbell Press', 'Inclined machine press', 'Inclined smith machine press'],
  Forearms: ['wrist curls', 'wrist extensions'],
  Heat: ['Sauna', 'Hottub', 'Steam room'],
  Legs: ['Air squats', 'Barbell squats', 'Buglarian split squat', 'Bulgarian split squat', 'Curtsey lunges', 'Deadlifts', 'Dumbbell deadlift', 'Glute bridges', 'Good mornings', 'Hamstring curls', 'Hip thrust_barbell', 'Jump rope', 'Leg extensions', 'Leg press', 'Leg press calf raise', 'Romanian deadlifts - barbell', 'Romanian deadlifts - dumbbell', 'Seated abductors', 'Single leg extension', 'Single leg press', 'Squats - Barbell', 'Squats - Smith machine', 'Sumo squat', 'Sumo squat cable machine', 'Walk', 'Wall squats'],
  Shoulders: ['Arm raises - Lateral', 'Cable lateral raise', 'Dumbbell shoulder press', 'Face pull', 'Shoulder press'],
  Triceps: ['Cable tricep kickback', 'Extension', 'Seated tricep', 'Triangle pushup', 'Tricep push down machine', 'Tricep pushdown', 'Tricep rope pushdowns'],
  'Whole Body': ['Warm up'],
  Yoga: ['Bikram hot yoga', 'Vinyasa', 'Yin'],
};

const MUSCLE_GROUP_BY_EXERCISE = (() => {
  const map = {};
  for (const [group, exercises] of Object.entries(MUSCLE_GROUP_LOOKUP)) {
    for (const ex of exercises) {
      map[ex.trim().toLowerCase()] = group;
    }
  }
  return map;
})();

export function lookupMuscleGroup(exerciseName) {
  return MUSCLE_GROUP_BY_EXERCISE[String(exerciseName || '').trim().toLowerCase()] || '';
}

export function effectiveMuscleGroup(e) {
  return (e?.muscleGroup && e.muscleGroup.trim()) || lookupMuscleGroup(e?.exercise);
}

const KNOWN_GROUPS = Object.keys(MUSCLE_GROUP_LOOKUP).sort();

function blankExercise() {
  return {
    exercise: '',
    primaryMuscles: '',
    secondaryMuscles: '',
    group: '',
    muscleGroup: '',
    exerciseType: '',
    thisWeek: 0,
    lastWeek: 0,
    alternative: '',
    top: false,
    nickname: '',
    retired: false,
    videos: [],
    addedAt: new Date().toISOString(),
  };
}

function formatAddedDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function videoSourceLabel(url) {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'IG';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YT';
  if (u.includes('tiktok.com')) return 'TT';
  return '↗';
}

export function ExerciseLibrary({ library, onChange, onRenameExercise }) {
  const [search, setSearch] = useState('');
  // The name cell is a DRAFT while focused: renaming propagates to every logged
  // workout, so it must fire once on commit (blur/Enter) — never per keystroke,
  // which would rewrite history to each half-typed prefix. `null` = not editing.
  const [nameDraft, setNameDraft] = useState(null); // { idx, value }
  // Escape sets this synchronously before blurring. A ref, not state: the blur
  // handler runs before a state update lands, so it would still read the old
  // draft and commit the very rename we're trying to abandon.
  const cancelNameEditRef = useRef(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [topOnly, setTopOnly] = useState(false);
  const [fillingMuscles, setFillingMuscles] = useState(false);
  const [fillReport, setFillReport] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [colSearch, setColSearch] = useState({});
  const [sort, setSort] = useState({ col: '', dir: 'asc' });
  const [demoName, setDemoName] = useState(null);
  // '' | 'type' | 'group' — narrows the table to the rows the gap banner counts.
  const [missingFilter, setMissingFilter] = useState('');

  const COLUMNS = useMemo(() => [
    { key: 'exercise', label: 'Exercise', cls: 'colName', searchable: true, sortable: true, get: e => e.exercise },
    { key: 'demo', label: 'Demo', cls: 'colDemo', searchable: false, sortable: false, get: () => '' },
    { key: 'exerciseType', label: 'Type', cls: 'colExerciseType', searchable: true, sortable: true, get: e => effectiveExerciseType(e, effectiveMuscleGroup(e)) },
    { key: 'muscleGroup', label: 'Muscle Group', cls: 'colMuscleGroup', searchable: true, sortable: true, get: e => effectiveMuscleGroup(e) },
    { key: 'primary', label: 'Primary', cls: 'colMuscles', searchable: true, sortable: true, get: e => e.primaryMuscles },
    { key: 'secondary', label: 'Secondary', cls: 'colMuscles', searchable: true, sortable: true, get: e => e.secondaryMuscles },
    { key: 'videos', label: 'Videos', cls: 'colVideos', searchable: false, sortable: true, get: e => e.videos.length },
    { key: 'alternative', label: 'Alternative', cls: 'colAlt', searchable: true, sortable: true, get: e => e.alternative },
    { key: 'addedAt', label: 'Date Added', cls: 'colAddedAt', searchable: false, sortable: true, get: e => e.addedAt || '' },
    { key: 'actions', label: '', cls: 'colActions', searchable: false, sortable: false, get: () => '' },
  ], []);

  function updateRow(originalIdx, field, value) {
    onChange(library.map((row, i) => i === originalIdx ? { ...row, [field]: value } : row));
  }

  // Rows still missing their Primary muscles. Keyed off Primary alone: plenty of
  // stretches genuinely have no secondary muscle, and including those would keep
  // the button offering to fill rows that are already as complete as they get.
  const missingMuscles = useMemo(
    () => library.filter(e => String(e?.exercise || '').trim() && !String(e?.primaryMuscles || '').trim()),
    [library],
  );

  // Rows running on a GUESS rather than a stored value. Both Type and Muscle
  // Group fall back to an inference when they're blank, and the fallback reads
  // as a real answer — the Muscle Group only differs by being grey placeholder
  // text, and the Type just says "Auto (…)". Neither is saved, so it can move
  // under you when the inference changes and it doesn't reach the phone.
  //
  // Retired rows are left out on purpose: they're hidden by default, and a guess
  // on something you've stopped doing isn't worth chasing. Unnamed rows too, so
  // "+ Add exercise" doesn't immediately trip the warning about itself.
  const trackedRows = useMemo(
    () => library.filter(e => String(e?.exercise || '').trim() && !e.retired),
    [library],
  );
  const missingType = useMemo(
    () => trackedRows.filter(e => !normalizeExerciseType(e.exerciseType)),
    [trackedRows],
  );
  const missingGroup = useMemo(
    () => trackedRows.filter(e => !String(e?.muscleGroup || '').trim()),
    [trackedRows],
  );

  // Showing "the N with no Type" has to actually show N rows, so the filters
  // that would eat into that set stand down when one of these turns on.
  function toggleMissingFilter(which) {
    const next = missingFilter === which ? '' : which;
    setMissingFilter(next);
    if (next) {
      setGroupFilter('');
      setTopOnly(false);
      setShowRetired(false);
    }
  }

  /**
   * Look up the muscles worked for every row missing them and fill them in.
   *
   * One request for the whole set, one write at the end. Only ever writes into
   * a BLANK cell — a name the lookup can't place confidently is reported back
   * rather than filled with a guess, because a wrong muscle here silently
   * mis-colours the body map and skews the group totals.
   */
  async function fillMissingMuscles() {
    const names = missingMuscles.map(e => String(e.exercise).trim());
    if (names.length === 0) return;
    setFillingMuscles(true);
    setFillReport(null);
    try {
      const res = await fetch('/api/exercise-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      const { results } = await res.json();
      const unmatched = [];
      let filled = 0;
      const next = library.map(row => {
        const name = String(row?.exercise || '').trim();
        if (!name || String(row?.primaryMuscles || '').trim()) return row;
        const hit = results?.[name];
        if (!hit || !(hit.primaryMuscles || []).length) { unmatched.push(name); return row; }
        filled += 1;
        return {
          ...row,
          primaryMuscles: hit.primaryMuscles.join(', '),
          // Don't clobber a secondary that was filled in by hand.
          secondaryMuscles: String(row?.secondaryMuscles || '').trim()
            || (hit.secondaryMuscles || []).join(', '),
        };
      });
      if (filled > 0) onChange(next);
      setFillReport({ filled, unmatched });
    } catch (err) {
      setFillReport({ filled: 0, unmatched: [], error: err?.message || 'Lookup failed' });
    } finally {
      setFillingMuscles(false);
    }
  }

  // Commit the in-progress name edit for a row. A rename of an EXISTING named
  // exercise is handed to onRenameExercise, which owns the library write too (it
  // also merges collisions) — so we deliberately don't updateRow on that path.
  // Naming a blank new row, or clearing a name, is just a plain cell edit.
  function commitName(originalIdx) {
    if (cancelNameEditRef.current) { cancelNameEditRef.current = false; setNameDraft(null); return; }
    const draft = nameDraft;
    if (!draft || draft.idx !== originalIdx) return;
    setNameDraft(null);
    const oldName = (library[originalIdx]?.exercise || '').trim();
    const newName = draft.value.trim();
    if (newName === oldName) return;
    if (!oldName || !newName || !onRenameExercise) {
      updateRow(originalIdx, 'exercise', draft.value);
      return;
    }
    // Declined (cancelled confirm) → draft is already cleared, so the input
    // falls back to the untouched row value and the old name reappears.
    onRenameExercise(oldName, newName);
  }
  function addRow() {
    onChange([blankExercise(), ...library]);
    // Clear any active sort so the new row stays visible at the top.
    setSort({ col: '', dir: 'asc' });
  }
  function removeRow(originalIdx) {
    const ex = library[originalIdx];
    const label = ex?.exercise?.trim() || 'this row';
    if (!window.confirm(`Remove ${label}? This can't be undone.`)) return;
    onChange(library.filter((_, i) => i !== originalIdx));
  }

  function toggleSort(col) {
    setSort(prev => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: '', dir: 'asc' };
    });
  }

  function sortIcon(col) {
    if (sort.col !== col) return <span className={styles.sortIconDim}>↕</span>;
    return <span className={styles.sortIcon}>{sort.dir === 'asc' ? '↑' : '↓'}</span>;
  }

  const muscleGroups = useMemo(() => {
    const s = new Set();
    for (const e of library) {
      const g = effectiveMuscleGroup(e);
      if (g) s.add(g);
    }
    return Array.from(s).sort();
  }, [library]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library
      .map((e, originalIdx) => ({ e, originalIdx }))
      .filter(({ e }) => {
        if (!showRetired && e.retired) return false;
        if (topOnly && !e.top) return false;
        if (groupFilter && effectiveMuscleGroup(e) !== groupFilter) return false;
        // Same tests the banner counts with, so the two agree row for row.
        if (missingFilter) {
          if (!String(e.exercise || '').trim() || e.retired) return false;
          if (missingFilter === 'type' && normalizeExerciseType(e.exerciseType)) return false;
          if (missingFilter === 'group' && String(e.muscleGroup || '').trim()) return false;
        }
        for (const c of COLUMNS) {
          const term = (colSearch[c.key] || '').trim().toLowerCase();
          if (!term) continue;
          const v = c.get(e);
          if (v == null) return false;
          if (!String(v).toLowerCase().includes(term)) return false;
        }
        if (!q) return true;
        return (
          e.exercise.toLowerCase().includes(q) ||
          e.nickname.toLowerCase().includes(q) ||
          e.primaryMuscles.toLowerCase().includes(q) ||
          e.secondaryMuscles.toLowerCase().includes(q) ||
          e.alternative.toLowerCase().includes(q)
        );
      });
  }, [library, search, groupFilter, showRetired, topOnly, colSearch, COLUMNS, missingFilter]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find(c => c.key === sort.col);
    if (!col) return filtered;
    const arr = [...filtered];
    const dir = sort.dir === 'desc' ? -1 : 1;
    arr.sort((a, b) => {
      const av = col.get(a.e);
      const bv = col.get(b.e);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });
    return arr;
  }, [filtered, sort, COLUMNS]);

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function handleExport() {
    const cols = [
      { header: 'Exercise', get: e => e.exercise },
      { header: 'Nickname', get: e => e.nickname || '' },
      { header: 'Type', get: e => effectiveExerciseType(e, effectiveMuscleGroup(e)) },
      { header: 'Muscle Group', get: e => effectiveMuscleGroup(e) },
      { header: 'Primary Muscles', get: e => e.primaryMuscles || '' },
      { header: 'Secondary Muscles', get: e => e.secondaryMuscles || '' },
      { header: 'Videos', get: e => (e.videos || []).join(', ') },
      { header: 'Alternative', get: e => e.alternative || '' },
      { header: 'Retired', get: e => (e.retired ? 'Yes' : '') },
      { header: 'Top', get: e => (e.top ? 'x' : '') },
      { header: 'Date Added', get: e => formatAddedDate(e.addedAt) },
    ];
    const rows = sorted.map(({ e }) => cols.map(c => csvCell(c.get(e))).join(','));
    const csv = [cols.map(c => c.header).join(','), ...rows].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `exercises-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleParseImport() {
    setImportError('');
    try {
      const parsed = parseExerciseLibrary(importText);
      if (parsed.length === 0) {
        setImportError('No valid rows found. Check that the data has a Workout/Exercise column.');
        return;
      }
      setImportPreview(parsed);
    } catch (err) {
      setImportError(err.message || 'Parse failed');
    }
  }

  function handleConfirmImport() {
    if (!importPreview) return;
    onChange(importPreview);
    setShowImport(false);
    setImportText('');
    setImportPreview(null);
    setImportError('');
  }

  if (library.length === 0 && !showImport) {
    return (
      <div className={styles.section}>
        <div className={styles.empty}>
          <p>No exercises in your library yet. Add manually or import a list.</p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className={styles.primaryBtn} onClick={addRow}>+ Add exercise</button>
            <button className={styles.secondaryBtn} onClick={() => setShowImport(true)}>Import Exercises</button>
          </div>
          <p className={styles.hint}>
            Paste a tab- or comma-separated list with columns like <code>Workout, Primary Muscles, Secondary Muscles, Group, Insta, Insta 2…, Knickname</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search exercises, muscles, nickname…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={styles.select} value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
          <option value="">All muscle groups</option>
          {muscleGroups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={topOnly} onChange={e => setTopOnly(e.target.checked)} />
          Top only
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />
          Show retired
        </label>
        <button className={styles.primaryBtn} onClick={addRow}>+ Add exercise</button>
        <button className={styles.secondaryBtn} onClick={() => setShowImport(true)}>Re-import</button>
        <button
          className={styles.secondaryBtn}
          onClick={handleExport}
          disabled={filtered.length === 0}
          title="Download the currently shown exercises as a CSV"
        >
          Export CSV
        </button>
        {missingMuscles.length > 0 && (
          <button
            className={styles.secondaryBtn}
            onClick={fillMissingMuscles}
            disabled={fillingMuscles}
            title={`Look up the muscles worked for the ${missingMuscles.length} exercise${missingMuscles.length === 1 ? '' : 's'} with no Primary set, and fill them in. Existing values are never overwritten.`}
          >
            {fillingMuscles ? 'Looking up…' : `Fill muscles (${missingMuscles.length})`}
          </button>
        )}
      </div>

      {fillReport && (
        <div className={styles.fillReport}>
          {fillReport.error
            ? <>Couldn’t look the muscles up — {fillReport.error}. Nothing was changed.</>
            : <><strong>{fillReport.filled}</strong> filled in</>}
          {!fillReport.error && fillReport.unmatched.length > 0 && (
            <>
              {' · '}
              <strong>{fillReport.unmatched.length}</strong> with no confident match, left blank:{' '}
              <span className={styles.fillUnmatched}>{fillReport.unmatched.join(', ')}</span>
            </>
          )}
          <button className={styles.fillReportClose} onClick={() => setFillReport(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {(missingType.length > 0 || missingGroup.length > 0) && (
        <div className={styles.gapBanner}>
          <span className={styles.gapIcon} aria-hidden="true">⚠</span>
          <div className={styles.gapBody}>
            <strong>Some exercises are running on a guess.</strong>{' '}
            A blank Type or Muscle Group falls back to whatever the app can infer from the
            exercise name. That guess isn’t stored — it can change as the name does, and it
            doesn’t travel to the phone. Setting the value explicitly pins it.
            <div className={styles.gapActions}>
              {missingType.length > 0 && (
                <button
                  type="button"
                  className={missingFilter === 'type' ? styles.gapBtnOn : styles.gapBtn}
                  onClick={() => toggleMissingFilter('type')}
                  aria-pressed={missingFilter === 'type'}
                  title="Show only the exercises with no Type saved"
                >
                  {missingType.length} with no Type
                </button>
              )}
              {missingGroup.length > 0 && (
                <button
                  type="button"
                  className={missingFilter === 'group' ? styles.gapBtnOn : styles.gapBtn}
                  onClick={() => toggleMissingFilter('group')}
                  aria-pressed={missingFilter === 'group'}
                  title="Show only the exercises with no Muscle Group saved"
                >
                  {missingGroup.length} with no Muscle Group
                </button>
              )}
              {missingFilter && (
                <button type="button" className={styles.gapClear} onClick={() => setMissingFilter('')}>
                  Show all again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.count}>
        {filtered.length} of {library.length} exercise{library.length === 1 ? '' : 's'}
        {missingFilter && (
          <> · showing only those with no {missingFilter === 'type' ? 'Type' : 'Muscle Group'}</>
        )}
      </div>

      {/* What the two text weights in the table actually mean — the difference
          between a value you set and one the app is filling in for you. */}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSaved}>Legs</span> saved on this exercise
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendGuess}>Legs</span> grey — guessed from the name, not saved
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSaved}>Auto (Stretching)</span> the Type column saying the same thing
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendRetired}>Bench press</span> dimmed row — retired
        </span>
      </div>

      <datalist id="exercise-known-groups">
        {KNOWN_GROUPS.map(g => <option key={g} value={g} />)}
      </datalist>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map(c => (
                <th key={c.key} className={styles[c.cls]}>
                  {c.sortable ? (
                    <button
                      type="button"
                      className={styles.sortHeaderBtn}
                      onClick={() => toggleSort(c.key)}
                      title={`Sort by ${c.label}`}
                    >
                      <span>{c.label}</span>
                      {sortIcon(c.key)}
                    </button>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </th>
              ))}
            </tr>
            <tr className={styles.colSearchRow}>
              {COLUMNS.map(c => (
                <th key={c.key}>
                  {c.searchable ? (
                    <input
                      className={styles.colSearchInput}
                      value={colSearch[c.key] || ''}
                      onChange={ev => setColSearch(prev => ({ ...prev, [c.key]: ev.target.value }))}
                      placeholder="filter…"
                      aria-label={`Filter ${c.label}`}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ e, originalIdx }) => (
              <tr key={originalIdx} className={e.retired ? styles.retiredRow : undefined}>
                <td className={styles.nameCell}>
                  <div className={styles.exName}>
                    <button
                      type="button"
                      className={e.top ? styles.topStarBtn : styles.topStarBtnDim}
                      onClick={() => updateRow(originalIdx, 'top', !e.top)}
                      title={e.top ? 'Top exercise (click to unmark)' : 'Mark as top'}
                    >★</button>
                    <input
                      className={`${styles.cellInput} ${styles.exNameInput}`}
                      value={nameDraft?.idx === originalIdx ? nameDraft.value : e.exercise}
                      onFocus={() => setNameDraft({ idx: originalIdx, value: e.exercise || '' })}
                      onChange={ev => setNameDraft({ idx: originalIdx, value: ev.target.value })}
                      onBlur={() => commitName(originalIdx)}
                      onKeyDown={ev => {
                        if (ev.key === 'Enter') { ev.preventDefault(); ev.currentTarget.blur(); }
                        // Abandon the edit — the ref makes blur skip the commit,
                        // so the row's existing name comes back.
                        else if (ev.key === 'Escape') { cancelNameEditRef.current = true; ev.currentTarget.blur(); }
                      }}
                      placeholder="Exercise name"
                    />
                  </div>
                  <input
                    className={`${styles.cellInput} ${styles.nicknameInput}`}
                    value={e.nickname || ''}
                    onChange={ev => updateRow(originalIdx, 'nickname', ev.target.value)}
                    placeholder="Nickname (optional)"
                  />
                  <label className={styles.retiredToggle}>
                    <input
                      type="checkbox"
                      checked={!!e.retired}
                      onChange={ev => updateRow(originalIdx, 'retired', ev.target.checked)}
                    />
                    Retired
                  </label>
                </td>
                <td className={styles.colDemo}>
                  <ExerciseDemoThumb name={e.exercise} onOpen={setDemoName} />
                </td>
                <td>
                  {/* Blank = inferred from the name (see effectiveExerciseType),
                      so the placeholder shows what the picker will actually use. */}
                  <select
                    className={styles.cellInput}
                    value={normalizeExerciseType(e.exerciseType)}
                    onChange={ev => updateRow(originalIdx, 'exerciseType', ev.target.value)}
                    title={
                      normalizeExerciseType(e.exerciseType)
                        ? undefined
                        : `Auto-detected: ${effectiveExerciseType(e, effectiveMuscleGroup(e))}`
                    }
                  >
                    <option value="">
                      {`Auto (${effectiveExerciseType(e, effectiveMuscleGroup(e))})`}
                    </option>
                    {EXERCISE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    list="exercise-known-groups"
                    className={styles.cellInput}
                    value={e.muscleGroup || ''}
                    placeholder={lookupMuscleGroup(e.exercise) || '—'}
                    onChange={ev => updateRow(originalIdx, 'muscleGroup', ev.target.value)}
                    title={!e.muscleGroup && lookupMuscleGroup(e.exercise) ? `Auto-detected: ${lookupMuscleGroup(e.exercise)}` : undefined}
                  />
                </td>
                <td className={styles.musclesCell}>
                  <input
                    className={styles.cellInput}
                    value={e.primaryMuscles || ''}
                    onChange={ev => updateRow(originalIdx, 'primaryMuscles', ev.target.value)}
                  />
                </td>
                <td className={styles.musclesCell}>
                  <input
                    className={styles.cellInput}
                    value={e.secondaryMuscles || ''}
                    onChange={ev => updateRow(originalIdx, 'secondaryMuscles', ev.target.value)}
                  />
                </td>
                <td className={styles.videosCell}>
                  <input
                    className={styles.cellInput}
                    value={(e.videos || []).join(', ')}
                    onChange={ev => {
                      const urls = ev.target.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                      updateRow(originalIdx, 'videos', urls);
                    }}
                    placeholder="URLs comma-separated"
                  />
                  {e.videos.length > 0 && (
                    <div className={styles.videoLinkRow}>
                      {e.videos.map((url, vi) => (
                        <a key={vi} href={url} target="_blank" rel="noopener noreferrer" className={styles.videoLink} title={url}>
                          {videoSourceLabel(url)}
                        </a>
                      ))}
                    </div>
                  )}
                </td>
                <td className={styles.altCell}>
                  <input
                    className={styles.cellInput}
                    value={e.alternative || ''}
                    onChange={ev => updateRow(originalIdx, 'alternative', ev.target.value)}
                  />
                </td>
                <td className={styles.colAddedAt} title={e.addedAt || ''}>
                  <span className={styles.addedAtText}>
                    {e.addedAt ? formatAddedDate(e.addedAt) : '—'}
                  </span>
                </td>
                <td className={styles.colActions}>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeRow(originalIdx)}
                    title="Remove this exercise"
                    aria-label="Remove exercise"
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className={styles.empty}>No exercises match your filters.</div>
        )}
      </div>

      {showImport && (
        <div className={styles.modalBackdrop} onClick={() => setShowImport(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Import Exercise Library</h2>
              <button className={styles.closeBtn} onClick={() => setShowImport(false)}>×</button>
            </div>
            <p className={styles.hint}>
              Paste a tab- or comma-separated list. Columns recognized:{' '}
              <code>Workout, Primary Muscles, Secondary Muscles, Group, This Week, Last Week, Alternative, Top, Insta, Insta 2…, Knickname</code>.
              Importing replaces the existing library.
            </p>
            <div className={styles.fileRow}>
              <label className={styles.fileBtn}>
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
                      try {
                        const parsed = parseExerciseLibrary(text);
                        if (parsed.length > 0) setImportPreview(parsed);
                      } catch (err) {
                        setImportError(err.message || 'Parse failed');
                      }
                    };
                    reader.onerror = () => setImportError('Could not read the file');
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className={styles.fileHint}>or paste below ↓</span>
            </div>
            <textarea
              className={styles.importTextarea}
              placeholder="Paste your TSV/CSV here…"
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportPreview(null); setImportError(''); }}
            />
            {importError && <div className={styles.errorBox}>{importError}</div>}
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={handleParseImport} disabled={!importText.trim()} style={{ flex: 1 }}>
                Parse & Preview
              </button>
              {importPreview && (
                <button className={styles.primaryBtn} onClick={handleConfirmImport} style={{ flex: 1 }}>
                  Import {importPreview.length} exercise{importPreview.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
            {importPreview && (
              <div className={styles.previewBox}>
                <div className={styles.previewSummary}>
                  Parsed <strong>{importPreview.length}</strong> exercises ·{' '}
                  {importPreview.filter(e => e.videos.length > 0).length} with video links ·{' '}
                  {importPreview.filter(e => e.retired).length} retired
                </div>
                <div className={styles.previewList}>
                  {importPreview.slice(0, 10).map((e, i) => (
                    <div key={i} className={styles.previewRow}>
                      <strong>{e.exercise}</strong>
                      {e.group && <span className={styles.groupBadge}>{e.group}</span>}
                      <span className={styles.dim}>{e.videos.length} video{e.videos.length === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                  {importPreview.length > 10 && <div className={styles.dim}>…and {importPreview.length - 10} more</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {demoName && (() => {
        const row = library.find(x => x.exercise === demoName) || {};
        return (
          <div className={styles.modalBackdrop} onClick={() => setDemoName(null)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
              <div className={styles.modalHeader}>
                <h2>{demoName} — How to do it</h2>
                <button className={styles.closeBtn} onClick={() => setDemoName(null)}>×</button>
              </div>
              <ExerciseDemo name={demoName} fallbackPrimary={row.primaryMuscles} fallbackSecondary={row.secondaryMuscles} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
