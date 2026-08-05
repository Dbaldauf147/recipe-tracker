import { useCallback, useEffect, useMemo, useState } from 'react';
import GUIDE, {
  AIR_FRYER_CATEGORIES, AIR_FRYER_RULES, airFryerKey, toCelsius,
} from '../data/airFryerGuide.js';
import { loadField, saveField } from '../utils/firestoreSync';
import { indexRecipesByGuide } from '../utils/airFryerRecipes';
import styles from './AirFryerPage.module.css';

// Your own rows live in the user doc under this field. Only YOUR entries are
// stored — the built-in table ships in the bundle, so the field stays tiny and
// the page still works with no network at all.
const FIELD = 'airFryerNotes';
const CACHE_KEY = 'sunday-air-fryer-notes';

const BLANK = { name: '', cat: 'Vegetables', tempF: '', min: '', max: '', doneF: '', note: '' };

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

/** "18–22 min", or "18 min" when there's no range worth showing. */
function formatTime(row) {
  const min = Number(row.min) || 0;
  const max = Number(row.max) || 0;
  if (!min && !max) return '—';
  if (!max || max === min) return `${min} min`;
  return `${min}–${max} min`;
}

export function AirFryerPage({ onClose, user, recipes = [], weeklyRecipeIds = [] }) {
  const uid = user?.uid;
  // Seeded from localStorage so the page paints instantly on a phone — the
  // whole point of a homescreen shortcut is that it's up before you've put the
  // food down. Firestore reconciles a moment later.
  const [mine, setMine] = useState(readCache);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadField(uid, FIELD)
      .then(remote => {
        if (cancelled || !Array.isArray(remote)) return;
        setMine(remote);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(remote)); } catch { /* quota */ }
      })
      .catch(() => { /* offline — the cached copy stands */ });
    return () => { cancelled = true; };
  }, [uid]);

  const persist = useCallback((next) => {
    setMine(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* quota */ }
    if (uid) {
      saveField(uid, FIELD, next).catch(err => {
        console.error('[air fryer] save failed', err);
        alert('Couldn\'t save that to the cloud — it\'s on this device, but check your connection.');
      });
    }
  }, [uid]);

  // One list: the built-in table with your edits layered on top. An entry whose
  // name matches a built-in REPLACES it rather than sitting next to it — a
  // duplicate row with a different time is worse than no row at all, because
  // now you have to remember which one you trusted.
  const rows = useMemo(() => {
    const byKey = new Map();
    for (const row of GUIDE) byKey.set(airFryerKey(row.name), { ...row, source: 'built-in' });
    for (const row of mine) {
      const key = airFryerKey(row.name);
      byKey.set(key, {
        ...row,
        source: byKey.has(key) ? 'edited' : 'mine',
        cat: row.cat || byKey.get(key)?.cat || 'Vegetables',
      });
    }
    return Array.from(byKey.values());
  }, [mine]);

  const weekIds = useMemo(() => new Set(weeklyRecipeIds || []), [weeklyRecipeIds]);

  // Which of your recipes each row turns up in, and which of those are on this
  // week's plan. Keyed by the row's lowercased name — the same key the list
  // renders with, so a lookup is direct.
  const recipeIndex = useMemo(
    () => indexRecipesByGuide(rows, recipes, weekIds),
    [rows, recipes, weekIds],
  );
  const weekCountFor = useCallback(
    (row) => recipeIndex[airFryerKey(row.name)]?.weekRecipes.length || 0,
    [recipeIndex],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(r => (!cat || r.cat === cat) && (!q || r.name.toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [rows, query, cat]);

  // Anything whose ingredient is on this week's plan floats to the top — that's
  // the food actually in the house. Both halves keep the alphabetical order
  // `visible` already put them in.
  const weekRows = useMemo(() => visible.filter(r => weekCountFor(r) > 0), [visible, weekCountFor]);
  const restRows = useMemo(() => visible.filter(r => weekCountFor(r) === 0), [visible, weekCountFor]);

  // Categories that survive the current search, so tapping one never lands you
  // on an empty list.
  const liveCats = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = new Set(
      rows.filter(r => !q || r.name.toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q))
        .map(r => r.cat),
    );
    return AIR_FRYER_CATEGORIES.filter(c => hit.has(c));
  }, [rows, query]);

  const startEdit = useCallback((row) => {
    setEditing(row
      ? { ...BLANK, ...row, tempF: row.tempF ?? '', min: row.min ?? '', max: row.max ?? '', doneF: row.doneF ?? '', original: row.name }
      : { ...BLANK });
  }, []);

  const saveEdit = useCallback(() => {
    const name = editing.name.trim();
    if (!name) { alert('Give it a name.'); return; }
    const entry = {
      name,
      cat: editing.cat,
      tempF: Number(editing.tempF) || 0,
      min: Number(editing.min) || 0,
      max: Number(editing.max) || 0,
      note: editing.note.trim(),
    };
    // Absent, not zero: a 0 here would render as a real "0°F" reading.
    if (Number(editing.doneF)) entry.doneF = Number(editing.doneF);
    const key = airFryerKey(name);
    const oldKey = airFryerKey(editing.original || name);
    const next = mine.filter(r => airFryerKey(r.name) !== key && airFryerKey(r.name) !== oldKey);
    persist([...next, entry]);
    setEditing(null);
    setOpenId(key);
  }, [editing, mine, persist]);

  // Removing an edited built-in restores the original rather than deleting the
  // row — you're undoing your change, not throwing the reference away.
  const removeMine = useCallback((row) => {
    const isEdit = row.source === 'edited';
    const msg = isEdit
      ? `Reset "${row.name}" back to the built-in time?`
      : `Delete "${row.name}"?`;
    if (!window.confirm(msg)) return;
    persist(mine.filter(r => airFryerKey(r.name) !== airFryerKey(row.name)));
    setEditing(null);
  }, [mine, persist]);

  // One row of the guide. Shared by the two groups below so the "this week"
  // list and the rest can't drift into looking like different things.
  const renderRow = (row) => {
    const key = airFryerKey(row.name);
    const open = openId === key;
    const found = recipeIndex[key] || { recipes: [], weekRecipes: [] };
    return (
      <li key={key} className={styles.row}>
        <button
          className={styles.rowMain}
          onClick={() => setOpenId(open ? null : key)}
          aria-expanded={open}
        >
          <span className={styles.rowName}>
            {row.name}
            {row.source === 'mine' && <span className={styles.tag}>yours</span>}
            {row.source === 'edited' && <span className={styles.tag}>edited</span>}
            {/* A count, not the names: the row has to stay readable at arm's
                length. The names are one tap away, in the detail. */}
            {found.recipes.length > 0 && (
              <span className={found.weekRecipes.length > 0 ? styles.recipeTagWeek : styles.recipeTag}>
                {found.recipes.length} recipe{found.recipes.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
          {/* Temp and time are the answer — big, on one line, readable
              at arm's length with your hands full. */}
          <span className={styles.rowNums}>
            <span className={styles.temp}>{row.tempF}°F</span>
            <span className={styles.time}>{formatTime(row)}</span>
          </span>
        </button>
        {open && (
          <div className={styles.detail}>
            <div className={styles.detailMeta}>
              <span>{toCelsius(row.tempF)}°C</span>
              {!!row.doneF && <span className={styles.doneTemp}>Done at {row.doneF}°F internal</span>}
              <span className={styles.detailCat}>{row.cat}</span>
            </div>
            {!!row.note && <p className={styles.note}>{row.note}</p>}
            {found.recipes.length > 0 && (
              <div className={styles.recipeMap}>
                <div className={styles.recipeMapHead}>Your recipes using this</div>
                <ul className={styles.recipeMapList}>
                  {found.recipes.map(r => (
                    <li key={r.id}>
                      {r.title}
                      {weekIds.has(r.id) && <span className={styles.weekFlag}>this week</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button className={styles.editBtn} onClick={() => startEdit(row)}>
              {row.source === 'built-in' ? 'Change this time' : 'Edit'}
            </button>
          </div>
        )}
      </li>
    );
  };

  if (editing) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => setEditing(null)}>← Cancel</button>
          <h2 className={styles.title}>{editing.original ? 'Edit' : 'Add your own'}</h2>
          <button className={styles.saveBtn} onClick={saveEdit}>Save</button>
        </div>

        <label className={styles.label}>Ingredient</label>
        <input
          className={styles.input}
          value={editing.name}
          onChange={e => setEditing({ ...editing, name: e.target.value })}
          placeholder="Halloumi"
          autoFocus={!editing.original}
        />

        <label className={styles.label}>Category</label>
        <select
          className={styles.input}
          value={editing.cat}
          onChange={e => setEditing({ ...editing, cat: e.target.value })}
        >
          {AIR_FRYER_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className={styles.editGrid}>
          <div>
            <label className={styles.label}>Temp °F</label>
            <input className={styles.input} type="number" inputMode="numeric" value={editing.tempF}
              onChange={e => setEditing({ ...editing, tempF: e.target.value })} placeholder="400" />
          </div>
          <div>
            <label className={styles.label}>Min</label>
            <input className={styles.input} type="number" inputMode="numeric" value={editing.min}
              onChange={e => setEditing({ ...editing, min: e.target.value })} placeholder="10" />
          </div>
          <div>
            <label className={styles.label}>Max</label>
            <input className={styles.input} type="number" inputMode="numeric" value={editing.max}
              onChange={e => setEditing({ ...editing, max: e.target.value })} placeholder="12" />
          </div>
          <div>
            <label className={styles.label}>Done °F</label>
            <input className={styles.input} type="number" inputMode="numeric" value={editing.doneF}
              onChange={e => setEditing({ ...editing, doneF: e.target.value })} placeholder="—" />
          </div>
        </div>

        <label className={styles.label}>Note</label>
        <textarea
          className={styles.textarea}
          value={editing.note}
          onChange={e => setEditing({ ...editing, note: e.target.value })}
          placeholder="Shake halfway. Spray the breading."
          rows={3}
        />

        {editing.original && (
          <button
            className={styles.dangerBtn}
            onClick={() => removeMine(rows.find(r => airFryerKey(r.name) === airFryerKey(editing.original)) || { name: editing.original, source: 'mine' })}
          >
            {rows.find(r => airFryerKey(r.name) === airFryerKey(editing.original))?.source === 'edited'
              ? 'Reset to the built-in time'
              : 'Delete this one'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>← Back</button>
        <h2 className={styles.title}>Air fryer</h2>
        <button className={styles.addBtn} onClick={() => startEdit(null)}>+ Add</button>
      </div>

      <input
        className={styles.search}
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search — salmon, wings, frozen fries…"
        type="search"
        autoComplete="off"
      />

      <div className={styles.chips}>
        <button
          className={`${styles.chip} ${!cat ? styles.chipOn : ''}`}
          onClick={() => setCat('')}
        >All</button>
        {liveCats.map(c => (
          <button
            key={c}
            className={`${styles.chip} ${cat === c ? styles.chipOn : ''}`}
            onClick={() => setCat(cat === c ? '' : c)}
          >{c}</button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          Nothing for “{query}”.
          <button className={styles.linkBtn} onClick={() => { startEdit({ ...BLANK, name: query.trim() }); }}>
            Add it
          </button>
        </div>
      ) : (
        <>
          {/* The week's food first, under its own heading. Without the heading
              the reordering just looks like a broken alphabetical sort. */}
          {weekRows.length > 0 && (
            <>
              <div className={styles.groupHead}>
                In this week’s shopping list
                <span className={styles.groupCount}>{weekRows.length}</span>
              </div>
              <ul className={styles.list}>{weekRows.map(renderRow)}</ul>
              {restRows.length > 0 && <div className={styles.groupHead}>Everything else</div>}
            </>
          )}
          {restRows.length > 0 && <ul className={styles.list}>{restRows.map(renderRow)}</ul>}
        </>
      )}

      {/* The rules that apply to everything. Collapsed by default: you know them
          after the first week, and they'd otherwise push the search box down
          the screen every single time you open this. */}
      <button className={styles.rulesToggle} onClick={() => setShowRules(v => !v)}>
        {showRules ? 'Hide the basics' : 'The basics'}
      </button>
      {showRules && (
        <ul className={styles.rules}>
          {AIR_FRYER_RULES.map(r => <li key={r}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}
