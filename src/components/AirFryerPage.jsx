import { useCallback, useEffect, useMemo, useState } from 'react';
import GUIDE, {
  AIR_FRYER_CATEGORIES, AIR_FRYER_RULES, airFryerKey, toCelsius,
} from '../data/airFryerGuide.js';
import { loadField, saveField } from '../utils/firestoreSync';
import { indexRecipesByGuide } from '../utils/airFryerRecipes';
import { loadIngredients, ingredientRowByName } from '../utils/ingredientsStore';
import { ingredientMatchScore } from '../utils/ingredientMatch';
import { defaultUnitWeight } from '../utils/unitWeights';
import { getIngredientTags, getTagInfo } from '../utils/ingredientTags';
import styles from './AirFryerPage.module.css';

// Your own rows live in the user doc under this field. Only YOUR entries are
// stored — the built-in table ships in the bundle, so the field stays tiny and
// the page still works with no network at all.
const FIELD = 'airFryerNotes';
const CACHE_KEY = 'sunday-air-fryer-notes';

// Which ingredient-database row each guide row is really about, as
// { [lowercased guide name]: 'db ingredient name' }.
//
// Kept in its OWN field rather than on the guide rows, because saving anything
// onto a built-in row is what turns it into an override — and a link isn't a
// disagreement with the built-in time, it's a fact about your pantry. Storing it
// here means linking "Salmon fillet" doesn't brand the row "edited" or offer to
// reset a time you never changed.
const LINKS_FIELD = 'airFryerLinks';
const LINKS_CACHE = 'sunday-air-fryer-links';

const BLANK = { name: '', cat: 'Vegetables', tempF: '', min: '', max: '', doneF: '', note: '' };

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function readLinksCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(LINKS_CACHE) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

/**
 * The facts a linked ingredient brings with it.
 *
 * Only what's worth knowing with food in your hand — how much a piece weighs,
 * how long it keeps, where it lives. The macros are a click away on the
 * ingredients page and would drown this out.
 */
