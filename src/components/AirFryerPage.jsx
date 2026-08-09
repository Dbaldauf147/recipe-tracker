import { useCallback, useEffect, useMemo, useState } from 'react';
import GUIDE, {
  AIR_FRYER_CATEGORIES, AIR_FRYER_RULES, airFryerKey, toCelsius,
} from '../data/airFryerGuide.js';
import { loadField, saveField } from '../utils/firestoreSync';
import { indexRecipesByGuide, indexExtrasByGuide, rankIngredientsForGuide, bestIngredientForGuide } from '../utils/airFryerRecipes';
import { findTopSince, buildIngredientEatenMap } from '../utils/pantryAutoAdd';
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

// Guide rows you've hidden, as an array of lowercased names.
//
// HIDDEN, not deleted, for anything built in: the table ships in the bundle, so
// there is nothing to delete — a "delete" would silently come back on the next
// release. Your own rows are genuinely deleted from the editor. Kept in its own
// field for the same reason links are: hiding a row isn't a disagreement with
// its time, and shouldn't brand it "edited".
const HIDDEN_FIELD = 'airFryerHidden';
const HIDDEN_CACHE = 'sunday-air-fryer-hidden';

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

function readHiddenCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_CACHE) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
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

// Written by the Shopping List page; read here so both agree on what's on the
// list without this page owning any of it.
const EXTRAS_FIELD = 'shopExtras';
const EXTRAS_CACHE_KEY = 'sunday-shop-extras';
function readListCache(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readExtrasCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(EXTRAS_CACHE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
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
  const [hidden, setHidden] = useState(readHiddenCache);
  // Hidden rows are out of the list until you ask for them. Not persisted —
  // "show me what I hid" is a thing you do once to undo a mistake, not a mode
  // you want the page to still be in tomorrow morning.
  const [showHidden, setShowHidden] = useState(false);
  // The shopping list's manual side. Seeded from the same localStorage key the
  // Shopping List page writes, so a snack added a minute ago is already flagged
  // when this page paints; Firestore reconciles behind it like everything else.
  const [extras, setExtras] = useState(readExtrasCache);
  // The pantry lists the shopping page auto-adds this week's snack and fruit
  // from. Cached-first for the same reason as everything else here.
  const [pantrySnacks, setPantrySnacks] = useState(() => readListCache('sunday-pantry-snacks'));
  const [pantryFruit, setPantryFruit] = useState(() => readListCache('sunday-pantry-fruit'));

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

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadField(uid, HIDDEN_FIELD)
      .then(remote => {
        if (cancelled || !Array.isArray(remote)) return;
        setHidden(remote);
        try { localStorage.setItem(HIDDEN_CACHE, JSON.stringify(remote)); } catch { /* quota */ }
      })
      .catch(() => { /* offline — the cached copy stands */ });
    return () => { cancelled = true; };
  }, [uid]);

  // Shopping list extras (snacks, staples, anything hand-added). Read-only
  // here — this page flags what's on the list, it never edits it.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadField(uid, EXTRAS_FIELD)
      .then(remote => {
        if (cancelled || !Array.isArray(remote)) return;
        setExtras(remote);
      })
      .catch(() => { /* offline — the cached copy stands */ });
    loadField(uid, 'pantrySnacks')
      .then(remote => { if (!cancelled && Array.isArray(remote)) setPantrySnacks(remote); })
      .catch(() => { /* cached copy stands */ });
    loadField(uid, 'pantryFruit')
      .then(remote => { if (!cancelled && Array.isArray(remote)) setPantryFruit(remote); })
      .catch(() => { /* cached copy stands */ });
    return () => { cancelled = true; };
  }, [uid]);

  /** Hide a guide row, or bring it back. */
  const setRowHidden = useCallback((key, isHidden) => {
    setHidden(prev => {
      const next = isHidden
        ? (prev.includes(key) ? prev : [...prev, key])
        : prev.filter(k => k !== key);
      try { localStorage.setItem(HIDDEN_CACHE, JSON.stringify(next)); } catch { /* quota */ }
      if (uid) {
        saveField(uid, HIDDEN_FIELD, next).catch(err => {
          console.error('[air fryer] hidden save failed', err);
        });
      }
      return next;
    });
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

  // The row whose picker is open, so the picker can predict from its name.
  const linkingRow = useMemo(
    () => (linking ? rows.find(r => airFryerKey(r.name) === linking) : null),
    [linking, rows],
  );

  // Picker results, in two groups.
  //
  // Typing searches your whole database by the same scorer every other
  // ingredient picker uses, so the ordering is one you already have a feel for.
  // With the box EMPTY it now leads with what this row probably is, instead of
  // the first 30 names alphabetically — the old behaviour meant reading
  // "Chicken breast (boneless)" and typing "chick" to tell the app something it
  // could already work out. The rest of the database still follows, so a
  // suggestion you disagree with costs nothing.
  const linkResults = useMemo(() => {
    const q = linkQuery.trim();
    if (q) {
      const hits = dbNames
        .map(name => ({ name, score: ingredientMatchScore(name, q) }))
        .filter(r => r.score < 5)
        .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .slice(0, 30)
        .map(r => r.name);
      return { suggested: [], rest: hits };
    }
    const suggested = linkingRow
      ? rankIngredientsForGuide(linkingRow.name, dbNames).slice(0, 6).map(r => r.name)
      : [];
    const seen = new Set(suggested.map(n => n.toLowerCase()));
    return { suggested, rest: dbNames.filter(n => !seen.has(n.toLowerCase())).slice(0, 30) };
  }, [dbNames, linkQuery, linkingRow]);

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
  // Items on the list that belong to no recipe — snacks, staples, anything
  // hand-added. Without these the group claimed to be "this week's shopping
  // list" while only ever looking at recipes.
  //
  // The list you actually shop from isn't just `shopExtras`: the Shopping List
  // page also auto-adds ONE snack and ONE fruit each week — whichever has gone
  // longest un-eaten — and those are computed at render, never persisted. They
  // are, in practice, exactly the snacks "added for this week", so leaving them
  // out would flag the staples and miss the thing that prompted this.
  // findTopSince is imported rather than reimplemented so the two pages can't
  // disagree about which snack that is.
  const getRecipeById = useCallback(
    (id) => (recipes || []).find(r => r?.id === id) || null,
    [recipes],
  );
  const listItems = useMemo(() => {
    const list = [...(extras || [])];
    const eatenMap = buildIngredientEatenMap(getRecipeById);
    const has = (ing) => list.some(e => airFryerKey(e?.ingredient || '') === airFryerKey(ing || ''));
    const topSnack = findTopSince(pantrySnacks, eatenMap);
    const topFruit = findTopSince(pantryFruit, eatenMap);
    if (topSnack?.ingredient && !has(topSnack.ingredient)) list.push({ ...topSnack, source: 'auto-snack' });
    if (topFruit?.ingredient && !has(topFruit.ingredient)) list.push({ ...topFruit, source: 'auto-fruit' });
    return list;
  }, [extras, pantrySnacks, pantryFruit, getRecipeById]);
  const extrasIndex = useMemo(() => indexExtrasByGuide(rows, listItems, links), [rows, listItems, links]);
  const extrasFor = useCallback(
    (row) => extrasIndex[airFryerKey(row.name)] || [],
    [extrasIndex],
  );
  const onListFor = useCallback(
    (row) => weekCountFor(row) > 0 || extrasFor(row).length > 0,
    [weekCountFor, extrasFor],
  );

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  // Search hits either NAME. A mapped row shows yours, so searching the guide's
  // wording has to keep finding it — and now that your name is the one on
  // screen, searching that has to find it too.
  const rowMatchesQuery = useCallback((r, q) => {
    if (!q) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    if ((r.note || '').toLowerCase().includes(q)) return true;
    return (links[airFryerKey(r.name)] || '').toLowerCase().includes(q);
  }, [links]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(r => showHidden || !hiddenSet.has(airFryerKey(r.name)))
      .filter(r => (!cat || r.cat === cat) && rowMatchesQuery(r, q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [rows, query, cat, hiddenSet, showHidden, rowMatchesQuery]);

  // Counted against the FULL row set, not the filtered one, so the "N hidden"
  // chip doesn't change every time you type in the search box.
  const hiddenCount = useMemo(
    () => rows.filter(r => hiddenSet.has(airFryerKey(r.name))).length,
    [rows, hiddenSet],
  );

  // Anything whose ingredient is on this week's plan floats to the top — that's
  // the food actually in the house. Both halves keep the alphabetical order
  // `visible` already put them in.
  const weekRows = useMemo(() => visible.filter(onListFor), [visible, onListFor]);
  const restRows = useMemo(() => visible.filter(r => !onListFor(r)), [visible, onListFor]);

  // Categories that survive the current search, so tapping one never lands you
  // on an empty list.
  const liveCats = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = new Set(rows.filter(r => rowMatchesQuery(r, q)).map(r => r.cat));
    return AIR_FRYER_CATEGORIES.filter(c => hit.has(c));
  }, [rows, query, rowMatchesQuery]);

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

  /**
   * The remove control that sits on the row itself.
   *
   * Your own rows delete for real. A built-in can only be hidden — it ships in
   * the bundle, so a delete would quietly come back on the next release. Only
   * the real delete asks first: hiding is one tap to undo, deleting isn't.
   */
  const killRow = useCallback((row) => {
    const key = airFryerKey(row.name);
    if (row.source === 'mine') {
      if (!window.confirm(`Delete "${row.name}"?`)) return;
      persist(mine.filter(r => airFryerKey(r.name) !== key));
      return;
    }
    setRowHidden(key, !hiddenSet.has(key));
  }, [mine, persist, setRowHidden, hiddenSet]);

  // The column headings. Rendered above each list so the row really reads as a
  // table — without them the mapping column is just text floating mid-row.
  const tableHead = (
    <div className={styles.tableHead}>
      <span className={styles.headName}>Ingredient</span>
      <span className={styles.headMap}>Air fryer name</span>
      <span className={styles.headNums}>Temp · time</span>
      <span className={styles.headKill} aria-hidden="true" />
    </div>
  );

  // One row of the guide. Shared by the two groups below so the "this week"
  // list and the rest can't drift into looking like different things.
  const renderRow = (row) => {
    const key = airFryerKey(row.name);
    const open = openId === key;
    const found = recipeIndex[key] || { recipes: [], weekRecipes: [] };
    const onList = extrasFor(row);
    const isHidden = hiddenSet.has(key);
    const mapped = links[key];
    const ownRow = row.source === 'mine';
    return (
      <li key={key} className={`${styles.row} ${isHidden ? styles.rowHidden : ''}`}>
        <div className={styles.rowTop}>
        <button
          className={styles.rowMain}
          onClick={() => setOpenId(open ? null : key)}
          aria-expanded={open}
        >
          <span className={styles.rowName}>
            {/* Your name for the thing, once you've said what it is. The guide
                calls it "Chicken breast (boneless)"; if your pantry calls it
                "Chicken cutlets" then that's what this list should say, because
                that's the name you'll be looking for. The guide's own wording
                doesn't disappear — it moves to the column on the right. */}
            {mapped || row.name}
            {row.source === 'mine' && <span className={styles.tag}>yours</span>}
            {row.source === 'edited' && <span className={styles.tag}>edited</span>}
            {isHidden && <span className={styles.tagHidden}>hidden</span>}
            {/* A count, not the names: the row has to stay readable at arm's
                length. The names are one tap away, in the detail. */}
            {found.recipes.length > 0 && (
              <span className={found.weekRecipes.length > 0 ? styles.recipeTagWeek : styles.recipeTag}>
                {found.recipes.length} recipe{found.recipes.length === 1 ? '' : 's'}
              </span>
            )}
            {/* Why a row with no recipe behind it is in the week's group. A
                snack added straight to the list has no recipe to count, so
                without this it would sit at the top looking unexplained. */}
            {onList.length > 0 && (
              <span
                className={styles.recipeTagWeek}
                title={`On your shopping list: ${onList.join(', ')}`}
              >
                on your list
              </span>
            )}
          </span>
          {/* The two names, one per column. Once a row is mapped the headline
              is YOURS and this column keeps the guide's own wording, so you can
              still tell which row of the printed guide you're looking at and
              nothing is lost by the rename. Unmapped, it's the invitation to
              say what the thing is — a gap you can see at a glance, which is
              the whole reason this moved out of the row detail. */}
          <span
            className={mapped ? styles.rowMap : styles.rowMapEmpty}
            title={mapped ? `The air fryer guide calls this “${row.name}”` : 'Not linked to one of your ingredients — open the row to link one'}
          >
            {mapped ? row.name : 'Link…'}
          </span>
          {/* Temp and time are the answer — big, on one line, readable
              at arm's length with your hands full. */}
          <span className={styles.rowNums}>
            <span className={styles.temp}>{row.tempF}°F</span>
            <span className={styles.time}>{formatTime(row)}</span>
          </span>
        </button>
        {/* Its own column, outside the row button — removing something you can
            see shouldn't cost you a tap into the detail first. (It also can't
            live inside that button: a button inside a button is invalid, and
            the click would toggle the row open on its way through.) */}
        <button
          className={styles.rowKill}
          onClick={() => killRow(row)}
          title={ownRow ? `Delete ${row.name}` : isHidden ? `Unhide ${row.name}` : `Hide ${row.name}`}
          aria-label={ownRow ? `Delete ${row.name}` : isHidden ? `Unhide ${row.name}` : `Hide ${row.name}`}
        >
          {isHidden ? '↩' : '✕'}
        </button>
        </div>
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
            {renderLink(key, row)}
            {/* No hide button here: the ✕ in the row's own column does that
                job, and two controls for one action is how they drift apart. */}
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
  const renderLink = (key, row) => {
    const linked = links[key];
    const dbRow = linked ? ingredientRowByName(linked) : null;
    const facts = ingredientFacts(dbRow);
    const tags = linked ? (getIngredientTags(linked) || []) : [];
    const picking = linking === key;
    // Only computed for an unlinked row — once it's linked there's nothing to
    // suggest, and this walks the whole database.
    const suggestion = linked ? '' : bestIngredientForGuide(row?.name, dbNames);

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
          <>
            {/* The obvious answer as one tap, when there IS an obvious one —
                exact, or one name starting the other. Named on the button
                rather than hidden behind "accept", so you're agreeing to a
                specific ingredient and not to the machine's confidence. */}
            {suggestion && (
              <button className={styles.linkSuggestBtn} onClick={() => setLink(key, suggestion)}>
                Link to “{suggestion}”
              </button>
            )}
            <button
              className={styles.linkAddBtn}
              onClick={() => { setLinking(picking ? null : key); setLinkQuery(''); }}
            >
              {picking ? 'Cancel' : suggestion ? 'Pick a different one' : '+ Link an ingredient'}
            </button>
          </>
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
            {linkResults.suggested.length === 0 && linkResults.rest.length === 0 ? (
              <div className={styles.pickerEmpty}>
                {dbNames.length === 0
                  ? 'Your ingredient database hasn’t loaded on this device yet.'
                  : `Nothing matching “${linkQuery}”.`}
              </div>
            ) : (
              <>
                {linkResults.suggested.length > 0 && (
                  <>
                    <div className={styles.pickerGroup}>Suggested for this row</div>
                    <ul className={styles.pickerList}>
                      {linkResults.suggested.map(name => (
                        <li key={`s-${name}`}>
                          <button className={styles.pickerItem} onClick={() => setLink(key, name)}>{name}</button>
                        </li>
                      ))}
                    </ul>
                    <div className={styles.pickerGroup}>All your ingredients</div>
                  </>
                )}
                <ul className={styles.pickerList}>
                  {linkResults.rest.map(name => (
                    <li key={name}>
                      <button className={styles.pickerItem} onClick={() => setLink(key, name)}>{name}</button>
                    </li>
                  ))}
                </ul>
              </>
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
          {query.trim() ? (
            <>
              Nothing for “{query}”.
              <button className={styles.linkBtn} onClick={() => { startEdit({ ...BLANK, name: query.trim() }); }}>
                Add it
              </button>
            </>
          ) : (
            // Reachable now that rows can be hidden — an empty list with a
            // "Nothing for “”" message would just look broken.
            'Nothing here. Anything you hid can be brought back below.'
          )}
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
              {tableHead}
              <ul className={styles.list}>{weekRows.map(renderRow)}</ul>
              {restRows.length > 0 && <div className={styles.groupHead}>Everything else</div>}
            </>
          )}
          {restRows.length > 0 && (
            <>
              {weekRows.length === 0 && tableHead}
              <ul className={styles.list}>{restRows.map(renderRow)}</ul>
            </>
          )}
        </>
      )}

      {/* Hidden rows are recoverable, and visibly so. A hide you can't find
          your way back from is a delete with extra steps. */}
      {hiddenCount > 0 && (
        <button className={styles.hiddenChip} onClick={() => setShowHidden(v => !v)}>
          {showHidden
            ? `Hide the ${hiddenCount} hidden again`
            : `${hiddenCount} hidden · show`}
        </button>
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
