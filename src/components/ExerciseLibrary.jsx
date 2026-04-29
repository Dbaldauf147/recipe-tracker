import { useState, useMemo } from 'react';
import styles from './ExerciseLibrary.module.css';

const HEADER_ALIASES = {
  exercise: ['workout', 'exercise', 'exercises', 'name'],
  primaryMuscles: ['primary muscles', 'primary'],
  secondaryMuscles: ['secondary muscles', 'secondary'],
  group: ['group'],
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

function lookupMuscleGroup(exerciseName) {
  return MUSCLE_GROUP_BY_EXERCISE[String(exerciseName || '').trim().toLowerCase()] || '';
}

function videoSourceLabel(url) {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'IG';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YT';
  if (u.includes('tiktok.com')) return 'TT';
  return '↗';
}

export function ExerciseLibrary({ library, onChange }) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [topOnly, setTopOnly] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');

  const groups = useMemo(() => {
    const s = new Set();
    for (const e of library) if (e.group) s.add(e.group);
    return Array.from(s).sort();
  }, [library]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.filter(e => {
      if (!showRetired && e.retired) return false;
      if (topOnly && !e.top) return false;
      if (groupFilter && e.group !== groupFilter) return false;
      if (!q) return true;
      return (
        e.exercise.toLowerCase().includes(q) ||
        e.nickname.toLowerCase().includes(q) ||
        e.primaryMuscles.toLowerCase().includes(q) ||
        e.secondaryMuscles.toLowerCase().includes(q) ||
        e.alternative.toLowerCase().includes(q)
      );
    });
  }, [library, search, groupFilter, showRetired, topOnly]);

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
          <p>No exercises in your library yet. Import a list to get started.</p>
          <button className={styles.primaryBtn} onClick={() => setShowImport(true)}>Import Exercises</button>
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
          <option value="">All groups</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={topOnly} onChange={e => setTopOnly(e.target.checked)} />
          Top only
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />
          Show retired
        </label>
        <button className={styles.secondaryBtn} onClick={() => setShowImport(true)}>Re-import</button>
      </div>

      <div className={styles.count}>
        {filtered.length} of {library.length} exercise{library.length === 1 ? '' : 's'}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colName}>Exercise</th>
              <th className={styles.colGroup}>Group</th>
              <th className={styles.colMuscleGroup}>Muscle Group</th>
              <th className={styles.colMuscles}>Primary</th>
              <th className={styles.colMuscles}>Secondary</th>
              <th className={styles.colVideos}>Videos</th>
              <th className={styles.colAlt}>Alternative</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={`${e.exercise}-${i}`} className={e.retired ? styles.retiredRow : undefined}>
                <td className={styles.nameCell}>
                  <div className={styles.exName}>
                    {e.top && <span className={styles.topStar} title="Top exercise">★</span>}
                    {e.exercise}
                  </div>
                  {e.nickname && <div className={styles.nickname}>{e.nickname}</div>}
                  {e.retired && <div className={styles.retiredTag}>Retired</div>}
                </td>
                <td>{e.group && <span className={styles.groupBadge}>{e.group}</span>}</td>
                <td>
                  {(() => {
                    const mg = lookupMuscleGroup(e.exercise);
                    return mg ? <span className={styles.groupBadge}>{mg}</span> : <span className={styles.dim}>—</span>;
                  })()}
                </td>
                <td className={styles.musclesCell}>{e.primaryMuscles}</td>
                <td className={styles.musclesCell}>{e.secondaryMuscles}</td>
                <td className={styles.videosCell}>
                  {e.videos.length === 0
                    ? <span className={styles.dim}>—</span>
                    : e.videos.map((url, vi) => (
                      <a key={vi} href={url} target="_blank" rel="noopener noreferrer" className={styles.videoLink} title={url}>
                        {videoSourceLabel(url)}
                      </a>
                    ))}
                </td>
                <td className={styles.altCell}>{e.alternative || <span className={styles.dim}>—</span>}</td>
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
    </div>
  );
}