function ingredientFacts(row) {
  if (!row) return [];
  const facts = [];
  const uw = defaultUnitWeight(row);
  if (uw?.grams > 0) facts.push(`${Math.round(uw.grams)} g per ${uw.unit}`);
  else if (Number(row.grams) > 0 && row.measurement) facts.push(`${row.grams} g per ${row.measurement}`);

  const min = Number(row.minShelf) || 0;
  const max = Number(row.maxShelf) || 0;
  if (min || max) {
    const span = min && max && min !== max ? `${min}–${max}` : String(max || min);
    facts.push(`keeps ${span} day${span === '1' ? '' : 's'}${row.storage ? ` in the ${String(row.storage).toLowerCase()}` : ''}`);
  } else if (row.storage) {
    facts.push(String(row.storage));
  }

  if (row.grocerySection) facts.push(String(row.grocerySection));
  if (row.store) facts.push(`buy at ${row.store}`);
  return facts;
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
  const [links, setLinks] = useState(readLinksCache);
  // The guide row currently being linked, and the search text for its picker.
  const [linking, setLinking] = useState(null);
  const [linkQuery, setLinkQuery] = useState('');

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

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadField(uid, LINKS_FIELD)
      .then(remote => {
        if (cancelled || !remote || typeof remote !== 'object' || Array.isArray(remote)) return;
        setLinks(remote);
        try { localStorage.setItem(LINKS_CACHE, JSON.stringify(remote)); } catch { /* quota */ }
      })
      .catch(() => { /* offline — the cached copy stands */ });
    return () => { cancelled = true; };
  }, [uid]);

  /** Point a guide row at a database ingredient, or pass null to unlink it. */
  const setLink = useCallback((key, ingredientName) => {
    setLinks(prev => {
      const next = { ...prev };
      if (ingredientName) next[key] = ingredientName;
      else delete next[key];
      try { localStorage.setItem(LINKS_CACHE, JSON.stringify(next)); } catch { /* quota */ }
      if (uid) {
        saveField(uid, LINKS_FIELD, next).catch(err => {
          console.error('[air fryer] link save failed', err);
        });
      }
      return next;
    });
    setLinking(null);
    setLinkQuery('');
  }, [uid]);

  // Every name in the ingredient database, for the link picker. Read once —
  // the DB is a localStorage blob shared across the app, not a live query.
  const dbNames = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const row of (loadIngredients() || [])) {
      const name = (row?.ingredient || '').trim();
      const k = name.toLowerCase();
      if (!name || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, []);

  // Picker results, ranked by the same scorer every other ingredient picker in
  // the app uses, so the ordering is one someone already has a feel for.
  const linkResults = useMemo(() => {
    const q = linkQuery.trim();
    if (!q) return dbNames.slice(0, 30);
    return dbNames
      .map(name => ({ name, score: ingredientMatchScore(name, q) }))
      .filter(r => r.score < 5)
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .slice(0, 30)
      .map(r => r.name);
  }, [dbNames, linkQuery]);

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
    () => indexRecipesByGuide(rows, recipes, weekIds, links),
    [rows, recipes, weekIds, links],
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
            {renderLink(key)}
            <button className={styles.editBtn} onClick={() => startEdit(row)}>
              {row.source === 'built-in' ? 'Change this time' : 'Edit'}
            </button>
          </div>
        )}
      </li>
    );
  };

  // The ingredient-database link for one row: what it points at, what that
  // brings with it, and the picker for changing it.
  const renderLink = (key) => {
    const linked = links[key];
    const dbRow = linked ? ingredientRowByName(linked) : null;
    const facts = ingredientFacts(dbRow);
    const tags = linked ? (getIngredientTags(linked) || []) : [];
    const picking = linking === key;

    return (
      <div className={styles.linkBlock}>
        {linked ? (
          <>
            <div className={styles.linkHead}>
              <span className={styles.linkLabel}>Ingredient</span>
              <span className={styles.linkName}>{linked}</span>
              <button className={styles.linkAction} onClick={() => { setLinking(picking ? null : key); setLinkQuery(''); }}>
                {picking ? 'Cancel' : 'Change'}
              </button>
              <button className={styles.linkAction} onClick={() => setLink(key, null)}>Unlink</button>
            </div>
            {/* A link to a name the database doesn't have is worth saying out
                loud — the row looks linked but inherits nothing. */}
            {!dbRow && <div className={styles.linkMissing}>Not in your ingredient database.</div>}
            {facts.length > 0 && <div className={styles.linkFacts}>{facts.join(' · ')}</div>}
            {tags.length > 0 && (
              <div className={styles.linkTags}>
                {tags.map(t => {
                  const info = getTagInfo(t);
                  return <span key={t} className={styles.linkTag}>{info?.label || t}</span>;
                })}
              </div>
            )}
          </>
        ) : (
          <button
            className={styles.linkAddBtn}
            onClick={() => { setLinking(picking ? null : key); setLinkQuery(''); }}
          >
            {picking ? 'Cancel' : '+ Link an ingredient'}
          </button>
        )}

        {picking && (
          <div className={styles.picker}>
            <input
              className={styles.pickerSearch}
              value={linkQuery}
              onChange={e => setLinkQuery(e.target.value)}
              placeholder="Search your ingredients…"
              type="search"
              autoComplete="off"
              autoFocus
            />
            {linkResults.length === 0 ? (
              <div className={styles.pickerEmpty}>
                {dbNames.length === 0
                  ? 'Your ingredient database hasn’t loaded on this device yet.'
                  : `Nothing matching “${linkQuery}”.`}
              </div>
            ) : (
              <ul className={styles.pickerList}>
                {linkResults.map(name => (
                  <li key={name}>
                    <button className={styles.pickerItem} onClick={() => setLink(key, name)}>{name}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
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
