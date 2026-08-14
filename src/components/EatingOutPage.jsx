import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db } from '../firebase';
import { findDuplicateSpots, duplicateReason } from '../utils/duplicateSpots';
import { saveOwnerRestaurants, saveOwnerEatingOutLists, saveField, subscribeRestaurants } from '../utils/firestoreSync';
import {
  splitTsv,
  detectHasHeader,
  autoDetectMapping,
  applyMapping,
  partitionDuplicates,
  ratingLabelToStars,
  IMPORT_FIELDS,
} from '../utils/restaurantImport';
import { downloadRestaurantsCsv } from '../utils/restaurantExport';
import { saveSpotForOwner, saveEatingOutOrder, subscribeSpotComments, addSpotComment, deleteSpotComment, subscribeSpotRatings, subscribeEatingOutRatings, setEatingOutRating, loadSpotImage, saveSpotImage, deleteSpotImage } from '../utils/firestoreSync';
// Canvas resize helper shared with the exercise-photo uploader — same ≤800px
// JPEG budget, so a spot photo can't push its doc near Firestore's 1 MB cap.
import { compressImage } from '../utils/exerciseImages';
import { EatingOutFriendsPanel } from './EatingOutFriendsPanel';
import styles from './EatingOutPage.module.css';

const VISITED_COLOR = '#10b981';
const WANT_COLOR = '#f59e0b';
const JOANNE_COLOR = '#ec4899';
// Default starting view for the map — Williamsburg, Brooklyn at a
// neighborhood-level zoom. Used regardless of geocoded points so the
// view feels personal instead of auto-fitting to outliers.
const DEFAULT_MAP_CENTER = [40.7081, -73.9571];
const DEFAULT_MAP_ZOOM = 13;

// Coerce lat/lng to a finite number. Older records (CSV imports, manual
// Firestore edits) sometimes stored coordinates as strings — accept both
// so the map and the geocode-candidate count agree on "has coords".
function coerceCoord(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null || v === '') return NaN;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}
function hasValidCoords(r) {
  return Number.isFinite(coerceCoord(r?.lat)) && Number.isFinite(coerceCoord(r?.lng));
}

function makeMarkerIcon(color) {
  return L.divIcon({
    className: 'restaurant-marker',
    html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

const visitedIcon = makeMarkerIcon(VISITED_COLOR);
const wantIcon = makeMarkerIcon(WANT_COLOR);
const joanneIcon = makeMarkerIcon(JOANNE_COLOR);

// Marker color priority: Joanne overrides visited/want-to-try when set.
function markerIconFor(r) {
  if (r.takenJoanne) return joanneIcon;
  return r.status === 'visited' ? visitedIcon : wantIcon;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'want-to-try', label: 'Want to try' },
  { key: 'visited', label: 'Visited' },
];

// Higher-level buckets a spot can belong to. A spot can be in SEVERAL (a brewpub
// is Lunch/Dinner and Drinking), stored as `buckets: string[]`. This replaces the
// old single-valued `mealType`; see bucketsOf for the migration.
//
// The list is USER-EDITABLE (stored on users/{uid}.eatingOutBuckets, shared with
// mobile). DEFAULT_BUCKETS is the seed used until the user has saved their own.
const DEFAULT_BUCKETS = [
  { key: 'breakfast', label: 'Breakfast', icon: '🍳' },
  { key: 'lunch-dinner', label: 'Lunch / Dinner', icon: '🍽️' },
  { key: 'drinking', label: 'Drinking', icon: '🍸' },
  { key: 'coffee', label: 'Coffee', icon: '☕' },
  { key: 'going-out', label: 'Going Out', icon: '🎉' },
];
// Module-level mirror of the active list, so the plain helpers below stay
// call-site-compatible. The page updates it via applyBucketConfig whenever the
// config loads or is edited — always from a snapshot/event callback (which is
// then followed by a state update to re-render), never during render itself.
let BUCKETS = DEFAULT_BUCKETS.slice();
let BUCKET_KEYS = new Set(BUCKETS.map(b => b.key));
const bucketLabel = (key) => BUCKETS.find(b => b.key === key)?.label || '';

// Keep only well-formed {key,label,icon}; drop blanks and duplicate keys.
// `ratingCategories` is optional and only carried when it has usable rows —
// an absent one means "use the built-in set for this bucket".
function sanitizeBucketConfig(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const key = typeof b.key === 'string' ? b.key.trim() : '';
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    const bucket = { key, label, icon: (typeof b.icon === 'string' && b.icon.trim()) ? b.icon.trim() : '🍴' };
    const cats = sanitizeRatingCategories(b.ratingCategories);
    if (cats.length) bucket.ratingCategories = cats;
    out.push(bucket);
  }
  return out;
}
// The effective list: a saved config, else the defaults.
function effectiveBucketConfig(list) {
  const clean = sanitizeBucketConfig(list);
  return clean.length ? clean : DEFAULT_BUCKETS.slice();
}
function applyBucketConfig(list) {
  BUCKETS = effectiveBucketConfig(list);
  BUCKET_KEYS = new Set(BUCKETS.map(b => b.key));
}
// Slugify a label into a stable, unique key. Frozen once assigned so later
// renames never orphan the spots already tagged with it.
function makeBucketKey(label, used) {
  let base = (label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) base = 'bucket';
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}-${n++}`;
  used.add(key);
  return key;
}

// A spot's buckets, migrating from the legacy single `mealType` when the array
// isn't there yet. The old 'other'/'all' values have no bucket equivalent, so
// those spots read as unsorted (empty) — findable via the Unsorted filter and
// reassignable in bulk.
function bucketsOf(r) {
  if (Array.isArray(r.buckets)) return r.buckets.filter(k => BUCKET_KEYS.has(k));
  if (r.mealType && BUCKET_KEYS.has(r.mealType)) return [r.mealType];
  return [];
}

const FREQUENCIES = [
  { key: 'regular', label: 'Regular' },
  { key: 'special', label: 'Special' },
  { key: 'retired', label: 'Retired' },
];

// How a spot tends to leave you, stored as `health` on the record.
//
// Two options and a blank rather than a scale. The question this answers is the
// one you ask choosing where to go — "is this the sensible one or the treat" —
// and a middle rung would collect most of the list without telling you anything.
// Unset is a real third state: it means you haven't decided, not "average".
const HEALTH_OPTIONS = [
  { key: 'healthy', label: 'Healthy', icon: '🥗' },
  { key: 'unhealthy', label: 'Unhealthy', icon: '🍔' },
];
const HEALTH_KEYS = new Set(HEALTH_OPTIONS.map(h => h.key));

/**
 * A place you've been but never filed.
 *
 * Health and frequency are what the list is FOR — "somewhere sensible" and
 * "somewhere we go a lot" are the two questions you actually ask it — and a
 * visited spot missing either is invisible to every filter that matters. It
 * silently drops out of the answer rather than showing up wrong, which is the
 * kind of gap you never notice.
 *
 * Only visited spots: a want-to-try you've never been to has nothing to say
 * about how it leaves you or how often you'd go, so nagging about it would be
 * noise on the majority of the list.
 *
 * `retired` counts as filed — it's a deliberate answer to the frequency
 * question, just not one of the two positive ones.
 */
function hasBeenVisited(r) {
  return r?.status === 'visited' || !!r?.lastVisit;
}
/**
 * Filing the backlog, one place at a time.
 *
 * 213 of 218 visited spots arrived unfiled, and that is not a job anybody does
 * by opening 213 cards and finding the two fields on each. This asks the two
 * questions on their own, big enough to answer without reading, and moves on by
 * itself once both are answered.
 *
 * Every answer is saved the moment it's tapped rather than at the end: a
 * backlog this size gets done in several sittings, and losing a sitting's work
 * to a closed tab would mean it never gets done at all.
 */
function FileSpotsModal({ queue, onApply, onClose }) {
  const [i, setI] = useState(0);
  // Answers live here as well as on the record so the buttons stay lit while
  // the write is in flight — the underlying list updates a moment later.
  const [answers, setAnswers] = useState({});
  const spot = queue[i];
  if (!spot) return null;

  const current = answers[spot.id] || { health: healthOf(spot), frequency: spot.frequency || '' };
  const done = !!current.health && !!current.frequency;

  const answer = (patch) => {
    const next = { ...current, ...patch };
    setAnswers(a => ({ ...a, [spot.id]: next }));
    onApply(spot, patch);
    // Auto-advance only once BOTH are answered, so tapping health doesn't yank
    // the frequency buttons away before they can be used.
    if (next.health && next.frequency && i < queue.length - 1) {
      setTimeout(() => setI(n => n + 1), 180);
    }
  };

  return (
    <div className={styles.fileBackdrop} onClick={onClose}>
      <div className={styles.fileCard} onClick={e => e.stopPropagation()}>
        <div className={styles.fileProgress}>
          {i + 1} of {queue.length}
          <button className={styles.fileClose} onClick={onClose}>Done for now</button>
        </div>
        <div className={styles.fileBar}>
          <div className={styles.fileBarFill} style={{ width: `${((i + 1) / queue.length) * 100}%` }} />
        </div>

        <h3 className={styles.fileName}>{spot.name}</h3>
        {(spot.cuisines?.length > 0 || spot.address) && (
          <p className={styles.fileMeta}>
            {[...(spot.cuisines || []), spot.address].filter(Boolean).join(' · ')}
          </p>
        )}

        <div className={styles.fileLabel}>How does it leave you?</div>
        <div className={styles.fileRow}>
          {HEALTH_OPTIONS.map(h => (
            <button
              key={h.key}
              className={`${styles.fileBtn} ${current.health === h.key ? styles.fileBtnOn : ''}`}
              onClick={() => answer({ health: h.key })}
            >
              <span className={styles.fileBtnIcon}>{h.icon}</span>{h.label}
            </button>
          ))}
        </div>

        <div className={styles.fileLabel}>How often?</div>
        <div className={styles.fileRow}>
          {FREQUENCIES.map(f => (
            <button
              key={f.key}
              className={`${styles.fileBtn} ${current.frequency === f.key ? styles.fileBtnOn : ''}`}
              onClick={() => answer({ frequency: f.key })}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={styles.fileNav}>
          <button className={styles.fileNavBtn} disabled={i === 0} onClick={() => setI(n => n - 1)}>Back</button>
          <button className={styles.fileNavBtn} onClick={() => setI(n => Math.min(queue.length - 1, n + 1))}>
            {done ? 'Next' : 'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The banner. Null when there's nothing to say, so it costs no space. */
function unfiledNotice(unfiled, onFile) {
  if (!unfiled || unfiled.length === 0) return null;
  const names = unfiled.slice(0, 6).map(r => r.name).filter(Boolean);
  return (
    <div className={styles.unfiledBanner}>
      <strong>
        ⚠ {unfiled.length} visited {unfiled.length === 1 ? 'place has' : 'places have'} no health or frequency set
      </strong>
      {names.length > 0 && (
        <span className={styles.unfiledNames}>
          {names.join(', ')}{unfiled.length > names.length ? `, +${unfiled.length - names.length} more` : ''}
        </span>
      )}
      <span className={styles.unfiledWhy}>
        Filters and the healthy/regular views skip them until they're filed.
      </span>
      {onFile && (
        <button className={styles.unfiledBtn} onClick={() => onFile(unfiled)}>
          File {unfiled.length === 1 ? 'it' : `them (${unfiled.length})`} — two taps each
        </button>
      )}
    </div>
  );
}

function missingCategories(r) {
  if (!hasBeenVisited(r)) return [];
  const gaps = [];
  if (!healthOf(r)) gaps.push('health');
  if (!String(r?.frequency || '').trim()) gaps.push('frequency');
  return gaps;
}

/**
 * A spot's health tag, migrating from the legacy `dietTags` array.
 *
 * `dietTags` is free text from the original spreadsheet import — a column
 * matching /healthy/i, holding things like "Healthy", "Unhealthy", "Workout".
 * It was written by the importer, carried by the exporter, and rendered
 * absolutely nowhere, so that judgement has been sitting in the data invisibly.
 * Reading it here means an existing library arrives already tagged instead of
 * asking you to redo work you did in the sheet.
 *
 * Same lazy migration as bucketsOf does for `mealType`: nothing is rewritten
 * until you edit a spot, at which point both fields are saved in step.
 *
 * "unhealthy" contains "healthy", so it is tested first and across the whole
 * array — otherwise a spot tagged both ways reads as healthy by luck of order.
 */
function healthOf(r) {
  const v = String(r?.health || '').trim().toLowerCase();
  if (HEALTH_KEYS.has(v)) return v;
  const tags = (Array.isArray(r?.dietTags) ? r.dietTags : [])
    .map(t => String(t || '').trim().toLowerCase());
  if (tags.some(t => t.includes('unhealthy'))) return 'unhealthy';
  if (tags.some(t => t.includes('healthy'))) return 'healthy';
  return '';
}
function healthOption(key) {
  return HEALTH_OPTIONS.find(h => h.key === key) || null;
}

/**
 * `dietTags` with its health entry replaced to match the picker.
 *
 * Kept in sync the way `mealType` is kept in sync with `buckets`: the CSV
 * exporter and the importer both still speak dietTags, and anything else in
 * there (a "Workout" tag) is not ours to throw away.
 */
function syncDietTags(existing, health) {
  const kept = (Array.isArray(existing) ? existing : [])
    .filter(t => !String(t || '').trim().toLowerCase().includes('healthy'));
  const label = healthOption(health)?.label;
  const next = label ? [...kept, label] : kept;
  return next.length ? next : undefined;
}

// Whether a spot belongs to a bucket filter. 'unsorted' matches spots with no
// buckets; otherwise the bucket must be assigned, OR a free-text Category must
// contain the bucket's label (so a "coffee shops" category is still caught by
// the Coffee filter even on a spot that was never bucketed).
function restaurantMatchesBucket(r, bucketKey) {
  if (!bucketKey) return true;
  const buckets = bucketsOf(r);
  if (bucketKey === 'unsorted') return buckets.length === 0;
  if (buckets.includes(bucketKey)) return true;
  const term = bucketLabel(bucketKey).toLowerCase();
  return term ? (r.categories || []).some(c => (c || '').toLowerCase().includes(term)) : false;
}

// Table view: column registry, defaults, and per-user width/visibility prefs.
const TABLE_COLUMNS = [
  { key: 'name', label: 'Name', width: 220, visible: true },
  { key: 'status', label: 'Status', width: 110, visible: true },
  { key: 'takenJoanne', label: 'Joanne', width: 70, visible: true },
  { key: 'rating', label: 'Rating', width: 120, visible: true },
  { key: 'cuisines', label: 'Cuisines', width: 180, visible: true },
  { key: 'locations', label: 'Locations', width: 180, visible: true },
  { key: 'categories', label: 'Categories', width: 180, visible: true },
  { key: 'address', label: 'Address', width: 260, visible: true },
  { key: 'mealType', label: 'Buckets', width: 140, visible: true },
  { key: 'frequency', label: 'Frequency', width: 100, visible: true },
  { key: 'health', label: 'Health', width: 110, visible: true },
  { key: 'dish', label: 'What to order', width: 200, visible: true },
  { key: 'lastVisit', label: 'Last Visit', width: 120, visible: true },
  { key: 'notes', label: 'Notes', width: 320, visible: false },
  { key: 'url', label: 'URL', width: 240, visible: false },
];
const TABLE_PREFS_KEY = 'sunday-eating-out-table-prefs';

function loadTablePrefs() {
  try {
    const raw = localStorage.getItem(TABLE_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function saveTablePrefs(prefs) {
  try { localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function cellValueFor(r, key) {
  switch (key) {
    case 'name': return r.name || '';
    case 'status': return r.status === 'visited' ? 'Visited' : 'Want to try';
    case 'takenJoanne': return r.takenJoanne ? '✓' : '';
    case 'rating':
      if (r.rating != null) return '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      return r.ratingLabel || '';
    case 'cuisines': return (r.cuisines || []).join(', ');
    case 'locations': return (r.locations || []).join(', ');
    case 'categories': return (r.categories || []).join(', ');
    case 'address': return r.address || '';
    case 'mealType': return bucketsOf(r).map(bucketLabel).filter(Boolean).join(', ');
    case 'frequency': return r.frequency
      ? r.frequency.charAt(0).toUpperCase() + r.frequency.slice(1)
      : '';
    case 'health': return healthOption(healthOf(r))?.label || '';
    case 'dish': return r.dish || '';
    case 'lastVisit': return r.lastVisit ? formatDate(r.lastVisit) : '';
    case 'notes': return r.notes || '';
    case 'url': return r.url || '';
    default: return '';
  }
}

function compareValues(a, b, key) {
  if (key === 'rating') {
    const av = typeof a.rating === 'number' ? a.rating : -1;
    const bv = typeof b.rating === 'number' ? b.rating : -1;
    return av - bv;
  }
  if (key === 'takenJoanne') {
    return (a.takenJoanne ? 1 : 0) - (b.takenJoanne ? 1 : 0);
  }
  if (key === 'lastVisit') {
    const ad = a.lastVisit ? new Date(a.lastVisit).getTime() : 0;
    const bd = b.lastVisit ? new Date(b.lastVisit).getTime() : 0;
    return ad - bd;
  }
  return String(cellValueFor(a, key)).localeCompare(String(cellValueFor(b, key)), undefined, { sensitivity: 'base' });
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function haversineMiles(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StarRating({ value, onChange, size = 22 }) {
  const v = value ?? 0;
  return (
    <div className={styles.stars}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={styles.starBtn}
          onClick={() => onChange(value === n ? null : n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          style={{ fontSize: size }}
        >
          <span className={n <= v ? styles.starFilled : styles.starEmpty}>
            {n <= v ? '★' : '☆'}
          </span>
        </button>
      ))}
      {value !== null && value !== undefined && (
        <button type="button" className={styles.starsClear} onClick={() => onChange(null)}>
          Clear
        </button>
      )}
    </div>
  );
}

function TagChips({ values, onChange, suggestions, placeholder }) {
  const [draft, setDraft] = useState('');
  const draftLower = draft.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!draftLower) return [];
    return suggestions
      .filter(s => s.toLowerCase().includes(draftLower) && !values.some(v => v.toLowerCase() === s.toLowerCase()))
      .slice(0, 6);
  }, [draftLower, suggestions, values]);

  function commit(value) {
    const cleaned = (value || '').trim();
    if (!cleaned) return;
    if (values.some(v => v.toLowerCase() === cleaned.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, cleaned]);
    setDraft('');
  }

  return (
    <div className={styles.tagWrap}>
      <div className={styles.chipRow}>
        {values.map(v => (
          <span key={v} className={styles.chip}>
            {v}
            <button type="button" className={styles.chipRemove} onClick={() => onChange(values.filter(x => x !== v))} aria-label="Remove tag">
              ✕
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        className={styles.input}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          }
        }}
        // Commit a typed-but-not-Entered tag when the field loses focus — e.g.
        // when the user types a category and clicks Save without pressing Enter.
        onBlur={() => commit(draft)}
        placeholder={placeholder}
      />
      {filtered.length > 0 && (
        <div className={styles.suggestionRow}>
          {filtered.map(s => (
            <button
              key={s}
              type="button"
              className={styles.suggestionChip}
              // preventDefault on mousedown stops the input's onBlur from firing
              // first and committing the partial draft alongside the suggestion.
              onMouseDown={e => e.preventDefault()}
              onClick={() => commit(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Editor for the per-restaurant "meals" list (what you order here, with macros).
// Each meal: { id, name, calories, protein, carbs, fat, source: 'manual'|'ai' }.
// Used inside EditModal; the parent owns the `meals` array via value/onChange.
function MealsEditor({ value, onChange, restaurantName }) {
  const meals = value || [];
  const [name, setName] = useState('');
  const [cal, setCal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [usedAi, setUsedAi] = useState(false);
  const [estimating, setEstimating] = useState(false);

  async function handleEstimate() {
    const n = name.trim();
    if (!n) { alert('Type the meal name first.'); return; }
    setEstimating(true);
    try {
      const ctx = restaurantName?.trim() ? ` at ${restaurantName.trim()}` : '';
      const res = await fetch('/api/generate-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Estimate the nutrition for this restaurant meal: "${n}"${ctx}. `
            + `Give a realistic estimate for a single serving as it would be served at a restaurant. `
            + `Return exactly 1 recipe object. Set the title to a clean name for the meal. Set servings to 1. `
            + `Include macrosPerServing with calories, protein, carbs, and fat.`,
          count: 1,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to estimate.');
      }
      const data = await res.json();
      const m = (data.recipes || [])[0]?.macrosPerServing || {};
      setCal(Math.round(m.calories) || '');
      setProtein(Math.round(m.protein) || '');
      setCarbs(Math.round(m.carbs) || '');
      setFat(Math.round(m.fat) || '');
      setUsedAi(true);
    } catch (err) {
      alert(`AI estimate failed: ${err.message || 'try again'}`);
    } finally {
      setEstimating(false);
    }
  }

  function addMeal() {
    const n = name.trim();
    if (!n) { alert('Meal needs a name.'); return; }
    onChange([
      ...meals,
      {
        id: generateId(),
        name: n,
        calories: Number(cal) || 0,
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
        source: usedAi ? 'ai' : 'manual',
      },
    ]);
    setName(''); setCal(''); setProtein(''); setCarbs(''); setFat(''); setUsedAi(false);
  }

  // Manually editing a macro means it's no longer a pure AI estimate.
  const macroInput = (val, set) => (
    <input
      type="number"
      className={styles.input}
      value={val}
      onChange={e => { set(e.target.value); setUsedAi(false); }}
      style={{ width: 64, padding: '0.35rem 0.4rem' }}
      min="0"
    />
  );

  return (
    <div className={styles.mealsEditor}>
      {meals.length > 0 && (
        <div className={styles.mealsList}>
          {meals.map(m => (
            <div key={m.id} className={styles.mealRow}>
              <span className={styles.mealRowName}>
                {m.name}{m.source === 'ai' ? ' ✨' : ''}
              </span>
              <span className={styles.mealRowMacros}>
                {Math.round(m.calories) || 0} cal · {Math.round(m.protein) || 0}p · {Math.round(m.carbs) || 0}c · {Math.round(m.fat) || 0}f
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => onChange(meals.filter(x => x.id !== m.id))}
                aria-label="Remove meal"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        type="text"
        className={styles.input}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Meal name, e.g. Spinach & feta pizza"
      />
      <div className={styles.mealMacroRow}>
        <label className={styles.mealMacroField}><span>Cal</span>{macroInput(cal, setCal)}</label>
        <label className={styles.mealMacroField}><span>Protein</span>{macroInput(protein, setProtein)}</label>
        <label className={styles.mealMacroField}><span>Carbs</span>{macroInput(carbs, setCarbs)}</label>
        <label className={styles.mealMacroField}><span>Fat</span>{macroInput(fat, setFat)}</label>
      </div>
      <div className={styles.mealsEditorActions}>
        <button type="button" className={styles.secondaryBtn} onClick={handleEstimate} disabled={estimating || !name.trim()}>
          {estimating ? 'Estimating…' : '✨ AI estimate'}
        </button>
        <button type="button" className={styles.fetchBtn} onClick={addMeal} disabled={!name.trim()}>
          + Add meal
        </button>
      </div>
    </div>
  );
}

// The photo uploaded for a spot (users/{ownerUid}/eatingOutImages/{spotId}),
// shared with the mobile app — upload on either and it shows on both. An
// uploaded photo wins over the image scraped from the place's link wherever
// both exist. Fetched per open modal, never per card, so browsing the list
// stays one read per spot you actually look at.
//
// The loaded photo is tagged with the spot it belongs to, and read back only
// when that tag still matches. That keeps the previous spot's photo from
// flashing in a reused modal, without a synchronous reset inside the effect.
function useSpotPhoto(ownerUid, spotId) {
  const key = ownerUid && spotId ? `${ownerUid}__${spotId}` : '';
  const [entry, setEntry] = useState({ key: '', url: null });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    loadSpotImage(ownerUid, spotId).then(url => { if (!cancelled) setEntry({ key, url }); });
    return () => { cancelled = true; };
  }, [key, ownerUid, spotId]);
  const setPhoto = useCallback(url => setEntry({ key, url }), [key]);
  return [entry.key === key ? entry.url : null, setPhoto];
}

// Photo block in the restaurant editor: the current picture plus upload /
// replace / remove. The file is compressed through the same canvas helper the
// exercise photos use (≤800px JPEG) so the doc stays far under Firestore's
// 1 MB cap. Owner-only — Firestore refuses cross-user writes.
function SpotPhotoEditor({ ownerUid, spotId, fallbackUrl }) {
  const [photo, setPhoto] = useSpotPhoto(ownerUid, spotId);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      await saveSpotImage(ownerUid, spotId, dataUrl);
      setPhoto(dataUrl);
    } catch (err) {
      alert(`Couldn't save that photo — ${err?.message || 'try again'}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ''; // let the same file be re-picked
    }
  };

  const handleRemove = async () => {
    if (!window.confirm('Remove the photo you uploaded for this place?')) return;
    setBusy(true);
    try {
      await deleteSpotImage(ownerUid, spotId);
      setPhoto(null);
    } catch (err) {
      alert(`Couldn't remove it — ${err?.message || 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const shown = photo || fallbackUrl || '';
  return (
    <>
      <label className={styles.fieldLabel}>Photo</label>
      {shown
        ? <img src={shown} alt="" className={styles.previewImg} />
        : <p className={styles.hintText}>No photo yet.</p>}
      {photo && fallbackUrl && (
        <p className={styles.hintText}>Your photo is showing instead of the one pulled from the link.</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files?.[0])}
      />
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className={styles.fetchBtn} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Saving…' : photo ? 'Replace photo' : 'Upload photo'}
        </button>
        {photo && (
          <button type="button" className={styles.fetchBtn} disabled={busy} onClick={handleRemove}>
            Remove
          </button>
        )}
      </div>
    </>
  );
}

// Shared comment thread for a spot, keyed by (ownerUid, spotId). Both the owner
// and anyone they've shared the list with can read + post (Firestore rules must
// permit the `eatingOutComments` collection).
function SpotComments({ ownerUid, spotId, user }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ownerUid || !spotId) return undefined;
    const unsub = subscribeSpotComments(ownerUid, spotId, setComments);
    return () => { if (unsub) unsub(); };
  }, [ownerUid, spotId]);

  const submit = async () => {
    const t = text.trim();
    if (!t || !user?.uid) return;
    setBusy(true);
    try {
      await addSpotComment(ownerUid, spotId, {
        authorUid: user.uid,
        authorUsername: user.displayName || '',
        text: t,
      });
      setText('');
    } catch (err) {
      alert(`Couldn't post comment — ${err?.message || 'try again'}.\n\nIf this keeps failing, the eatingOutComments Firestore rules may not be in place yet.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className={styles.fieldLabel}>Comments</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {comments.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No comments yet — start the conversation.</p>
        ) : (
          comments.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', fontSize: '0.88rem' }}>
              <strong style={{ whiteSpace: 'nowrap' }}>
                {c.authorUid === user?.uid ? 'You' : (c.authorUsername ? `@${c.authorUsername}` : 'Friend')}:
              </strong>
              <span style={{ flex: 1, wordBreak: 'break-word' }}>{c.text}</span>
              {c.authorUid === user?.uid && (
                <button
                  type="button"
                  onClick={() => deleteSpotComment(c.id)}
                  title="Delete"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className={styles.input}
          style={{ flex: 1 }}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Add a comment…"
        />
        <button type="button" className={styles.primaryBtn} onClick={submit} disabled={busy || !text.trim()}>
          Post
        </button>
      </div>
    </div>
  );
}

// Collaborative rating categories (1–5 each). `key` is the stored field inside
// a rating doc's `scores`, `label` the UI text.
//
// The set is PER BUCKET: rating a coffee shop on the same axes as a dinner
// spot never made sense. `food` stays the universal primary-quality axis and is
// RELABELLED per bucket rather than given a new key, so a spot recategorised
// from Lunch/Dinner to Coffee keeps the votes it already has. These four keys
// are frozen for that reason; bucket-specific extras get their own.
const BASE_RATING_CATEGORIES = [
  { key: 'food', label: 'Food & Drink Quality' },
  { key: 'service', label: 'Service' },
  { key: 'atmosphere', label: 'Atmosphere' },
  { key: 'price', label: 'Price' },
];
const SERVICE_ATMOSPHERE_PRICE = [
  { key: 'service', label: 'Service' },
  { key: 'atmosphere', label: 'Atmosphere' },
  { key: 'price', label: 'Price' },
];

// Built-in defaults for the stock buckets. A bucket's own saved
// `ratingCategories` wins over this; a custom bucket with neither falls back to
// BASE_RATING_CATEGORIES.
const DEFAULT_BUCKET_RATING_CATEGORIES = {
  breakfast: [
    { key: 'food', label: 'Food' },
    { key: 'coffee', label: 'Coffee' },
    ...SERVICE_ATMOSPHERE_PRICE,
  ],
  'lunch-dinner': [{ key: 'food', label: 'Food' }, ...SERVICE_ATMOSPHERE_PRICE],
  drinking: [{ key: 'food', label: 'Drinks' }, ...SERVICE_ATMOSPHERE_PRICE],
  coffee: [{ key: 'food', label: 'Coffee' }, ...SERVICE_ATMOSPHERE_PRICE],
  // Music gets its own key rather than relabelling `food`: on a club, an old
  // "Food & Drink Quality" vote isn't a statement about the music, and
  // relabelling it would put words in the voter's mouth. It survives as a
  // preserved row instead (see ratingCategoriesForSpot).
  'going-out': [{ key: 'music', label: 'Music & Crowd' }, ...SERVICE_ATMOSPHERE_PRICE],
};

// Keep only well-formed {key,label} pairs, first key wins.
function sanitizeRatingCategories(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const key = typeof c.key === 'string' ? c.key.trim() : '';
    const label = typeof c.label === 'string' ? c.label.trim() : '';
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
  }
  return out;
}

// Slug for a user-added category. NOT uniquified across buckets on purpose: two
// buckets that both add "Vibe" should share the key so the scores mean the same
// thing and aggregate together.
function makeRatingKey(label) {
  const base = (label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'rating';
}

/** The categories one bucket rates on. */
function bucketRatingCategories(bucketKey) {
  const saved = sanitizeRatingCategories(BUCKETS.find(b => b.key === bucketKey)?.ratingCategories);
  if (saved.length) return saved;
  return DEFAULT_BUCKET_RATING_CATEGORIES[bucketKey] || BASE_RATING_CATEGORIES;
}

// Best-known label for a stored key, for scores whose category has since been
// removed or which came from a bucket this spot is no longer in.
function ratingLabelFor(key) {
  for (const b of BUCKETS) {
    const hit = sanitizeRatingCategories(b.ratingCategories).find(c => c.key === key);
    if (hit) return hit.label;
  }
  for (const list of Object.values(DEFAULT_BUCKET_RATING_CATEGORIES)) {
    const hit = list.find(c => c.key === key);
    if (hit) return hit.label;
  }
  const base = BASE_RATING_CATEGORIES.find(c => c.key === key);
  if (base) return base.label;
  return key.replace(/-/g, ' ').replace(/^./, ch => ch.toUpperCase());
}

/**
 * The rows to show for one spot: the union of its buckets' categories, in
 * bucket order, plus any key that already has a vote but isn't in that union.
 *
 * Two buckets can label the same key differently (Breakfast calls `food`
 * "Food", Coffee calls it "Coffee") — the spot's FIRST bucket wins, so the
 * table is deterministic rather than depending on doc arrival order. The
 * trailing preserved rows are why changing a spot's buckets never loses a
 * rating: it stops being asked for, but what was already given still shows.
 */
function ratingCategoriesForSpot(r, docs) {
  const keys = bucketsOf(r || {});
  const out = [];
  const seen = new Set();
  for (const k of keys) {
    for (const c of bucketRatingCategories(k)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c);
    }
  }
  if (out.length === 0) {
    for (const c of BASE_RATING_CATEGORIES) { seen.add(c.key); out.push(c); }
  }
  for (const d of docs || []) {
    for (const [key, v] of Object.entries(d?.scores || {})) {
      if (seen.has(key) || !(typeof v === 'number' && v >= 1 && v <= 5)) continue;
      seen.add(key);
      out.push({ key, label: ratingLabelFor(key), preserved: true });
    }
  }
  return out;
}

// Fold a spot's rating docs into per-category averages, an overall average,
// and the voter count. Pure — safe to call in render.
//
// Deliberately key-AGNOSTIC: it averages whatever categories were actually
// scored rather than a fixed list, so the card badge is right no matter which
// bucket's categories a spot was rated on (and a category later removed from a
// bucket still counts toward the spot's overall).
function aggregateSpotRatings(docs) {
  const acc = {};
  let voterCount = 0;
  for (const d of docs || []) {
    const s = d.scores || {};
    let rated = false;
    for (const [key, v] of Object.entries(s)) {
      if (!(typeof v === 'number' && v >= 1 && v <= 5)) continue;
      if (!acc[key]) acc[key] = { sum: 0, count: 0 };
      acc[key].sum += v;
      acc[key].count++;
      rated = true;
    }
    if (rated) voterCount++;
  }
  const perCategory = {};
  const catAvgs = [];
  for (const [key, { sum, count }] of Object.entries(acc)) {
    const avg = count ? sum / count : null;
    perCategory[key] = { avg, count };
    if (avg != null) catAvgs.push(avg);
  }
  const overall = catAvgs.length ? catAvgs.reduce((a, b) => a + b, 0) / catAvgs.length : null;
  return { perCategory, overall, voterCount };
}

const RANKING_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

/**
 * What the Rankings tab can rank by: Overall, plus every category that actually
 * has a vote among the spots in view.
 *
 * Built from the data rather than a fixed list because categories are per
 * bucket now — a coffee shop is rated on Coffee, a club on Music & Crowd — so
 * which axes are rankable depends on what's on screen. Order follows the
 * buckets' own category order (so Food/Service/Atmosphere/Price lead), with
 * anything left over alphabetically.
 */
function rankMetricsFor(spots, ratingsBySpot) {
  const voted = new Set();
  for (const r of spots) {
    for (const d of ratingsBySpot[`${r._ownerUid}__${r.id}`] || []) {
      for (const [key, v] of Object.entries(d?.scores || {})) {
        if (typeof v === 'number' && v >= 1 && v <= 5) voted.add(key);
      }
    }
  }
  const order = [];
  for (const b of BUCKETS) for (const c of bucketRatingCategories(b.key)) if (!order.includes(c.key)) order.push(c.key);
  for (const c of BASE_RATING_CATEGORIES) if (!order.includes(c.key)) order.push(c.key);
  const rank = k => { const i = order.indexOf(k); return i === -1 ? order.length : i; };
  const keys = [...voted].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [
    { key: 'overall', label: 'Overall' },
    ...keys.map(k => ({ key: k, label: ratingLabelFor(k) })),
  ];
}

/**
 * Order spots by their collaborative rating for one metric — the group average
 * across everyone who rated, i.e. the same number the ★ badge on a card shows.
 *
 * Spots nobody has rated for that metric can't be placed, so they're returned
 * separately rather than sorted to the bottom as if they'd scored zero. Ties
 * break toward the better-evidenced score (more votes), then by name so the
 * order is stable rather than dependent on filter order.
 */
function rankSpotsByRating(spots, ratingsBySpot, metric) {
  const ranked = [];
  const unrated = [];
  for (const r of spots) {
    const agg = aggregateSpotRatings(ratingsBySpot[`${r._ownerUid}__${r.id}`] || []);
    const score = metric === 'overall' ? agg.overall : agg.perCategory[metric]?.avg ?? null;
    const votes = metric === 'overall' ? agg.voterCount : agg.perCategory[metric]?.count ?? 0;
    if (score == null) unrated.push(r);
    else ranked.push({ r, score, votes, agg });
  }
  ranked.sort((a, b) => (
    b.score - a.score
    || b.votes - a.votes
    || String(a.r.name || '').localeCompare(String(b.r.name || ''))
  ));
  return { ranked, unrated };
}

// Small read-only star row (rounds to the nearest whole star) for aggregate
// display. The interactive input reuses <StarRating/>.
function StarsStatic({ value, size = 15 }) {
  const rounded = Math.round(value || 0);
  return (
    <span className={styles.stars} style={{ gap: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} className={n <= rounded ? styles.starFilled : styles.starEmpty} style={{ fontSize: size }}>
          {n <= rounded ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}

// Mean of the categories someone actually scored, or null if they scored none.
// Matches how the group `overall` is derived in aggregateSpotRatings — over
// whatever keys are present, not a fixed list.
function overallOfScores(scores) {
  const vals = Object.values(scores || {})
    .filter(v => typeof v === 'number' && v >= 1 && v <= 5);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Collaborative ratings for one spot: a table of the categories ITS BUCKETS
// rate on, with YOUR stars (clickable) in the first column and one read-only
// column per person who's rated it, so you can see who gave what side by side.
// The group aggregate sits above it. Keyed by (ownerUid, spotId) like the
// comment thread; each collaborator writes only their own doc (deterministic id
// in setEatingOutRating).
function SpotRatings({ ownerUid, spotId, spot, user }) {
  const [docs, setDocs] = useState([]);
  // Local copy of MY scores for instant feedback; re-synced from the live doc.
  const [myScores, setMyScores] = useState({});

  useEffect(() => {
    if (!ownerUid || !spotId) return undefined;
    const unsub = subscribeSpotRatings(ownerUid, spotId, setDocs);
    return () => { if (unsub) unsub(); };
  }, [ownerUid, spotId]);

  const myDoc = useMemo(() => docs.find(d => d.authorUid === user?.uid), [docs, user?.uid]);
  useEffect(() => { setMyScores(myDoc?.scores || {}); }, [myDoc]);

  const agg = useMemo(() => aggregateSpotRatings(docs), [docs]);
  const categories = useMemo(() => ratingCategoriesForSpot(spot, docs), [spot, docs]);
  const bucketNames = useMemo(
    () => bucketsOf(spot || {}).map(bucketLabel).filter(Boolean).join(' + '),
    [spot],
  );

  // Everyone but me who has actually scored something — one table column each.
  // Sorted by name so the columns don't reshuffle as docs stream in.
  const friends = useMemo(() => (
    docs
      .filter(d => d.authorUid !== user?.uid && overallOfScores(d.scores) != null)
      .sort((a, b) => String(a.authorUsername || '').localeCompare(String(b.authorUsername || '')))
  ), [docs, user?.uid]);

  const setCategory = (key, value) => {
    const next = { ...myScores, [key]: value };
    setMyScores(next); // optimistic
    setEatingOutRating(ownerUid, spotId, {
      authorUid: user.uid,
      authorUsername: user.displayName || '',
      scores: next,
    }).catch(err => {
      alert(`Couldn't save your rating — ${err?.message || 'try again'}.\n\nIf this keeps failing, the eatingOutRatings Firestore rules may not be in place yet.`);
    });
  };

  const fmt = n => (n == null ? '–' : n.toFixed(1));

  return (
    <div>
      <div className={styles.fieldLabel}>Ratings</div>

      {/* Aggregate summary */}
      <div className={styles.ratingSummary}>
        {agg.voterCount > 0 ? (
          <>
            <div className={styles.ratingOverall}>
              <StarsStatic value={agg.overall} size={18} />
              <span className={styles.ratingOverallNum}>{fmt(agg.overall)}</span>
              <span className={styles.ratingCount}>
                {agg.voterCount} {agg.voterCount === 1 ? 'person' : 'people'}
              </span>
            </div>
            <div className={styles.ratingCats}>
              {categories.map(c => (
                <span key={c.key} className={styles.ratingCatChip}>
                  {c.label.split(' ')[0]} <strong>{fmt(agg.perCategory[c.key]?.avg)}</strong>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.ratingEmpty}>No ratings yet — be the first.</p>
        )}
      </div>

      {/* Category × person table. Your column is the input; friends are
          read-only. Scrolls sideways rather than squeezing the star columns
          once a few people have rated. */}
      <div className={styles.ratingTableWrap}>
        <table className={styles.ratingTable}>
          <thead>
            <tr>
              <th scope="col" className={styles.ratingTableCatHead}>Category</th>
              <th scope="col" className={styles.ratingTableYouHead}>You</th>
              {friends.map(f => (
                <th key={f.id} scope="col" title={f.authorUsername ? `@${f.authorUsername}` : 'Friend'}>
                  {f.authorUsername ? `@${f.authorUsername}` : 'Friend'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(c => (
              <tr key={c.key}>
                <th
                  scope="row"
                  className={styles.ratingTableCat}
                  title={c.preserved ? 'Rated before this spot’s buckets changed — kept so the vote isn’t lost' : undefined}
                >
                  {c.label}{c.preserved ? ' *' : ''}
                </th>
                <td className={styles.ratingTableYou}>
                  <StarRating value={myScores[c.key] ?? null} onChange={v => setCategory(c.key, v)} size={18} />
                </td>
                {friends.map(f => {
                  const v = f.scores?.[c.key];
                  const rated = typeof v === 'number' && v >= 1 && v <= 5;
                  return (
                    <td key={f.id} className={styles.ratingTableFriend}>
                      {rated
                        ? <StarsStatic value={v} size={14} />
                        : <span className={styles.ratingTableBlank}>–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={styles.ratingTableCat}>Overall</th>
              <td className={styles.ratingTableYou}>{fmt(overallOfScores(myScores))}</td>
              {friends.map(f => (
                <td key={f.id} className={styles.ratingTableFriend}>{fmt(overallOfScores(f.scores))}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.ratingTableHint}>
        Tap your stars to rate — saves as you go. Tap the same star again to clear it.
        {' '}{bucketNames
          ? `Categories come from the ${bucketNames} bucket${bucketsOf(spot || {}).length > 1 ? 's' : ''} — change them under ✎ Edit buckets.`
          : 'Put this spot in a bucket to rate it on that bucket’s categories.'}
        {categories.some(c => c.preserved) && ' Rows marked * were rated under a different bucket and are kept for the record.'}
      </p>
    </div>
  );
}

// Detail sheet for a spot a FRIEND added: their info, the shared ratings and
// the comment thread — plus Edit, since a shared list is collaborative.
function SpotDetailModal({ spot, user, onClose, onEdit }) {
  const [uploadedPhoto] = useSpotPhoto(spot._ownerUid, spot.id);
  const photo = uploadedPhoto || spot.imageUrl || '';
  const meta = [
    (spot.cuisines || []).join(', '),
    (spot.locations || []).join(', '),
    spot.status === 'want-to-try' ? 'Want to try' : 'Visited',
  ].filter(Boolean).join(' · ');
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {spot.name}
            {spot._ownerUsername && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                shared by @{spot._ownerUsername}
              </span>
            )}
          </h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody} style={{ gap: '1rem' }}>
          {photo && <img src={photo} alt="" className={styles.previewImg} />}
          {meta && <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>{meta}</p>}
          {spot.dish && <p style={{ margin: 0, fontSize: '0.9rem' }}><strong>What to order:</strong> {spot.dish}</p>}
          {spot.notes && <p style={{ margin: 0, fontSize: '0.9rem' }}>{spot.notes}</p>}
          {spot.url && (
            <a href={spot.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>Open link ↗</a>
          )}
          <SpotRatings ownerUid={spot._ownerUid} spotId={spot.id} spot={spot} user={user} />
          <SpotComments ownerUid={spot._ownerUid} spotId={spot.id} user={user} />
        </div>
        <div className={styles.modalFooter}>
          {/* Editing lives behind this sheet rather than replacing it: a
              friend's card should still lead to the ratings and comments. */}
          {onEdit && (
            <button type="button" className={styles.secondaryBtn} onClick={onEdit}>Edit</button>
          )}
          <span className={styles.footerSpacer} />
          <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ initial, onSave, onClose, onDelete, cuisineSuggestions, locationSuggestions, categorySuggestions = [], user }) {
  const [name, setName] = useState(initial.name || '');
  const [url, setUrl] = useState(initial.url || '');
  const [imageUrl, setImageUrl] = useState(initial.imageUrl || '');
  const [description, setDescription] = useState(initial.description || '');
  const [notes, setNotes] = useState(initial.notes || '');
  const [cuisines, setCuisines] = useState(initial.cuisines || []);
  const [locations, setLocations] = useState(initial.locations || []);
  const [categories, setCategories] = useState(initial.categories || []);
  const [rating, setRating] = useState(initial.rating ?? null);
  const [ratingLabel, setRatingLabel] = useState(initial.ratingLabel || '');
  const [status, setStatus] = useState(initial.status || 'want-to-try');
  const [takenJoanne, setTakenJoanne] = useState(!!initial.takenJoanne);
  const [buckets, setBuckets] = useState(() => bucketsOf(initial));
  const [frequency, setFrequency] = useState(initial.frequency || '');
  const [health, setHealth] = useState(() => healthOf(initial));
  const [dish, setDish] = useState(initial.dish || '');
  const [meals, setMeals] = useState(Array.isArray(initial.meals) ? initial.meals : []);
  const [address, setAddress] = useState(initial.address || '');
  const [coords, setCoords] = useState(
    initial.lat != null && initial.lng != null ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const [lastVisit, setLastVisit] = useState(initial.lastVisit ? initial.lastVisit.slice(0, 10) : '');
  const [extracting, setExtracting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  async function handleExtract() {
    const trimmed = (url || '').trim();
    if (!trimmed) {
      alert('Paste a URL first.');
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch(`/api/extract-restaurant?url=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (data?.name && !name.trim()) setName(data.name);
      if (data?.imageUrl && !imageUrl) setImageUrl(data.imageUrl);
      if (data?.description && !description) setDescription(data.description);
      if (data?.address && !address.trim()) setAddress(data.address);
      // Google Maps extraction returns lat/lng — populate coords so we can
      // skip the Lookup step entirely.
      if (typeof data?.lat === 'number' && typeof data?.lng === 'number' && !coords) {
        setCoords({ lat: data.lat, lng: data.lng });
      }
      const hasAnything = data?.name || data?.imageUrl || data?.address
        || (typeof data?.lat === 'number' && typeof data?.lng === 'number');
      if (!hasAnything) {
        alert("Couldn't find anything — type a name in.");
      }
    } catch (err) {
      alert(`Fetch failed: ${err.message || 'try again'}`);
    } finally {
      setExtracting(false);
    }
  }

  async function handleGeocode() {
    const a = (address || '').trim();
    if (!a) {
      alert('Type an address first.');
      return;
    }
    setGeocoding(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(a)}`);
      const data = await res.json();
      if (res.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
        setCoords({ lat: data.lat, lng: data.lng });
        if (data.displayName && data.displayName !== a) {
          // Don't overwrite the user's typed string, but show what we matched.
          alert(`Matched: ${data.displayName}`);
        }
      } else {
        alert(data.error || 'No results for that address.');
      }
    } catch (err) {
      alert(`Geocode failed: ${err.message || 'try again'}`);
    } finally {
      setGeocoding(false);
    }
  }

  function handleSave() {
    const cleanedName = name.trim();
    if (!cleanedName) {
      alert('Restaurants need a name.');
      return;
    }
    const now = new Date().toISOString();
    onSave({
      id: initial.id || generateId(),
      name: cleanedName,
      url: url.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      description: description.trim() || undefined,
      notes: notes.trim() || undefined,
      cuisines,
      locations,
      categories,
      rating,
      ratingLabel: ratingLabel.trim() || undefined,
      status,
      buckets: buckets.length ? buckets : undefined,
      // Keep the legacy single field in sync so consumers that still read it
      // (CSV export, older mobile builds) get the primary bucket.
      mealType: buckets[0] || undefined,
      frequency: frequency || undefined,
      health: health || undefined,
      dish: dish.trim() || undefined,
      meals: meals.length ? meals : undefined,
      address: address.trim() || undefined,
      lat: coords?.lat,
      lng: coords?.lng,
      lastVisit: lastVisit ? new Date(lastVisit + 'T12:00:00').toISOString() : undefined,
      takenJoanne: takenJoanne || undefined,
      // Health is written to both the new field and the legacy array, so CSV
      // export and the importer keep agreeing with the picker.
      dietTags: syncDietTags(initial.dietTags, health),
      meatTags: initial.meatTags,
      createdAt: initial.createdAt || now,
      updatedAt: now,
    });
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{initial.id ? 'Edit restaurant' : 'Add restaurant'}</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <label className={styles.fieldLabel}>URL</label>
          <div className={styles.urlRow}>
            <input
              type="url"
              className={styles.input}
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/..."
            />
            <button type="button" className={styles.fetchBtn} onClick={handleExtract} disabled={extracting}>
              {extracting ? 'Fetching…' : 'Fetch'}
            </button>
          </div>

          {/* Photos are keyed by the place's id, so a brand-new one shows just
              the link preview until it's saved. Written under the OWNER's uid,
              so a photo added to a shared spot lands on their list. */}
          {initial.id && user?.uid ? (
            <SpotPhotoEditor ownerUid={initial._ownerUid || user.uid} spotId={initial.id} fallbackUrl={imageUrl} />
          ) : imageUrl ? (
            <>
              <label className={styles.fieldLabel}>Preview</label>
              <img src={imageUrl} alt="" className={styles.previewImg} />
              {!initial.id && <p className={styles.hintText}>Save this place to add your own photo.</p>}
            </>
          ) : null}

          <label className={styles.fieldLabel}>Name</label>
          <input
            type="text"
            className={styles.input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Restaurant name"
          />

          <label className={styles.fieldLabel}>Address</label>
          <div className={styles.urlRow}>
            <input
              type="text"
              className={styles.input}
              value={address}
              onChange={e => { setAddress(e.target.value); setCoords(null); }}
              placeholder="123 Main St, Brooklyn, NY"
            />
            <button type="button" className={styles.fetchBtn} onClick={handleGeocode} disabled={geocoding}>
              {geocoding ? 'Locating…' : 'Lookup'}
            </button>
          </div>
          {coords && (
            <p className={styles.hintText}>
              ✓ Geocoded — {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </p>
          )}

          <label className={styles.fieldLabel}>Cuisines / food types</label>
          <TagChips
            values={cuisines}
            onChange={setCuisines}
            suggestions={cuisineSuggestions}
            placeholder="Type a cuisine and press Enter"
          />

          <label className={styles.fieldLabel}>Neighborhoods / cities</label>
          <TagChips
            values={locations}
            onChange={setLocations}
            suggestions={locationSuggestions}
            placeholder="Type a location and press Enter"
          />

          <label className={styles.fieldLabel}>Categories (for voting)</label>
          <TagChips
            values={categories}
            onChange={setCategories}
            suggestions={categorySuggestions}
            placeholder="e.g., coffee shops, date spots — press Enter"
          />

          <label className={styles.fieldLabel}>Buckets</label>
          <div className={styles.statusRow}>
            {BUCKETS.map(b => (
              <button
                key={b.key}
                type="button"
                className={`${styles.statusBtn} ${buckets.includes(b.key) ? styles.statusBtnActive : ''}`}
                onClick={() => setBuckets(prev => prev.includes(b.key)
                  ? prev.filter(k => k !== b.key)
                  : [...prev, b.key])}
              >
                {b.icon} {b.label}
              </button>
            ))}
          </div>

          <label className={styles.fieldLabel}>Frequency</label>
          <div className={styles.statusRow}>
            <button
              type="button"
              className={`${styles.statusBtn} ${!frequency ? styles.statusBtnActive : ''}`}
              onClick={() => setFrequency('')}
            >
              —
            </button>
            {FREQUENCIES.map(f => (
              <button
                key={f.key}
                type="button"
                className={`${styles.statusBtn} ${frequency === f.key ? styles.statusBtnActive : ''}`}
                onClick={() => setFrequency(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <label className={styles.fieldLabel}>Health</label>
          <div className={styles.statusRow}>
            {/* Same three-state shape as Frequency: "—" is a real answer
                meaning you haven't decided, not a neutral middle. */}
            <button
              type="button"
              className={`${styles.statusBtn} ${!health ? styles.statusBtnActive : ''}`}
              onClick={() => setHealth('')}
            >
              —
            </button>
            {HEALTH_OPTIONS.map(h => (
              <button
                key={h.key}
                type="button"
                className={`${styles.statusBtn} ${health === h.key ? styles.statusBtnActive : ''}`}
                onClick={() => setHealth(health === h.key ? '' : h.key)}
              >
                {h.icon} {h.label}
              </button>
            ))}
          </div>

          <label className={styles.fieldLabel}>Status</label>
          <div className={styles.statusRow}>
            {['want-to-try', 'visited'].map(s => (
              <button
                key={s}
                type="button"
                className={`${styles.statusBtn} ${status === s ? styles.statusBtnActive : ''}`}
                onClick={() => setStatus(s)}
              >
                {s === 'want-to-try' ? 'Want to try' : 'Visited'}
              </button>
            ))}
          </div>

          <label
            className={styles.fieldLabel}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: '0.6rem',
              cursor: 'pointer',
              textTransform: 'none',
              letterSpacing: 0,
              fontSize: '0.9rem',
              color: 'var(--color-text)',
              fontWeight: 600,
            }}
          >
            <input
              type="checkbox"
              checked={takenJoanne}
              onChange={e => setTakenJoanne(e.target.checked)}
            />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: JOANNE_COLOR,
                  display: 'inline-block',
                }}
              />
              Taken Joanne here
            </span>
          </label>

          {/* The single 5-star rating is gone from this form — the per-category
              Ratings table is where a spot gets scored. The label below still
              derives a star value (ratingLabelToStars) so the card badge and
              the table column keep working, and existing ratings are untouched. */}
          <label className={styles.fieldLabel}>Label</label>
          <input
            type="text"
            className={styles.input}
            value={ratingLabel}
            onChange={e => {
              const v = e.target.value;
              setRatingLabel(v);
              const stars = ratingLabelToStars(v);
              if (stars != null) setRating(stars);
            }}
            placeholder='Optional label: "great", "incredible", "try next", "closed"…'
          />

          <label className={styles.fieldLabel}>What to order</label>
          <input
            type="text"
            className={styles.input}
            value={dish}
            onChange={e => setDish(e.target.value)}
            placeholder='e.g., "Spinach and Feta Pizza"'
          />

          <label className={styles.fieldLabel}>Meals (track these from the + button)</label>
          <MealsEditor value={meals} onChange={setMeals} restaurantName={name} />

          <label className={styles.fieldLabel}>Last visit</label>
          <input
            type="date"
            className={styles.input}
            value={lastVisit}
            onChange={e => setLastVisit(e.target.value)}
          />

          <label className={styles.fieldLabel}>Notes</label>
          <textarea
            className={styles.textarea}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What to order, who recommended it, etc."
            rows={4}
          />

          {description && (
            <>
              <label className={styles.fieldLabel}>Pulled from URL</label>
              <p className={styles.hintText}>{description}</p>
            </>
          )}

          {/* Ratings + shared comments — only for an existing spot (a brand-new
              one has no id/thread yet). Works for your own spots and, if this
              modal is ever opened for a friend's, keys to that owner. */}
          {initial.id && user?.uid && (
            <>
              {/* `buckets` (the live edit state), not `initial` — retagging a
                  spot swaps the rating rows immediately, before you hit Save. */}
              <SpotRatings
                ownerUid={initial._ownerUid || user.uid}
                spotId={initial.id}
                spot={{ ...initial, buckets }}
                user={user}
              />
              <SpotComments ownerUid={initial._ownerUid || user.uid} spotId={initial.id} user={user} />
            </>
          )}
        </div>
        <div className={styles.modalFooter}>
          {onDelete && (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => {
                if (confirm('Delete this restaurant?')) onDelete();
              }}
            >
              🗑 Delete
            </button>
          )}
          <div className={styles.footerSpacer} />
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

function BulkImportModal({ onClose, onImport, existing }) {
  const [text, setText] = useState('');
  const [strategy, setStrategy] = useState('replace-all');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState({});
  // Track whether the user manually edited the mapping so we don't clobber
  // their choices when they tweak the textarea.
  const [mappingTouched, setMappingTouched] = useState(false);

  const rows = useMemo(() => splitTsv(text), [text]);
  const columnCount = useMemo(() => {
    let max = 0;
    for (const r of rows) if (r.length > max) max = r.length;
    return max;
  }, [rows]);

  const detectedHeader = useMemo(() => detectHasHeader(rows), [rows]);

  // When the pasted text changes, refresh auto-detection (header + mapping)
  // unless the user has already tweaked the mapping by hand.
  useEffect(() => {
    if (rows.length === 0) {
      setMapping({});
      setMappingTouched(false);
      return;
    }
    setHasHeader(detectedHeader);
    if (!mappingTouched) {
      setMapping(autoDetectMapping(rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const headerRow = hasHeader && rows.length > 0 ? rows[0] : null;
  const sampleRow = (hasHeader ? rows[1] : rows[0]) || [];

  const parsed = useMemo(
    () => applyMapping(rows, mapping, { hasHeader }),
    [rows, mapping, hasHeader],
  );
  const { fresh, duplicates } = useMemo(
    () => partitionDuplicates(parsed, existing),
    [parsed, existing],
  );

  // For "Replace all", figure out which existing restaurants would be
  // wiped (those not present in the incoming CSV by id or name).
  const willDelete = useMemo(() => {
    if (!existing || existing.length === 0) return [];
    const incomingIds = new Set(parsed.map(r => r.id).filter(Boolean));
    const incomingNames = new Set(parsed.map(r => (r.name || '').toLowerCase().trim()));
    return existing.filter(r =>
      !incomingIds.has(r.id) && !incomingNames.has((r.name || '').toLowerCase().trim()),
    );
  }, [parsed, existing]);

  const dataRowCount = Math.max(0, rows.length - (hasHeader ? 1 : 0));
  const nameMapped = Object.values(mapping).includes('name');

  function setColumnMapping(idx, key) {
    setMappingTouched(true);
    setMapping(prev => {
      const next = { ...prev };
      if (key === 'ignore' || !key) {
        delete next[idx];
      } else {
        next[idx] = key;
      }
      return next;
    });
  }

  function resetMapping() {
    setMappingTouched(false);
    setMapping(autoDetectMapping(rows));
  }

  function handleImport() {
    let toAdd = parsed;
    if (strategy === 'skip-duplicates') toAdd = fresh;
    if (toAdd.length === 0) {
      alert('Nothing to import.');
      return;
    }
    onImport(toAdd, strategy);
  }

  function previewMeta(r) {
    return [r.cuisines?.[0], r.locations?.[0], r.ratingLabel, r.frequency]
      .filter(Boolean)
      .join(' · ');
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`${styles.modal} ${styles.bulkModal}`} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Bulk import restaurants</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.hintText}>
            Paste tab-separated or CSV rows. Once pasted, map each column to a Restaurant
            field. We'll auto-detect a mapping when the first row looks like headers.
          </p>
          <textarea
            className={styles.textarea}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Place\\tMeal\\tCat\\tRating\\t...\\nDig In\\tLunch/Dinner - Regular\\tBowls\\tgreat\\t...'}
            rows={6}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.78rem' }}
          />

          {columnCount > 0 && (
            <>
              <div className={styles.importStats}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={hasHeader}
                    onChange={e => setHasHeader(e.target.checked)}
                  />
                  First row is column names
                </label>
                <div><strong>{columnCount}</strong> column{columnCount === 1 ? '' : 's'}</div>
                <div><strong>{dataRowCount}</strong> data row{dataRowCount === 1 ? '' : 's'}</div>
                {mappingTouched && (
                  <button type="button" className={styles.linkBtn} onClick={resetMapping}>
                    Reset mapping
                  </button>
                )}
              </div>

              <label className={styles.fieldLabel}>Map columns</label>
              <div className={styles.mappingGrid}>
                {Array.from({ length: columnCount }).map((_, i) => {
                  const headerText = headerRow ? (headerRow[i] || '').trim() : '';
                  const sample = (sampleRow[i] || '').trim();
                  const value = mapping[i] || 'ignore';
                  return (
                    <div key={i} className={styles.mappingRow}>
                      <div className={styles.mappingColInfo}>
                        <div className={styles.mappingColTitle}>
                          {headerText || `Column ${i + 1}`}
                        </div>
                        {sample && (
                          <div className={styles.mappingColSample} title={sample}>
                            e.g. {sample.length > 60 ? sample.slice(0, 60) + '…' : sample}
                          </div>
                        )}
                      </div>
                      <select
                        className={styles.mappingSelect}
                        value={value}
                        onChange={e => setColumnMapping(i, e.target.value)}
                      >
                        {IMPORT_FIELDS.map(f => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              {!nameMapped && (
                <p className={styles.warn} style={{ marginTop: 8 }}>
                  Map at least one column to <strong>Place / Name</strong> — that's required.
                </p>
              )}

              <div className={styles.importStats}>
                <div><strong>{parsed.length}</strong> rows parsed</div>
                <div><strong>{fresh.length}</strong> new</div>
                <div><strong>{duplicates.length}</strong> duplicate name{duplicates.length === 1 ? '' : 's'}</div>
              </div>

              <label className={styles.fieldLabel}>Import strategy</label>
              <div className={styles.statusRow}>
                <button
                  type="button"
                  className={`${styles.statusBtn} ${strategy === 'replace-all' ? styles.statusBtnActive : ''}`}
                  onClick={() => setStrategy('replace-all')}
                >
                  Replace all
                </button>
                <button
                  type="button"
                  className={`${styles.statusBtn} ${strategy === 'replace-duplicates' ? styles.statusBtnActive : ''}`}
                  onClick={() => setStrategy('replace-duplicates')}
                  disabled={duplicates.length === 0}
                >
                  Replace duplicates only
                </button>
                <button
                  type="button"
                  className={`${styles.statusBtn} ${strategy === 'skip-duplicates' ? styles.statusBtnActive : ''}`}
                  onClick={() => setStrategy('skip-duplicates')}
                  disabled={duplicates.length === 0}
                >
                  Skip duplicates
                </button>
              </div>
              {strategy === 'replace-all' && willDelete.length > 0 && (
                <p className={styles.warn} style={{ marginTop: 8 }}>
                  ⚠ This will <strong>delete {willDelete.length}</strong> existing restaurant{willDelete.length === 1 ? '' : 's'} not in this CSV
                  {willDelete.length <= 8
                    ? `: ${willDelete.map(r => r.name).join(', ')}.`
                    : '. You\'ll see the full list to confirm before it happens.'}
                </p>
              )}

              {parsed.length > 0 && (
                <>
                  <label className={styles.fieldLabel}>Preview (first 8)</label>
                  <div className={styles.previewList}>
                    {parsed.slice(0, 8).map((r, i) => (
                      <div key={i} className={styles.previewRow}>
                        <strong>{r.name}</strong>
                        <span className={styles.previewMeta}>{previewMeta(r)}</span>
                      </div>
                    ))}
                    {parsed.length > 8 && (
                      <div className={styles.previewRow}>
                        <span className={styles.previewMeta}>… and {parsed.length - 8} more</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className={styles.modalFooter}>
          <div className={styles.footerSpacer} />
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleImport}
            disabled={parsed.length === 0 || !nameMapped}
          >
            {strategy === 'replace-all'
              ? `Replace all (${parsed.length})`
              : strategy === 'skip-duplicates'
                ? `Import ${fresh.length}`
                : `Import ${parsed.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function RestaurantCard({ r, ratingAgg, distanceMiles, rank, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onClick, compact, drag }) {
  const isRetired = r.frequency === 'retired';
  // Stop card click from firing when the user taps a vote button.
  function stop(e) { e.stopPropagation(); }

  // Drag-to-reorder: spread the handlers onto the card root and show feedback —
  // dim while dragging, a top line on the row you're about to drop onto.
  const d = drag || {};
  const dragHandlers = d.draggable ? {
    draggable: true,
    onDragStart: d.onDragStart,
    onDragOver: d.onDragOver,
    onDrop: d.onDrop,
    onDragEnd: d.onDragEnd,
  } : {};
  const dragStyle = d.dragging
    ? { opacity: 0.4 }
    : d.over
      ? { boxShadow: 'inset 0 3px 0 0 #2563eb' }
      : undefined;

  // Compact list row: just rank + name (and the ▲▼ reorder arrows). Keeps the
  // ranked list dense so many places fit on screen at once; tap to open details.
  if (compact) {
    return (
      <button type="button" {...dragHandlers} style={dragStyle} className={`${styles.cardCompact} ${isRetired ? styles.cardRetired : ''}`} onClick={onClick}>
        {rank != null && <span className={styles.compactRank}>{rank}</span>}
        <span className={styles.compactName}>{r.name}</span>
        {/* Cuisine right beside the name: scanning this list is almost always
            "what do we feel like eating", and without it that question needs a
            tap into every row. First one only — a place tagged Thai + Noodles +
            Asian would push the name out of a row this tight; the rest are in
            the title and the +N. */}
        {r.cuisines?.length > 0 && (
          <span
            className={styles.compactCuisine}
            title={r.cuisines.length > 1 ? r.cuisines.join(' · ') : undefined}
          >
            {r.cuisines[0]}
            {r.cuisines.length > 1 && <span className={styles.compactCuisineMore}>+{r.cuisines.length - 1}</span>}
          </span>
        )}
        {r.status === 'want-to-try' && <span className={styles.wantBadge}>Want to try</span>}
        {isRetired && <span className={styles.retiredBadge}>Retired</span>}
        {!r._isMine && r._ownerUsername && (
          <span className={styles.ownerChip} title={`Shared by @${r._ownerUsername}`}>
            @{r._ownerUsername}
          </span>
        )}
        <span className={styles.compactSpacer} />
        {(onMoveUp || onMoveDown) && (
          <span className={styles.rankArrows} onClick={stop}>
            <button
              type="button"
              className={styles.rankArrow}
              title="Move up"
              disabled={!canMoveUp}
              onClick={(e) => { stop(e); onMoveUp && onMoveUp(); }}
            >▲</button>
            <button
              type="button"
              className={styles.rankArrow}
              title="Move down"
              disabled={!canMoveDown}
              onClick={(e) => { stop(e); onMoveDown && onMoveDown(); }}
            >▼</button>
          </span>
        )}
      </button>
    );
  }

  return (
    <button type="button" {...dragHandlers} style={dragStyle} className={`${styles.card} ${isRetired ? styles.cardRetired : ''}`} onClick={onClick}>
      {r.imageUrl
        ? <img src={r.imageUrl} alt="" className={styles.cardImage} />
        : <div className={`${styles.cardImage} ${styles.cardImagePlaceholder}`}>🍽️</div>}
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>{r.name}</h3>
          {r.status === 'want-to-try' && <span className={styles.wantBadge}>Want to try</span>}
          {isRetired && <span className={styles.retiredBadge}>Retired</span>}
          {!r._isMine && r._ownerUsername && (
            <span className={styles.ownerChip} title={`Shared by @${r._ownerUsername}`}>
              @{r._ownerUsername}
            </span>
          )}
          {ratingAgg && ratingAgg.voterCount > 0 && (
            <span
              className={styles.cardRatingBadge}
              title={`Group rating ${ratingAgg.overall.toFixed(1)}/5 · ${ratingAgg.voterCount} ${ratingAgg.voterCount === 1 ? 'vote' : 'votes'}`}
            >
              ★ {ratingAgg.overall.toFixed(1)} · {ratingAgg.voterCount}
            </span>
          )}
        </div>
        {rank != null && (
          <div className={styles.rankRow} onClick={stop}>
            <span className={styles.rankNum}>#{rank}</span>
            {(onMoveUp || onMoveDown) && (
              <span className={styles.rankArrows}>
                <button
                  type="button"
                  className={styles.rankArrow}
                  title="Move up"
                  disabled={!canMoveUp}
                  onClick={(e) => { stop(e); onMoveUp && onMoveUp(); }}
                >▲</button>
                <button
                  type="button"
                  className={styles.rankArrow}
                  title="Move down"
                  disabled={!canMoveDown}
                  onClick={(e) => { stop(e); onMoveDown && onMoveDown(); }}
                >▼</button>
              </span>
            )}
          </div>
        )}
        {(r.rating != null || r.ratingLabel) && (
          <div className={styles.cardStars}>
            {r.rating != null && [1, 2, 3, 4, 5].map(n => (
              <span key={n} className={n <= r.rating ? styles.starFilled : styles.starEmpty}>
                {n <= r.rating ? '★' : '☆'}
              </span>
            ))}
            {r.ratingLabel && <span className={styles.cardRatingLabel}>{r.ratingLabel}</span>}
          </div>
        )}
        {(bucketsOf(r).length > 0 || healthOf(r)) && (
          <div className={styles.cardBuckets}>
            {bucketsOf(r).map(k => (
              <span key={k} className={styles.bucketChip}>
                {BUCKETS.find(b => b.key === k)?.icon} {bucketLabel(k)}
              </span>
            ))}
            {/* Colour-coded rather than another neutral chip — the whole value
                of the tag is being able to spot it without reading. */}
            {healthOf(r) && (
              <span className={healthOf(r) === 'healthy' ? styles.healthChipGood : styles.healthChipBad}>
                {healthOption(healthOf(r))?.icon} {healthOption(healthOf(r))?.label}
              </span>
            )}
          </div>
        )}
        {(r.cuisines?.length > 0 || r.locations?.length > 0 || r.frequency) && (
          <div className={styles.cardMeta}>
            {[
              ...(r.cuisines || []),
              ...(r.locations || []),
              r.frequency === 'special' ? 'Special' : null,
              r.frequency === 'regular' ? 'Regular' : null,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
        {r.dish && <div className={styles.cardDish}>🍴 {r.dish}</div>}
        {r.address && <div className={styles.cardAddress}>📍 {r.address}</div>}
        {distanceMiles != null && (
          <div className={styles.cardDistance}>{distanceMiles.toFixed(1)} mi away</div>
        )}
        {r.lastVisit && (
          <div className={styles.cardLastVisit}>Last visit: {formatDate(r.lastVisit)}</div>
        )}
        {/* Been here, never filed it. Says WHICH is missing — "needs
            attention" would leave you opening the spot to find out. */}
        {missingCategories(r).length > 0 && (
          <div className={styles.cardGap}>
            ⚠ No {missingCategories(r).join(' or ')} set
          </div>
        )}
        {r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cardLink}
            onClick={e => e.stopPropagation()}
          >
            {r.url}
          </a>
        )}
      </div>
    </button>
  );
}

/**
 * Rankings tab — the places you've all rated, ordered by the group's score.
 * Reads the same live `ratingsBySpot` the card badges use, and ranks whatever
 * the current filters/search leave visible, so "best Italian in Williamsburg"
 * is just the ranking with those filters on.
 */
function RestaurantRankings({ items, ratingsBySpot, metric, onMetricChange, onSelect }) {
  const metrics = useMemo(() => rankMetricsFor(items, ratingsBySpot), [items, ratingsBySpot]);
  // The chosen metric can vanish when filters change (rank by Coffee, then
  // filter to spots nobody rated on Coffee) — fall back to Overall rather than
  // showing an empty list under a button that's no longer there.
  const activeMetric = metrics.some(m => m.key === metric) ? metric : 'overall';
  const { ranked, unrated } = useMemo(
    () => rankSpotsByRating(items, ratingsBySpot, activeMetric),
    [items, ratingsBySpot, activeMetric],
  );
  const metricLabel = metrics.find(m => m.key === activeMetric)?.label || 'Overall';

  return (
    <div className={styles.rankingsView}>
      <div className={styles.filterRow} style={{ alignSelf: 'flex-start' }}>
        {metrics.map(m => (
          <button
            key={m.key}
            type="button"
            className={`${styles.filterBtn} ${activeMetric === m.key ? styles.filterBtnActive : ''}`}
            onClick={() => onMetricChange(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {ranked.length === 0 ? (
        <p className={styles.rankingEmpty}>
          Nothing rated for {metricLabel} yet — open a place and fill in the Ratings table.
        </p>
      ) : (
        <ol className={styles.rankingList}>
          {ranked.map((row, i) => (
            <li key={`${row.r._ownerUid}:${row.r.id}`}>
              <button type="button" className={styles.rankingRow} onClick={() => onSelect(row.r)}>
                <span className={styles.rankingPlace}>{RANKING_MEDAL[i + 1] || i + 1}</span>
                <span className={styles.rankingName}>
                  {row.r.name}
                  {row.r._ownerUsername && (
                    <span className={styles.rankingOwner}> @{row.r._ownerUsername}</span>
                  )}
                </span>
                <span className={styles.rankingScore}>{row.score.toFixed(1)}</span>
                <StarsStatic value={row.score} size={14} />
                <span className={styles.rankingVotes}>
                  {row.votes} {row.votes === 1 ? 'vote' : 'votes'}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {unrated.length > 0 && (
        <p className={styles.rankingUnrated}>
          Not yet rated for {metricLabel}: {unrated.length} place{unrated.length === 1 ? '' : 's'}
          {' — '}{unrated.slice(0, 6).map(r => r.name).join(', ')}{unrated.length > 6 ? '…' : ''}
        </p>
      )}
    </div>
  );
}

/**
 * The ranking for one group, popped over the page when you filter to it — the
 * same view the Rankings tab shows, so you get "best coffee" without leaving
 * List/Table/Map. Ranks `visible`, which the click that opened this already
 * narrowed to the group, so it tracks any further filter change.
 *
 * Esc closes it, like the other sheets on this page.
 */
function RankingPopout({ label, items, ratingsBySpot, metric, onMetricChange, onSelect, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Top {label}</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <RestaurantRankings
            items={items}
            ratingsBySpot={ratingsBySpot}
            metric={metric}
            onMetricChange={onMetricChange}
            onSelect={onSelect}
          />
        </div>
        <div className={styles.modalFooter}>
          <span className={styles.footerSpacer} />
          <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function RestaurantMapView({ items, onSelect }) {
  const mapPoints = useMemo(() => {
    const out = [];
    for (const r of items) {
      const lat = coerceCoord(r.lat);
      const lng = coerceCoord(r.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        out.push({ ...r, lat, lng });
      }
    }
    if (out.length === 0 && items.length > 0) {
      // Surfaces type/value of the first few records when nothing plots —
      // helps diagnose "coords stored as something weird" cases.
      // eslint-disable-next-line no-console
      console.warn('[Map] no plottable points from', items.length, 'items. Sample:',
        items.slice(0, 3).map(r => ({
          name: r.name,
          lat: r.lat, latType: typeof r.lat,
          lng: r.lng, lngType: typeof r.lng,
        })),
      );
    }
    return out;
  }, [items]);
  const missing = items.length - mapPoints.length;

  return (
    <div className={styles.mapWrap}>
      {missing > 0 && (
        <div className={styles.mapHint}>
          {missing} restaurant{missing === 1 ? '' : 's'} without an address {missing === 1 ? "isn't" : "aren't"} shown.
          Open one and tap <strong>Lookup</strong> to geocode it.
        </div>
      )}
      <div className={styles.mapContainer}>
        <MapContainer
          center={DEFAULT_MAP_CENTER}
          zoom={DEFAULT_MAP_ZOOM}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mapPoints.map(r => (
            <Marker
              key={r.id}
              position={[r.lat, r.lng]}
              icon={markerIconFor(r)}
            >
              <Popup>
                <div className={styles.mapPopup}>
                  <strong>{r.name}</strong>
                  {r.takenJoanne && (
                    <div className={styles.mapPopupMeta} style={{ color: JOANNE_COLOR, fontWeight: 600 }}>
                      Taken Joanne here
                    </div>
                  )}
                  {r.address && <div className={styles.mapPopupMeta}>{r.address}</div>}
                  {r.cuisines?.length > 0 && (
                    <div className={styles.mapPopupMeta}>{r.cuisines.join(' · ')}</div>
                  )}
                  <button
                    type="button"
                    className={styles.mapPopupBtn}
                    onClick={() => onSelect(r)}
                  >
                    Open
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className={styles.mapLegend}>
        <span className={styles.mapLegendItem}>
          <span className={styles.mapLegendDot} style={{ background: VISITED_COLOR }} /> Visited
        </span>
        <span className={styles.mapLegendItem}>
          <span className={styles.mapLegendDot} style={{ background: WANT_COLOR }} /> Want to try
        </span>
        <span className={styles.mapLegendItem}>
          <span className={styles.mapLegendDot} style={{ background: JOANNE_COLOR }} /> Taken Joanne
        </span>
      </div>
    </div>
  );
}

function RestaurantTable({ items, allItems, onRowClick, myRestaurantIds, bulkUpdate, bulkDelete, cuisineSuggestions = [], locationSuggestions = [], rankCtx = null }) {
  // Duplicates are found across the WHOLE list, not the filtered view: a second
  // copy hidden by the current search or a status filter is still a duplicate,
  // and only learning about it when a filter happens to show both is exactly
  // how two rows for one place survive.
  const duplicates = useMemo(() => findDuplicateSpots(allItems || items), [allItems, items]);
  const rankActive = !!rankCtx?.active;
  const RANK_COL_W = 92;
  // Merge stored prefs over column defaults so columns added later keep their
  // built-in defaults while user preferences override visibility + width.
  const [prefs, setPrefs] = useState(loadTablePrefs);
  const [showSettings, setShowSettings] = useState(false);
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const resizingRef = useRef(null);

  // Bulk-edit selection (only restaurants on my own list are selectable).
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [tagField, setTagField] = useState('cuisines');
  const [tagValue, setTagValue] = useState('');
  const [bulkBucket, setBulkBucket] = useState(BUCKETS[0].key);
  const canSelect = !!myRestaurantIds && !!bulkUpdate;
  const [bulkMode, setBulkMode] = useState(false);
  const showSelect = canSelect && bulkMode;

  const selectableItems = useMemo(
    () => (canSelect ? items.filter(r => myRestaurantIds.has(r.id)) : []),
    [items, myRestaurantIds, canSelect],
  );
  // Act only on selections that are currently visible — a filter change hides
  // rows but keeps the selection, so we intersect with visible at apply time
  // (no effect needed to prune stale ids).
  const selectedVisibleIds = useMemo(
    () => selectableItems.filter(r => selectedIds.has(r.id)).map(r => r.id),
    [selectableItems, selectedIds],
  );
  const selectedCount = selectedVisibleIds.length;
  const allSelected = selectableItems.length > 0 && selectedCount === selectableItems.length;

  function toggleRow(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableItems.map(r => r.id)));
  }
  function clearSelection() { setSelectedIds(new Set()); }

  function applyUpdate(updater) {
    if (selectedCount === 0) return;
    bulkUpdate(new Set(selectedVisibleIds), updater);
  }
  function applyTag(remove) {
    const value = tagValue.trim();
    if (!value) return;
    applyUpdate(r => {
      const arr = r[tagField] || [];
      if (remove) return { [tagField]: arr.filter(x => x.toLowerCase() !== value.toLowerCase()) };
      if (arr.some(x => x.toLowerCase() === value.toLowerCase())) return null;
      return { [tagField]: [...arr, value] };
    });
    setTagValue('');
  }
  // Add/remove a bucket across the selected spots. Multi-valued, so this edits
  // the array rather than replacing it; mealType is kept as the primary for
  // legacy consumers (see EditModal.handleSave).
  function applyBucket(key, remove) {
    applyUpdate(r => {
      const cur = bucketsOf(r);
      if (remove ? !cur.includes(key) : cur.includes(key)) return null;
      const next = remove ? cur.filter(k => k !== key) : [...cur, key];
      return { buckets: next, mealType: next[0] || undefined };
    });
  }
  function handleBulkDelete() {
    if (selectedCount === 0) return;
    if (!window.confirm(`Delete ${selectedCount} selected place${selectedCount === 1 ? '' : 's'}? This can't be undone.`)) return;
    bulkDelete(new Set(selectedVisibleIds));
    clearSelection();
  }

  const columns = useMemo(() => TABLE_COLUMNS.map(c => {
    const p = prefs[c.key] || {};
    return {
      ...c,
      visible: typeof p.visible === 'boolean' ? p.visible : c.visible,
      width: typeof p.width === 'number' && p.width >= 60 ? p.width : c.width,
    };
  }), [prefs]);
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  const updatePref = useCallback((key, patch) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      saveTablePrefs(next);
      return next;
    });
  }, []);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    // While ranking a dimension, the manual order wins over column sort so the
    // ▲▼ arrows visibly reorder rows. Ranked spots first (by position), the
    // rest after, alphabetically.
    if (rankActive) {
      arr.sort((a, b) => {
        const pa = rankCtx.positionOf(a.id);
        const pb = rankCtx.positionOf(b.id);
        const va = pa == null ? Infinity : pa;
        const vb = pb == null ? Infinity : pb;
        if (va !== vb) return va - vb;
        return compareValues(a, b, 'name');
      });
      return arr;
    }
    arr.sort((a, b) => compareValues(a, b, sort.key));
    if (sort.dir === 'desc') arr.reverse();
    return arr;
  }, [items, sort, rankActive, rankCtx]);

  // Column resize: pointer-down on the handle starts a drag, listeners on
  // window pick up the rest so the drag continues outside the header cell.
  function startResize(e, colKey, startWidth) {
    e.preventDefault();
    resizingRef.current = { colKey, startWidth, startX: e.clientX };
    function onMove(ev) {
      const r = resizingRef.current;
      if (!r) return;
      const delta = ev.clientX - r.startX;
      const next = Math.max(60, Math.round(r.startWidth + delta));
      updatePref(r.colKey, { width: next });
    }
    function onUp() {
      resizingRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    }
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function toggleSort(key) {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  }

  function resetColumns() {
    setPrefs({});
    saveTablePrefs({});
  }

  const SELECT_COL_W = 40;
  const totalWidth = visibleColumns.reduce((s, c) => s + c.width, 0)
    + (showSelect ? SELECT_COL_W : 0)
    + (rankActive ? RANK_COL_W : 0);

  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableToolbar}>
        <span className={styles.tableCount}>{items.length} restaurant{items.length === 1 ? '' : 's'}</span>
        <div className={styles.tableSpacer} />
        {canSelect && (
          <button
            type="button"
            className={bulkMode ? styles.bulkToggleActive : styles.bulkToggle}
            onClick={() => { if (bulkMode) clearSelection(); setBulkMode(v => !v); }}
          >
            {bulkMode ? '✓ Bulk edit' : 'Bulk edit'}
          </button>
        )}
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => setShowSettings(v => !v)}
        >
          ⚙ Columns ({visibleColumns.length}/{columns.length})
        </button>
      </div>

      {showSelect && selectedCount > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selectedCount} selected</span>

          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Status</span>
            {FILTERS.filter(f => f.key !== 'all').map(f => (
              <button key={f.key} type="button" className={styles.bulkBtn}
                onClick={() => applyUpdate(() => ({ status: f.key }))}>{f.label}</button>
            ))}
          </div>

          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Frequency</span>
            {FREQUENCIES.map(f => (
              <button key={f.key} type="button" className={styles.bulkBtn}
                onClick={() => applyUpdate(() => ({ frequency: f.key }))}>{f.label}</button>
            ))}
          </div>

          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Rating</span>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" className={styles.bulkBtn}
                onClick={() => applyUpdate(() => ({ rating: n }))}>{n}★</button>
            ))}
            <button type="button" className={styles.bulkBtn}
              onClick={() => applyUpdate(() => ({ rating: null }))}>✕</button>
          </div>

          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Bucket</span>
            <select className={styles.bulkSelect} value={bulkBucket} onChange={e => setBulkBucket(e.target.value)}>
              {BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <button type="button" className={styles.bulkBtn} onClick={() => applyBucket(bulkBucket, false)}>+ Add</button>
            <button type="button" className={styles.bulkBtn} onClick={() => applyBucket(bulkBucket, true)}>− Remove</button>
          </div>

          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Tag</span>
            <select className={styles.bulkSelect} value={tagField} onChange={e => setTagField(e.target.value)}>
              <option value="cuisines">Cuisine</option>
              <option value="locations">Location</option>
            </select>
            <input className={styles.bulkInput} list="bulk-tag-suggestions" value={tagValue}
              onChange={e => setTagValue(e.target.value)} placeholder="value"
              onKeyDown={e => { if (e.key === 'Enter') applyTag(false); }} />
            <datalist id="bulk-tag-suggestions">
              {(tagField === 'cuisines' ? cuisineSuggestions : locationSuggestions).map(s => <option key={s} value={s} />)}
            </datalist>
            <button type="button" className={styles.bulkBtn} onClick={() => applyTag(false)}>+ Add</button>
            <button type="button" className={styles.bulkBtn} onClick={() => applyTag(true)}>− Remove</button>
          </div>

          <div className={styles.tableSpacer} />
          <button type="button" className={styles.bulkDeleteBtn} onClick={handleBulkDelete}>Delete</button>
          <button type="button" className={styles.linkBtn} onClick={clearSelection}>Clear</button>
        </div>
      )}
      {showSettings && (
        <div className={styles.tableSettingsPopover}>
          <div className={styles.tableSettingsHeader}>
            <span>Show columns</span>
            <button type="button" className={styles.linkBtn} onClick={resetColumns}>
              Reset
            </button>
          </div>
          <div className={styles.tableSettingsGrid}>
            {columns.map(c => (
              <label key={c.key} className={styles.tableSettingsItem}>
                <input
                  type="checkbox"
                  checked={c.visible}
                  onChange={() => updatePref(c.key, { visible: !c.visible })}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>Nothing matches the current filters.</p>
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable} style={{ width: totalWidth }}>
            <colgroup>
              {rankActive && <col style={{ width: RANK_COL_W }} />}
              {showSelect && <col style={{ width: SELECT_COL_W }} />}
              {visibleColumns.map(c => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {rankActive && (
                  <th style={{ width: RANK_COL_W, textAlign: 'center' }} title={`Your ranking within ${rankCtx.label}`}>
                    Rank
                  </th>
                )}
                {showSelect && (
                  <th style={{ width: SELECT_COL_W, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      title={allSelected ? 'Deselect all' : 'Select all'}
                    />
                  </th>
                )}
                {visibleColumns.map(c => {
                  const isSorted = sort.key === c.key;
                  return (
                    <th key={c.key} style={{ width: c.width }}>
                      <button
                        type="button"
                        className={styles.tableHeaderBtn}
                        onClick={() => toggleSort(c.key)}
                      >
                        <span>{c.label}</span>
                        <span className={styles.tableSortIndicator}>
                          {isSorted ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                      <span
                        className={styles.tableColResizer}
                        onPointerDown={e => startResize(e, c.key, c.width)}
                        title="Drag to resize column"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map(r => {
                const rankPos = rankActive ? rankCtx.positionOf(r.id) : null;
                // Anyone with access can reorder the shared list (a rejected
                // write surfaces via persistOwner's alert), so don't gate on
                // "is this my own restaurant".
                const canRank = rankActive && rankPos != null;
                return (
                <tr key={r.id} className={styles.tableRow} onClick={() => onRowClick(r)}>
                  {rankActive && (
                    <td style={{ width: RANK_COL_W }} onClick={e => e.stopPropagation()}>
                      {canRank ? (
                        <div className={styles.rankCell}>
                          <span className={styles.rankNum}>{rankPos}</span>
                          <span className={styles.rankArrows}>
                            <button
                              type="button"
                              className={styles.rankArrow}
                              title="Move up"
                              disabled={rankPos <= 1}
                              onClick={() => rankCtx.onMove(r.id, 'up')}
                            >▲</button>
                            <button
                              type="button"
                              className={styles.rankArrow}
                              title="Move down"
                              onClick={() => rankCtx.onMove(r.id, 'down')}
                            >▼</button>
                          </span>
                        </div>
                      ) : (
                        <span className={styles.rankNum}>—</span>
                      )}
                    </td>
                  )}
                  {showSelect && (
                    <td style={{ width: SELECT_COL_W, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      {myRestaurantIds.has(r.id) ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleRow(r.id)}
                        />
                      ) : null}
                    </td>
                  )}
                  {visibleColumns.map(c => {
                    const value = cellValueFor(r, c.key);
                    if (c.key === 'takenJoanne' && r.takenJoanne) {
                      return (
                        <td key={c.key} style={{ width: c.width, color: JOANNE_COLOR, fontWeight: 700, textAlign: 'center' }}>
                          ✓
                        </td>
                      );
                    }
                    if (c.key === 'rating' && r.rating != null) {
                      return (
                        <td key={c.key} style={{ width: c.width, color: '#F5A623' }}>
                          {value}
                        </td>
                      );
                    }
                    if (c.key === 'url' && r.url) {
                      return (
                        <td key={c.key} style={{ width: c.width }}>
                          <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                            {value}
                          </a>
                        </td>
                      );
                    }
                    if (c.key === 'name') {
                      // The flag sits on the name, which is what you read first
                      // and what you'd compare against the other row. It says
                      // "possible" and never hides or merges anything — two
                      // branches of a chain SHOULD be two rows, and the page
                      // can't tell those from a genuine double-entry.
                      const dupe = duplicates.get(r.id);
                      const why = duplicateReason(dupe);
                      return (
                        <td key={c.key} style={{ width: c.width }} title={why || (value && value.length > 60 ? value : undefined)}>
                          {value}
                          {why && <span className={styles.dupeFlag} aria-label={why}> ⚠</span>}
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} style={{ width: c.width }} title={value && value.length > 60 ? value : undefined}>
                        {value}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// One list (Cuisines or Categories) inside the ⚙ popup. This is the old
// left-sidebar menu relocated here: every row filters the page on click (and
// closes the popup), and each row carries a hover control to manage the master
// list — remove a curated entry, or add an in-use-but-unlisted tag. Edits
// persist immediately (onSetValues), so filtering and managing never collide.
function MasterListSection({ title, help, itemPrefix = '', values, counts, activeFilter, onFilter, onSetValues, placeholder }) {
  const [draft, setDraft] = useState('');

  const add = (raw) => {
    const cleaned = (raw || '').trim();
    if (!cleaned) return;
    if (values.some(v => v.toLowerCase() === cleaned.toLowerCase())) { setDraft(''); return; }
    onSetValues([...values, cleaned]);
    setDraft('');
  };
  const remove = (name) => onSetValues(values.filter(v => v !== name));

  // Tags used on a spot (mine or a friend's) that aren't curated yet — offered
  // as "+ add to list" so the master list stays the source for the menu.
  const listedLower = new Set(values.map(v => v.toLowerCase()));
  const notListed = Array.from(counts.keys())
    .filter(n => !listedLower.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const sortedValues = [...values].sort((a, b) => a.localeCompare(b));

  return (
    <div className={styles.masterSection}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarTitle}>{title}</span>
        <span className={styles.sidebarCount}>{values.length}</span>
      </div>
      <p className={styles.hintText}>{help}</p>

      <button
        type="button"
        className={`${styles.sidebarItem} ${!activeFilter ? styles.sidebarItemActive : ''}`}
        onClick={() => onFilter(null)}
      >
        <span className={styles.sidebarItemName}>All {title.toLowerCase()}</span>
      </button>

      {sortedValues.length === 0 && notListed.length === 0 && (
        <div className={styles.sidebarEmpty}>Nothing yet — add one below.</div>
      )}

      {sortedValues.map(v => {
        const n = counts.get(v) || 0;
        return (
          <div key={`v-${v}`} className={styles.sidebarItemRow}>
            <button
              type="button"
              className={`${styles.sidebarItem} ${activeFilter === v ? styles.sidebarItemActive : ''} ${n === 0 ? styles.sidebarItemDim : ''}`}
              onClick={() => onFilter(v)}
            >
              <span className={styles.sidebarItemName}>{itemPrefix}{v}</span>
              <span className={styles.sidebarItemCount}>{n}</span>
            </button>
            <button
              type="button"
              className={styles.sidebarRenameBtn}
              onClick={() => remove(v)}
              title={`Remove "${v}" from the list`}
              aria-label={`Remove ${v}`}
            >
              ✕
            </button>
          </div>
        );
      })}

      {notListed.length > 0 && (
        <p className={styles.masterSubhead}>In use, not on your list</p>
      )}
      {notListed.map(n => (
        <div key={`u-${n}`} className={styles.sidebarItemRow}>
          <button
            type="button"
            className={`${styles.sidebarItem} ${activeFilter === n ? styles.sidebarItemActive : ''}`}
            onClick={() => onFilter(n)}
          >
            <span className={styles.sidebarItemName}>{itemPrefix}{n}</span>
            <span className={styles.sidebarItemCount}>{counts.get(n)}</span>
          </button>
          <button
            type="button"
            className={styles.sidebarRenameBtn}
            onClick={() => add(n)}
            title={`Add "${n}" to the list`}
            aria-label={`Add ${n} to the list`}
          >
            +
          </button>
        </div>
      ))}

      <input
        type="text"
        className={styles.input}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
        onBlur={() => add(draft)}
        placeholder={placeholder}
      />
    </div>
  );
}

// Editor for the bucket list itself — add, rename, re-icon, reorder, delete.
// Keys are frozen once assigned (rename only touches the label) so existing spot
// assignments never break. Deleting a bucket just removes its definition; spots
// tagged with it fall back to Unsorted (bucketsOf filters unknown keys). Save
// writes users/{uid}.eatingOutBuckets, shared with mobile.
function BucketSettingsModal({ buckets, counts, onSave, onClose }) {
  // Editable draft: each row keeps its original key (undefined for new rows).
  // `ratingCategories` undefined means "use the built-in set for this bucket" —
  // it only becomes an explicit list once you customise it.
  const [rows, setRows] = useState(() => buckets.map(b => ({
    key: b.key,
    label: b.label,
    icon: b.icon,
    ratingCategories: sanitizeRatingCategories(b.ratingCategories).length
      ? sanitizeRatingCategories(b.ratingCategories)
      : undefined,
  })));
  // Which bucket's rating categories are open. One at a time keeps the modal
  // from turning into a wall of inputs.
  const [openCats, setOpenCats] = useState(null);

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(rs => [...rs, { key: undefined, label: '', icon: '🍴' }]);
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i));
  const move = (i, dir) => setRows(rs => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const next = rs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  // What a row rates on right now — its own list once customised, else the
  // built-in set for that bucket key (or the base four for a brand-new bucket).
  const catsFor = (r) => r.ratingCategories
    || DEFAULT_BUCKET_RATING_CATEGORIES[r.key]
    || BASE_RATING_CATEGORIES;
  const setCats = (i, next) => setRow(i, { ratingCategories: next });
  const editCat = (i, ci, label) => setCats(i, catsFor(rows[i]).map((c, j) => (j === ci ? { ...c, label } : c)));
  const addCat = (i) => setCats(i, [...catsFor(rows[i]), { key: undefined, label: '' }]);
  const removeCat = (i, ci) => setCats(i, catsFor(rows[i]).filter((_, j) => j !== ci));
  const resetCats = (i) => setRow(i, { ratingCategories: undefined });

  const handleSave = () => {
    // Assign keys to new rows (slug of label, unique), drop blank-label rows.
    const used = new Set(rows.map(r => r.key).filter(Boolean));
    const out = [];
    for (const r of rows) {
      const label = (r.label || '').trim();
      if (!label) continue;
      const key = r.key || makeBucketKey(label, used);
      const bucket = { key, label, icon: (r.icon || '').trim() || '🍴' };
      if (r.ratingCategories) {
        // Existing categories keep their key so the votes already cast under it
        // survive a rename; a new one gets a slug of its label, deliberately
        // NOT uniquified so the same name means the same thing across buckets.
        const cats = [];
        const seen = new Set();
        for (const c of r.ratingCategories) {
          const cl = (c.label || '').trim();
          if (!cl) continue;
          const ck = c.key || makeRatingKey(cl);
          if (seen.has(ck)) continue;
          seen.add(ck);
          cats.push({ key: ck, label: cl });
        }
        if (cats.length) bucket.ratingCategories = cats;
      }
      out.push(bucket);
    }
    onSave(out);
    onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Edit buckets</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.hintText} style={{ marginTop: 0 }}>
            Rename a bucket or change its emoji, reorder with ▲▼, or ＋ add your own.
            Deleting a bucket just moves its spots to Unsorted — nothing is lost.
            ★ sets the categories spots in that bucket are rated on.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    className={styles.input}
                    style={{ width: 52, textAlign: 'center', flex: '0 0 auto' }}
                    value={r.icon}
                    onChange={e => setRow(i, { icon: e.target.value })}
                    aria-label="Emoji"
                    maxLength={4}
                  />
                  <input
                    className={styles.input}
                    style={{ flex: 1 }}
                    value={r.label}
                    onChange={e => setRow(i, { label: e.target.value })}
                    placeholder="Bucket name"
                    aria-label="Bucket name"
                  />
                  {r.key && counts?.get(r.key) ? (
                    <span className={styles.hintText} style={{ flex: '0 0 auto' }} title="spots in this bucket">{counts.get(r.key)}</span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => setOpenCats(openCats === i ? null : i)}
                    title={`Rating categories for ${r.label || 'this bucket'}`}
                    aria-expanded={openCats === i}
                  >{openCats === i ? '★' : '☆'}</button>
                  <button type="button" className={styles.iconBtn} onClick={() => move(i, -1)} disabled={i === 0} title="Move up">▲</button>
                  <button type="button" className={styles.iconBtn} onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down">▼</button>
                  <button type="button" className={styles.iconBtn} onClick={() => removeRow(i)} title="Delete bucket">🗑️</button>
                </div>

                {openCats === i && (
                  <div className={styles.bucketRatingPanel}>
                    <p className={styles.hintText} style={{ marginTop: 0 }}>
                      What spots in <strong>{r.label || 'this bucket'}</strong> get rated on.
                      Renaming a category keeps the ratings already given; removing one stops
                      it being asked for, but past scores still show on the spot.
                      {!r.ratingCategories && ' Using the built-in set — edit anything to make it your own.'}
                    </p>
                    {catsFor(r).map((c, ci) => (
                      <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          className={styles.input}
                          style={{ flex: 1 }}
                          value={c.label}
                          onChange={e => editCat(i, ci, e.target.value)}
                          placeholder="Category name"
                          aria-label="Rating category name"
                        />
                        <button type="button" className={styles.iconBtn} onClick={() => removeCat(i, ci)} title="Remove category">🗑️</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button type="button" className={styles.secondaryBtn} onClick={() => addCat(i)}>＋ Add category</button>
                      {r.ratingCategories && (
                        <button type="button" className={styles.iconBtn} onClick={() => resetCats(i)} title="Back to the built-in categories">Reset</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button type="button" className={styles.secondaryBtn} style={{ marginTop: 12 }} onClick={addRow}>＋ Add bucket</button>
        </div>
        <div className={styles.modalFooter}>
          <div className={styles.footerSpacer} />
          <button type="button" className={styles.iconBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// The ⚙ popup: the single home for Cuisines & Categories. Filter the page from
// here (click a row) and manage the master lists in the same place. Soft source
// of truth — the lists seed the menu + edit-modal suggestions, but free-text
// tags on an individual spot still work.
function MasterListSettingsModal({
  cuisines, categories, cuisineCounts, categoryCounts,
  activeCuisine, activeCategory, onFilterCuisine, onFilterCategory,
  onSetCuisines, onSetCategories, onClose,
}) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Cuisines & Categories</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <MasterListSection
            title="Cuisines"
            help="Click one to filter the list. Hover a row to remove it, or ＋ an in-use tag to add it."
            values={cuisines}
            counts={cuisineCounts}
            activeFilter={activeCuisine}
            onFilter={onFilterCuisine}
            onSetValues={onSetCuisines}
            placeholder="Add a cuisine and press Enter"
          />
          <MasterListSection
            title="Categories"
            help="Voting buckets (e.g. Date night). Click one to filter; hover to remove or ＋ add."
            itemPrefix="🏷 "
            values={categories}
            counts={categoryCounts}
            activeFilter={activeCategory}
            onFilter={onFilterCategory}
            onSetValues={onSetCategories}
            placeholder="Add a category and press Enter"
          />
        </div>
        <div className={styles.modalFooter}>
          <div className={styles.footerSpacer} />
          <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function EatingOutPage({ user, sharedFromFriends = [], votesFromFriends = [], onClose, initialCategory = null, onFriendsChanged }) {
  // Per-owner restaurant arrays. Shape:
  //   { [ownerUid]: { username, restaurants } }
  // `user.uid` is always present (my own list). Each entry from
  // `sharedFromFriends` adds an owner whose list I can also see/edit.
  const [ownerData, setOwnerData] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [activeCuisine, setActiveCuisine] = useState(null);
  // Default the neighborhood filter to Williamsburg (the app's home area — also
  // the map's default center). Case-insensitive match downstream, so the exact
  // stored casing doesn't matter; toggling the Williamsburg pill clears it.
  const [activeLocation, setActiveLocation] = useState('Williamsburg');
  const [activeBucket, setActiveBucket] = useState(null);
  const [activeHealth, setActiveHealth] = useState(null);
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [showRetired, setShowRetired] = useState(false);
  const [proximityQuery, setProximityQuery] = useState('');
  const [proximityCenter, setProximityCenter] = useState(null);
  const [proximityResolving, setProximityResolving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null); // friend's spot → rank + comment sheet
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bucketsOpen, setBucketsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  // The user's editable bucket list (users/{uid}.eatingOutBuckets), mirrored into
  // the module-level BUCKETS by applyBucketConfig so the helpers see it. Seeds
  // from DEFAULT_BUCKETS until they've saved their own.
  const [bucketConfig, setBucketConfig] = useState(DEFAULT_BUCKETS);
  // My curated master vocabulary, loaded from my own user doc. `null` = never
  // saved (so the settings editor seeds itself from whatever tags are already
  // in use). These seed suggestions + the sidebar; they don't restrict what
  // can be typed on a spot — see cuisineSuggestions / categorySuggestions.
  const [masterCuisines, setMasterCuisines] = useState(null);
  const [masterCategories, setMasterCategories] = useState(null);
  // Default to List view — it's where the ranking controls live, so voting is
  // visible without switching. (Table/Map remain one tap away.)
  const [viewMode, setViewMode] = useState('list');
  // Which score the Rankings tab orders by — 'overall' or one rating category.
  const [rankMetric, setRankMetric] = useState('overall');
  // Label of the group whose ranking is popped out over the page, or null.
  // Filtering to a location/bucket already narrows `visible`, so the pop-out
  // just ranks that — no separate scoping to keep in step.
  const [rankingPopout, setRankingPopout] = useState(null);
  // List density: 'compact' shows just rank + name (more places per screen),
  // 'detailed' shows the full cards with photos/ratings. Persisted per browser.
  const [listDensity, setListDensity] = useState(() => {
    try { return localStorage.getItem('sunday-eating-out-density') === 'detailed' ? 'detailed' : 'compact'; }
    catch { return 'compact'; }
  });
  const setDensity = useCallback((d) => {
    setListDensity(d);
    try { localStorage.setItem('sunday-eating-out-density', d); } catch { /* ignore */ }
  }, []);
  const [geocodingProgress, setGeocodingProgress] = useState(null);
  const cancelGeocodeRef = useRef(false);
  // Live collaborative ratings for every visible owner's spots, keyed
  // `${ownerUid}__${spotId}` → rating docs. Feeds the compact card badge; the
  // detail/edit view subscribes per-spot for the full input + breakdown.
  const [ratingsBySpot, setRatingsBySpot] = useState({});

  // Subscribe to my own doc + every friend who has shared their list with me.
  // Each subscription updates only its slice of ownerData so changes by either
  // party (truly shared list) propagate live.
  const sharerUids = useMemo(
    () => sharedFromFriends.map(s => s.uid).filter(Boolean).join('|'),
    [sharedFromFriends],
  );
  const sharerMeta = useMemo(() => {
    const m = {};
    for (const s of sharedFromFriends) m[s.uid] = s.username || 'friend';
    return m;
  }, [sharedFromFriends]);
  useEffect(() => {
    if (!user?.uid) {
      setOwnerData({});
      setLoading(false);
      return;
    }
    const ownerUids = [user.uid, ...sharerUids.split('|').filter(Boolean)];
    // The list itself moved to users/{uid}/data/eatingOut, so each owner needs
    // two listeners: the subdoc for the spots, and the user doc for the things
    // that stayed on it (username, master cuisine/category lists, buckets).
    const listUnsubs = ownerUids.map(uid => subscribeRestaurants(uid, (rows) => {
      setOwnerData(prev => ({
        ...prev,
        [uid]: { username: prev[uid]?.username ?? (uid === user.uid ? null : (sharerMeta[uid] || 'friend')), restaurants: rows },
      }));
      setLoading(false);
    }));
    const unsubs = ownerUids.map(uid => {
      const ref = doc(db, 'users', uid);
      return onSnapshot(
        ref,
        (snap) => {
          if (snap.metadata.hasPendingWrites && uid === user.uid) return;
          const data = snap.data() || {};
          // Legacy fallback only: an account not migrated yet still carries the
          // array here. Once it's gone the subdoc listener above owns the list.
          const legacy = Array.isArray(data.restaurants) ? data.restaurants : null;
          const username = uid === user.uid ? null : (sharerMeta[uid] || data.username || 'friend');
          if (uid === user.uid) {
            // Master vocabulary lives on my own doc only. Keep `null` when the
            // fields are absent so the editor knows to seed from used tags.
            setMasterCuisines(Array.isArray(data.eatingOutCuisines) ? data.eatingOutCuisines : null);
            setMasterCategories(Array.isArray(data.eatingOutCategories) ? data.eatingOutCategories : null);
            // Bucket definitions are editable + shared with mobile. Mirror into
            // the module-level BUCKETS (in this callback, before the re-render)
            // so every helper/chip reflects the saved list.
            const eff = effectiveBucketConfig(data.eatingOutBuckets);
            applyBucketConfig(eff);
            setBucketConfig(eff);
          }
          setOwnerData(prev => ({
            ...prev,
            [uid]: {
              username,
              restaurants: (prev[uid]?.restaurants?.length ? prev[uid].restaurants : (legacy || prev[uid]?.restaurants || [])),
            },
          }));
          setLoading(false);
        },
        (err) => {
          // Friends without share-grant will reject on the listener; ignore.
          if (uid !== user.uid) return;
          console.error('EatingOutPage subscription error:', err);
          setLoading(false);
        },
      );
    });
    return () => { unsubs.forEach(u => u && u()); listUnsubs.forEach(u => u && u()); };
  }, [user?.uid, sharerUids, sharerMeta]);

  // Live ratings for every visible owner's spots (one subscription for the whole
  // list) so cards can show a compact aggregate without a listener each.
  useEffect(() => {
    if (!user?.uid) { setRatingsBySpot({}); return undefined; }
    const ownerUids = [user.uid, ...sharerUids.split('|').filter(Boolean)];
    const unsub = subscribeEatingOutRatings(ownerUids, setRatingsBySpot);
    return () => { if (unsub) unsub(); };
  }, [user?.uid, sharerUids]);

  // Tag each restaurant with the owner so downstream logic (persist, badges,
  // voting) knows where each row came from.
  const restaurants = useMemo(() => {
    const out = [];
    for (const [ownerUid, entry] of Object.entries(ownerData)) {
      if (!entry || !Array.isArray(entry.restaurants)) continue;
      for (const r of entry.restaurants) {
        out.push({
          ...r,
          _ownerUid: ownerUid,
          _ownerUsername: entry.username,
          _isMine: ownerUid === user?.uid,
        });
      }
    }
    return out;
  }, [ownerData, user?.uid]);

  // Suggestions + sidebar draw from the curated master list AND any tag already
  // in use, so the master list drives the vocabulary without ever hiding a tag
  // that's actually on a spot (soft source of truth).
  const cuisineSuggestions = useMemo(() => {
    const set = new Set(masterCuisines || []);
    for (const r of restaurants) for (const c of (r.cuisines || [])) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [restaurants, masterCuisines]);

  const locationSuggestions = useMemo(() => {
    const set = new Set();
    for (const r of restaurants) for (const l of (r.locations || [])) set.add(l);
    return Array.from(set).sort();
  }, [restaurants]);

  const categorySuggestions = useMemo(() => {
    const set = new Set(masterCategories || []);
    for (const r of restaurants) for (const c of (r.categories || [])) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [restaurants, masterCategories]);


  const locationEntries = useMemo(() => {
    const counts = new Map();
    for (const r of restaurants) {
      if (!showRetired && r.frequency === 'retired') continue;
      if (filter !== 'all' && r.status !== filter) continue;
      if (activeCuisine && !(r.cuisines || []).some(c => c.toLowerCase() === activeCuisine.toLowerCase())) continue;
      if (activeBucket && !restaurantMatchesBucket(r, activeBucket)) continue;
      if (activeHealth && healthOf(r) !== activeHealth) continue;
      if (activeCategory && !(r.categories || []).some(c => c.toLowerCase() === activeCategory.toLowerCase())) continue;
      for (const l of (r.locations || [])) {
        counts.set(l, (counts.get(l) || 0) + 1);
      }
    }
    return locationSuggestions.map(l => ({ name: l, count: counts.get(l) || 0 }));
  }, [restaurants, locationSuggestions, filter, activeCuisine, activeBucket, activeHealth, activeCategory, showRetired]);

  // Locations that exist on MY own list (lowercased) — only these can be
  // bulk-renamed, since renaming never touches a friend's shared list.
  const myLocationNames = useMemo(() => {
    const set = new Set();
    for (const r of (ownerData[user?.uid]?.restaurants || [])) {
      for (const l of (r.locations || [])) set.add(l.toLowerCase());
    }
    return set;
  }, [ownerData, user?.uid]);

  // Ids of restaurants on MY own list — only these are bulk-editable (a
  // friend's shared list is never mutated, matching bulk-import/rename).
  const myRestaurantIds = useMemo(
    () => new Set((ownerData[user?.uid]?.restaurants || []).map(r => r.id)),
    [ownerData, user?.uid],
  );

  // Tapping a spot: my own opens the editor; a friend's opens the read-only
  // ratings + comment sheet (no editing someone else's list).
  const openSpot = useCallback((r) => {
    if (r._isMine) setEditing(r);
    else setViewing(r);
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = restaurants.filter(r => {
      if (!showRetired && r.frequency === 'retired') return false;
      if (filter !== 'all' && r.status !== filter) return false;
      if (activeCuisine && !(r.cuisines || []).some(c => c.toLowerCase() === activeCuisine.toLowerCase())) return false;
      if (activeLocation && !(r.locations || []).some(l => l.toLowerCase() === activeLocation.toLowerCase())) return false;
      if (activeBucket && !restaurantMatchesBucket(r, activeBucket)) return false;
      if (activeHealth && healthOf(r) !== activeHealth) return false;
      if (activeCategory && !(r.categories || []).some(c => c.toLowerCase() === activeCategory.toLowerCase())) return false;
      if (q) {
        const hay = [
          r.name, r.dish, r.address, r.notes, r.description, r.ratingLabel,
          ...(r.cuisines || []), ...(r.locations || []), ...(r.categories || []),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (proximityCenter) {
      list = list
        .map(r => {
          const lat = coerceCoord(r.lat);
          const lng = coerceCoord(r.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { r, d: null };
          return { r, d: haversineMiles(proximityCenter, { lat, lng }) };
        })
        .filter(x => x.d != null)
        .sort((a, b) => a.d - b.d)
        .map(x => ({ ...x.r, _distance: x.d }));
    }
    // Otherwise the list stays in master order — each owner's `restaurants`
    // array order IS the shared ranking (rank = position; renumbered within
    // whatever filter is active). The ▲▼ controls reorder that array.
    //
    // Float "want to try" spots above already-visited ones so the next places
    // to try surface at the top. Array.sort is stable, so each status group
    // keeps its manual ▲▼ ranking order within the partition. Skipped when the
    // status filter already narrows to a single group (no-op then anyway).
    else {
      list = [...list].sort((a, b) =>
        (a.status === 'visited' ? 1 : 0) - (b.status === 'visited' ? 1 : 0),
      );
    }
    return list;
  }, [restaurants, filter, activeCuisine, activeLocation, activeBucket, activeHealth, activeCategory, showRetired, search, proximityCenter]);

  // Per-owner sequence of currently-visible ids, so a card knows whether it can
  // move up/down (i.e. has a visible same-owner neighbor in that direction).
  const ownerSeq = useMemo(() => {
    const m = {};
    for (const r of visible) (m[r._ownerUid] = m[r._ownerUid] || []).push(r.id);
    return m;
  }, [visible]);

  // Persist the full restaurants array for a single owner. Updates local
  // state optimistically (the snapshot listener will reconcile on success
  // or surface an error if Firestore rejects).
  const persistOwner = useCallback(async (ownerUid, nextRestaurants) => {
    if (!ownerUid) return;
    setOwnerData(prev => ({
      ...prev,
      [ownerUid]: { ...(prev[ownerUid] || {}), restaurants: nextRestaurants },
    }));
    try {
      await saveOwnerRestaurants(ownerUid, nextRestaurants);
    } catch (err) {
      console.error('Failed to save restaurants:', err);
      const reason = err?.message || 'unknown error';
      const whose = ownerUid === user?.uid ? 'your list' : `@${ownerData[ownerUid]?.username || 'friend'}'s list`;
      alert(`Save to ${whose} failed — changes are local only.\n\n${reason}\n\nFirestore rules may not allow edits to a friend's shared list yet.`);
    }
  }, [user?.uid, ownerData]);

  // Save the curated master lists (from the ⚙ Settings panel) to my own doc,
  // optimistically so the sidebar/suggestions update immediately.
  const persistMasterLists = useCallback(async (cuisines, categories) => {
    if (!user?.uid) return;
    setMasterCuisines(cuisines);
    setMasterCategories(categories);
    try {
      await saveOwnerEatingOutLists(user.uid, { cuisines, categories });
    } catch (err) {
      console.error('Failed to save Eating Out master lists:', err);
      alert(`Couldn't save your cuisine/category lists — ${err?.message || 'try again'}`);
    }
  }, [user?.uid]);

  // Save the edited bucket list to my own doc (shared with mobile). Apply
  // locally first (optimistic + so the UI updates even before/without a write),
  // then persist when signed in.
  const persistBuckets = useCallback(async (list) => {
    const eff = effectiveBucketConfig(list);
    applyBucketConfig(eff);
    setBucketConfig(eff);
    // If the active bucket filter was just deleted, clear it so the list isn't
    // stuck filtering on a bucket that no longer exists.
    setActiveBucket(prev => (prev && prev !== 'unsorted' && !eff.some(b => b.key === prev)) ? null : prev);
    if (!user?.uid) return;
    try {
      await saveField(user.uid, 'eatingOutBuckets', eff);
    } catch (err) {
      console.error('Failed to save buckets:', err);
      alert(`Couldn't save your buckets — ${err?.message || 'try again'}`);
    }
  }, [user?.uid]);

  // How many of MY spots sit in each bucket — shown next to each row in the
  // editor. `valid` ties the count to the current config so a delete/rename
  // recomputes (and keeps the dependency honest for the linter).
  const myBucketCounts = useMemo(() => {
    const valid = new Set(bucketConfig.map(b => b.key));
    const counts = new Map();
    for (const r of (ownerData[user?.uid]?.restaurants || [])) {
      for (const k of bucketsOf(r)) if (valid.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }, [ownerData, user?.uid, bucketConfig]);

  // Usage counts across MY OWN spots only (the master list is mine to curate;
  // friends' shared lists aren't). Drives the "· N in use" hints in Settings.
  const myCuisineCounts = useMemo(() => {
    const counts = new Map();
    for (const r of (ownerData[user?.uid]?.restaurants || [])) {
      for (const c of (r.cuisines || [])) counts.set(c, (counts.get(c) || 0) + 1);
    }
    return counts;
  }, [ownerData, user?.uid]);

  const myCategoryCounts = useMemo(() => {
    const counts = new Map();
    for (const r of (ownerData[user?.uid]?.restaurants || [])) {
      for (const c of (r.categories || [])) counts.set(c, (counts.get(c) || 0) + 1);
    }
    return counts;
  }, [ownerData, user?.uid]);

  // Usage across ALL visible spots (mine + friends'). These drive the counts +
  // the "in use, not listed" rows in the ⚙ popup, so filtering by a friend's
  // cuisine is reachable even if I've never used it myself.
  const allCuisineCounts = useMemo(() => {
    const counts = new Map();
    for (const r of restaurants) for (const c of (r.cuisines || [])) counts.set(c, (counts.get(c) || 0) + 1);
    return counts;
  }, [restaurants]);
  const allCategoryCounts = useMemo(() => {
    const counts = new Map();
    for (const r of restaurants) for (const c of (r.categories || [])) counts.set(c, (counts.get(c) || 0) + 1);
    return counts;
  }, [restaurants]);

  // The list shown/edited in the ⚙ popup. Until I've saved a curated list,
  // fall back to MY OWN tags (seeded) so the menu isn't empty; friends' tags
  // stay out of my personal list but remain reachable via "in use, not listed".
  const seededCuisines = useMemo(
    () => Array.from(myCuisineCounts.keys()).sort((a, b) => a.localeCompare(b)),
    [myCuisineCounts],
  );
  const seededCategories = useMemo(
    () => Array.from(myCategoryCounts.keys()).sort((a, b) => a.localeCompare(b)),
    [myCategoryCounts],
  );
  const effectiveMasterCuisines = masterCuisines ?? seededCuisines;
  const effectiveMasterCategories = masterCategories ?? seededCategories;

  // Rank = the item's 1-based position in the currently-visible (filtered) list,
  // which is itself in master order. So numbers auto-renumber when you filter.
  const rankPositionOf = useCallback((id) => {
    const i = visible.findIndex(r => r.id === id);
    return i >= 0 ? i + 1 : null;
  }, [visible]);

  // Move a spot up/down by swapping it with its nearest VISIBLE same-owner
  // neighbour inside that owner's `restaurants` array (the shared master order),
  // then persist the whole array. Both the owner and anyone they've shared with
  // can do this, so it's one collaborative ranking. Optimistic via persistOwner.
  const handleRankMove = useCallback((restaurantId, dir) => {
    const target = visible.find(r => r.id === restaurantId);
    if (!target) return;
    const ownerUid = target._ownerUid;
    // Reorder within the item's own group — Want-to-try and Ranked (Visited)
    // are shown as separate sections, so ▲▼ shouldn't swap across the divide.
    const isWant = target.status === 'want-to-try';
    const sameOwner = visible.filter(r => r._ownerUid === ownerUid && (r.status === 'want-to-try') === isWant);
    const vi = sameOwner.findIndex(r => r.id === restaurantId);
    const vj = dir === 'up' ? vi - 1 : vi + 1;
    if (vi < 0 || vj < 0 || vj >= sameOwner.length) return;
    const neighborId = sameOwner[vj].id;
    const arr = [...(ownerData[ownerUid]?.restaurants || [])];
    const ai = arr.findIndex(r => r.id === restaurantId);
    const aj = arr.findIndex(r => r.id === neighborId);
    if (ai < 0 || aj < 0) return;
    [arr[ai], arr[aj]] = [arr[aj], arr[ai]];
    persistOwner(ownerUid, arr);
  }, [visible, ownerData, persistOwner]);

  // Drag-and-drop reorder: move `draggedId` into `targetId`'s slot within the
  // same owner's master array (dropping onto a row places the dragged spot just
  // before it). Same-owner only — dropping across owners is a no-op. Persists
  // optimistically like handleRankMove.
  const handleRankDrop = useCallback((draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const dragged = visible.find(r => r.id === draggedId);
    const target = visible.find(r => r.id === targetId);
    if (!dragged || !target || dragged._ownerUid !== target._ownerUid) return;
    const ownerUid = dragged._ownerUid;
    const arr = [...(ownerData[ownerUid]?.restaurants || [])];
    const from = arr.findIndex(r => r.id === draggedId);
    if (from < 0) return;
    const [moved] = arr.splice(from, 1);
    const to = arr.findIndex(r => r.id === targetId); // recomputed after removal
    if (to < 0) { return; }
    arr.splice(to, 0, moved);
    persistOwner(ownerUid, arr);
  }, [visible, ownerData, persistOwner]);
  // Which row is being dragged / hovered as a drop target (for visual feedback).
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // Friends' votes on MY restaurants, indexed by restaurantId. Flattens
  // per-category votes into a list of { username, rank, category }.
  const friendVotesByRestaurant = useMemo(() => {
    const map = new Map();
    for (const f of votesFromFriends) {
      const byCat = f.votesByCategory || {};
      for (const [category, arr] of Object.entries(byCat)) {
        const votes = Array.isArray(arr) ? arr : [];
        for (let i = 0; i < votes.length; i++) {
          const rid = votes[i];
          if (!rid) continue;
          if (!map.has(rid)) map.set(rid, []);
          map.get(rid).push({ username: f.username, rank: i + 1, category });
        }
      }
    }
    return map;
  }, [votesFromFriends]);

  // The unfiled backlog, captured when you press File on the banner so the
  // queue can't reshuffle underneath you as answers land.
  const [filingQueue, setFilingQueue] = useState(null);

  // One answer, written immediately. `dietTags` is kept in step with `health`
  // the same way the editor does it, or the legacy array and the new field
  // disagree and healthOf() starts reading the stale one.
  const applyFiling = useCallback((spot, patch) => {
    const ownerUid = spot._ownerUid || user?.uid;
    if (!ownerUid) return;
    const ownerList = ownerData[ownerUid]?.restaurants || [];
    const next = ownerList.map(r => {
      if (r.id !== spot.id) return r;
      const merged = { ...r, ...patch };
      if (patch.health) merged.dietTags = syncDietTags(r.dietTags, patch.health);
      return merged;
    });
    persistOwner(ownerUid, next);
  }, [ownerData, persistOwner, user]);

  // One spot on SOMEONE ELSE'S list, written through the transaction rather
  // than persistOwner. persistOwner pushes the whole array, which is right for
  // my own list but would hand a friend's 400-spot list back from whatever copy
  // this tab loaded — erasing anything they changed since. Local state is
  // updated optimistically either way.
  const writeFriendSpot = useCallback(async (ownerUid, spot, opts) => {
    setOwnerData(prev => {
      const list = prev[ownerUid]?.restaurants || [];
      const next = opts?.remove
        ? list.filter(r => r.id !== spot.id)
        : (list.some(r => r.id === spot.id)
            ? list.map(r => (r.id === spot.id ? spot : r))
            : [spot, ...list]);
      return { ...prev, [ownerUid]: { ...(prev[ownerUid] || {}), restaurants: next } };
    });
    try {
      const myName = ownerData[user?.uid]?.username || user?.displayName || '';
      await saveSpotForOwner(ownerUid, spot, { uid: user?.uid, name: myName }, opts);
    } catch (err) {
      console.error('Failed to save to a shared list:', err);
      alert(`Save to @${ownerData[ownerUid]?.username || 'friend'}'s list failed — the change is local only.\n\n${err?.message || 'unknown error'}`);
    }
  }, [user?.uid, user?.displayName, ownerData]);

  function handleSave(restaurant) {
    // Adds default to MY list; edits go to the original owner's list.
    const ownerUid = restaurant._ownerUid || user?.uid;
    if (!ownerUid) return;
    // Strip our annotation fields so they don't get persisted.
    const { _ownerUid, _ownerUsername, _isMine, ...clean } = restaurant;
    if (ownerUid !== user?.uid) {
      writeFriendSpot(ownerUid, clean);
      setEditing(null);
      setAdding(false);
      return;
    }
    const ownerList = ownerData[ownerUid]?.restaurants || [];
    const exists = ownerList.some(r => r.id === restaurant.id);
    const nextList = exists
      ? ownerList.map(r => (r.id === clean.id ? clean : r))
      : [clean, ...ownerList];
    persistOwner(ownerUid, nextList);
    setEditing(null);
    setAdding(false);
  }

  function handleDelete(restaurant) {
    const ownerUid = restaurant?._ownerUid;
    if (!ownerUid) return;
    const { _ownerUid, _ownerUsername, _isMine, ...clean } = restaurant;
    if (ownerUid !== user?.uid) {
      writeFriendSpot(ownerUid, clean, { remove: true });
      setEditing(null);
      return;
    }
    const ownerList = ownerData[ownerUid]?.restaurants || [];
    const nextList = ownerList.filter(r => r.id !== restaurant.id);
    persistOwner(ownerUid, nextList);
    setEditing(null);
  }

  // Rename a location across MY list — every restaurant tagged with `oldName`
  // gets it replaced, de-duplicated case-insensitively. If the new name already
  // exists the two effectively merge. Friends' shared lists are never touched
  // (matches the bulk-import scoping).
  function handleRenameLocation(oldName) {
    if (!user?.uid) return;
    const raw = window.prompt(`Rename location "${oldName}" to:`, oldName);
    if (raw == null) return; // cancelled
    const newName = raw.trim();
    if (!newName || newName === oldName) return;

    const myList = ownerData[user.uid]?.restaurants || [];
    const sameLetters = newName.toLowerCase() === oldName.toLowerCase();
    const mergesInto = !sameLetters && myList.some(r =>
      (r.locations || []).some(l => l.toLowerCase() === newName.toLowerCase()),
    );
    if (mergesInto && !window.confirm(
      `"${newName}" already exists — merge "${oldName}" into it? Restaurants tagged with both will keep a single "${newName}".`,
    )) return;

    let changed = 0;
    const next = myList.map(r => {
      const locs = r.locations || [];
      if (!locs.some(l => l.toLowerCase() === oldName.toLowerCase())) return r;
      const seen = new Set();
      const updated = [];
      for (const l of locs) {
        const replaced = l.toLowerCase() === oldName.toLowerCase() ? newName : l;
        const key = replaced.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        updated.push(replaced);
      }
      changed++;
      return { ...r, locations: updated, updatedAt: new Date().toISOString() };
    });
    if (changed === 0) {
      window.alert(`"${oldName}" isn't on your own list, so there's nothing to rename here.`);
      return;
    }
    persistOwner(user.uid, next);
    if (activeLocation && activeLocation.toLowerCase() === oldName.toLowerCase()) {
      setActiveLocation(newName);
    }
  }

  // Apply a patch to every selected restaurant on MY list. `updater(r)` returns
  // a partial object to merge (or null to skip that row). Scoped to my list.
  const bulkUpdate = useCallback((ids, updater) => {
    if (!user?.uid) return;
    const idSet = ids instanceof Set ? ids : new Set(ids);
    const myList = ownerData[user.uid]?.restaurants || [];
    let changed = 0;
    const next = myList.map(r => {
      if (!idSet.has(r.id)) return r;
      const patch = updater(r);
      if (!patch) return r;
      changed++;
      return { ...r, ...patch, updatedAt: new Date().toISOString() };
    });
    if (changed) persistOwner(user.uid, next);
  }, [ownerData, user?.uid, persistOwner]);

  const bulkDelete = useCallback((ids) => {
    if (!user?.uid) return;
    const idSet = ids instanceof Set ? ids : new Set(ids);
    const myList = ownerData[user.uid]?.restaurants || [];
    persistOwner(user.uid, myList.filter(r => !idSet.has(r.id)));
  }, [ownerData, user?.uid, persistOwner]);

  function handleBulkImport(rows, strategy) {
    // Bulk operations only target MY own list — shared rows are excluded.
    if (!user?.uid) return;
    const myList = ownerData[user.uid]?.restaurants || [];
    let next;
    let summary;
    if (strategy === 'replace-all') {
      const incomingIds = new Set(rows.map(r => r.id).filter(Boolean));
      const incomingNames = new Set(rows.map(r => (r.name || '').toLowerCase().trim()));
      const willDelete = myList.filter(r =>
        !incomingIds.has(r.id) && !incomingNames.has((r.name || '').toLowerCase().trim()),
      );
      if (willDelete.length > 0) {
        const preview = willDelete.slice(0, 20).map(r => `  • ${r.name}`).join('\n');
        const more = willDelete.length > 20 ? `\n  …and ${willDelete.length - 20} more` : '';
        const ok = confirm(
          `Replace ALL restaurants with the ${rows.length} from this CSV?\n\n` +
          `${willDelete.length} existing restaurant${willDelete.length === 1 ? '' : 's'} will be DELETED:\n\n` +
          preview + more +
          `\n\nThis cannot be undone.`,
        );
        if (!ok) return;
      }
      next = [...rows];
      summary = `Replaced your list with ${rows.length} restaurant${rows.length === 1 ? '' : 's'}.`;
    } else if (strategy === 'replace-duplicates') {
      // Match by id when the incoming row carries one (CSV round-trip from
      // the exporter), otherwise fall back to name match.
      const incomingIds = new Set(rows.map(r => r.id).filter(Boolean));
      const incomingNames = new Map(rows.map(r => [(r.name || '').toLowerCase().trim(), r]));
      const filtered = myList.filter(r =>
        !incomingIds.has(r.id) && !incomingNames.has((r.name || '').toLowerCase().trim()),
      );
      next = [...rows, ...filtered];
      summary = `Imported ${rows.length} restaurant${rows.length === 1 ? '' : 's'}.`;
    } else {
      next = [...rows, ...myList];
      summary = `Imported ${rows.length} restaurant${rows.length === 1 ? '' : 's'}.`;
    }
    persistOwner(user.uid, next);
    setBulkOpen(false);
    alert(summary);
  }

  function handleExport() {
    if (visible.length === 0) {
      alert('Nothing to export — adjust your filters first.');
      return;
    }
    downloadRestaurantsCsv(visible);
  }

  async function handleProximity(e) {
    if (e) e.preventDefault();
    const q = proximityQuery.trim();
    if (!q) {
      setProximityCenter(null);
      return;
    }
    setProximityResolving(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (res.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
        setProximityCenter({ lat: data.lat, lng: data.lng });
      } else {
        alert(data.error || 'Could not find that address.');
      }
    } catch (err) {
      alert(`Geocode failed: ${err.message || 'try again'}`);
    } finally {
      setProximityResolving(false);
    }
  }

  const retiredCount = useMemo(
    () => restaurants.filter(r => r.frequency === 'retired').length,
    [restaurants],
  );
  // Spots in no bucket yet — surfaced as an "Unsorted" filter chip so they can
  // be found and bulk-assigned.
  const unsortedCount = useMemo(
    () => restaurants.filter(r => bucketsOf(r).length === 0).length,
    [restaurants],
  );
  // How many spots carry each health tag, so the filter chips can stay hidden
  // until there's something for them to find.
  const healthCounts = useMemo(() => {
    const counts = {};
    for (const r of restaurants) {
      const h = healthOf(r);
      if (h) counts[h] = (counts[h] || 0) + 1;
    }
    return counts;
  }, [restaurants]);
  const geocodedCount = useMemo(
    () => restaurants.filter(hasValidCoords).length,
    [restaurants],
  );
  const ungeocodedWithAddress = useMemo(
    () => restaurants.filter(r =>
      typeof r.address === 'string' && r.address.trim() && !hasValidCoords(r),
    ),
    [restaurants],
  );

  const handleBulkGeocode = useCallback(async () => {
    if (!user?.uid) return;
    // Only geocode my own list — shared rows are owned by friends and would
    // require their permission to mass-edit.
    const myList = ownerData[user.uid]?.restaurants || [];
    const candidates = myList.filter(r =>
      typeof r.address === 'string' && r.address.trim() && !hasValidCoords(r),
    );
    if (candidates.length === 0) {
      alert('Nothing to geocode — all your restaurants with addresses already have coordinates.');
      return;
    }
    const mins = Math.max(1, Math.ceil((candidates.length * 1.2) / 60));
    const ok = confirm(
      `Geocode ${candidates.length} restaurant${candidates.length === 1 ? '' : 's'}?\n\n` +
      `This will take about ${mins} minute${mins === 1 ? '' : 's'} (Nominatim rate-limits us to ~1 request per second). ` +
      `Progress is saved as we go, and you can Stop at any time.`,
    );
    if (!ok) return;

    cancelGeocodeRef.current = false;
    let succeeded = 0;
    let notFound = 0;
    let failed = 0;
    setGeocodingProgress({ current: 0, total: candidates.length, succeeded, notFound, failed });

    let working = [...myList];

    for (let i = 0; i < candidates.length; i++) {
      if (cancelGeocodeRef.current) break;
      const candidate = candidates[i];
      setGeocodingProgress({ current: i + 1, total: candidates.length, succeeded, notFound, failed });
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(candidate.address)}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
          const idx = working.findIndex(r => r.id === candidate.id);
          if (idx >= 0) {
            working[idx] = {
              ...working[idx],
              lat: data.lat,
              lng: data.lng,
              updatedAt: new Date().toISOString(),
            };
            await persistOwner(user.uid, working);
          }
          succeeded++;
        } else if (res.status === 404) {
          notFound++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      setGeocodingProgress({ current: i + 1, total: candidates.length, succeeded, notFound, failed });
      if (i < candidates.length - 1 && !cancelGeocodeRef.current) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    const wasCancelled = cancelGeocodeRef.current;
    setGeocodingProgress(null);
    cancelGeocodeRef.current = false;
    alert(
      `${wasCancelled ? 'Geocoding stopped' : 'Geocoding done'}.\n\n` +
      `✓ ${succeeded} geocoded\n` +
      `? ${notFound} not found (Nominatim couldn't match the address)\n` +
      `✗ ${failed} failed (network / other error)`,
    );
  }, [user?.uid, ownerData, persistOwner]);

  // Selecting a category jumps to List view, the only place the per-category
  // vote controls (🥇🥈🥉 picks) render. Deselecting leaves the view as-is.
  function selectCategory(name) {
    const next = activeCategory === name ? null : name;
    setActiveCategory(next);
    if (next && viewMode !== 'list') setViewMode('list');
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Eating Out</h1>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleExport}
          title={`Download ${visible.length} restaurant${visible.length === 1 ? '' : 's'} as CSV`}
          disabled={visible.length === 0}
        >
          Export ({visible.length})
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleBulkGeocode}
          disabled={ungeocodedWithAddress.length === 0 || !!geocodingProgress}
          title={
            ungeocodedWithAddress.length === 0
              ? 'All restaurants with addresses already have coordinates'
              : `Geocode ${ungeocodedWithAddress.length} restaurant${ungeocodedWithAddress.length === 1 ? '' : 's'} missing coordinates`
          }
        >
          Geocode ({ungeocodedWithAddress.length})
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={() => setBulkOpen(true)}>
          Bulk import
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => setFriendsOpen(true)}
          title="Add a friend and share your Eating Out list both ways"
        >
          👥 Friends
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => setSettingsOpen(true)}
          title="Filter and manage cuisines & categories"
        >
          ⚙ Cuisines / Categories
        </button>
        <button type="button" className={styles.primaryBtn} onClick={() => setAdding(true)}>
          + Add restaurant
        </button>
      </div>

      <div className={styles.layout}>
        {/* Cuisines & Categories menus moved into the ⚙ popup (header). The
            active filter is surfaced as a removable chip in the toolbar below. */}
        <main className={styles.main}>
          {geocodingProgress && (
            <div className={styles.geocodingBanner}>
              <span>
                Geocoding {geocodingProgress.current} of {geocodingProgress.total}…
                {' '}✓ {geocodingProgress.succeeded}
                {geocodingProgress.notFound > 0 && ` · ? ${geocodingProgress.notFound}`}
                {geocodingProgress.failed > 0 && ` · ✗ ${geocodingProgress.failed}`}
              </span>
              <button
                type="button"
                className={styles.geocodingBannerStop}
                onClick={() => { cancelGeocodeRef.current = true; }}
              >
                Stop
              </button>
            </div>
          )}
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.searchInput}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search restaurants, cuisines, places, dishes…"
            />
            <div className={styles.filterRow}>
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  type="button"
                  className={`${styles.filterBtn} ${filter === f.key ? styles.filterBtnActive : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className={styles.filterRow}>
              <button
                type="button"
                className={`${styles.filterBtn} ${viewMode === 'list' ? styles.filterBtnActive : ''}`}
                onClick={() => setViewMode('list')}
              >
                List
              </button>
              <button
                type="button"
                className={`${styles.filterBtn} ${viewMode === 'table' ? styles.filterBtnActive : ''}`}
                onClick={() => setViewMode('table')}
              >
                Table
              </button>
              <button
                type="button"
                className={`${styles.filterBtn} ${viewMode === 'map' ? styles.filterBtnActive : ''}`}
                onClick={() => setViewMode('map')}
              >
                Map
              </button>
              <button
                type="button"
                className={`${styles.filterBtn} ${viewMode === 'rankings' ? styles.filterBtnActive : ''}`}
                onClick={() => setViewMode('rankings')}
              >
                Rankings
              </button>
            </div>
            {viewMode === 'list' && (
              <div className={styles.filterRow} style={{ marginLeft: 8 }}>
                <button
                  type="button"
                  className={`${styles.filterBtn} ${listDensity === 'compact' ? styles.filterBtnActive : ''}`}
                  onClick={() => setDensity('compact')}
                >
                  ☰ Compact
                </button>
                <button
                  type="button"
                  className={`${styles.filterBtn} ${listDensity === 'detailed' ? styles.filterBtnActive : ''}`}
                  onClick={() => setDensity('detailed')}
                >
                  ▦ Detailed
                </button>
              </div>
            )}
          </div>

          {(activeCuisine || activeCategory) && (
            <div className={styles.activeFilters}>
              <span className={styles.activeFiltersLabel}>Filtered:</span>
              {activeCuisine && (
                <button
                  type="button"
                  className={styles.activeFilterChip}
                  onClick={() => setActiveCuisine(null)}
                  title="Clear cuisine filter"
                >
                  {activeCuisine} <span className={styles.activeFilterX}>✕</span>
                </button>
              )}
              {activeCategory && (
                <button
                  type="button"
                  className={styles.activeFilterChip}
                  onClick={() => setActiveCategory(null)}
                  title="Clear category filter"
                >
                  🏷 {activeCategory} <span className={styles.activeFilterX}>✕</span>
                </button>
              )}
              <button
                type="button"
                className={styles.activeFiltersManage}
                onClick={() => setSettingsOpen(true)}
              >
                ⚙ Change
              </button>
            </div>
          )}

          <form className={styles.proximityRow} onSubmit={handleProximity}>
            <input
              type="text"
              className={styles.searchInput}
              value={proximityQuery}
              onChange={e => setProximityQuery(e.target.value)}
              placeholder="Near… (type a neighborhood or address and press Enter)"
            />
            <button type="submit" className={styles.secondaryBtn} disabled={proximityResolving}>
              {proximityResolving ? 'Locating…' : 'Find nearby'}
            </button>
            {proximityCenter && (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => { setProximityCenter(null); setProximityQuery(''); }}
              >
                Clear
              </button>
            )}
            {proximityCenter && geocodedCount === 0 && (
              <span className={styles.warn}>
                None of your restaurants have addresses yet — bulk import didn't include addresses, and Lookup wasn't run.
              </span>
            )}
          </form>

          {/* Neighborhood filter pills — one per location in use, most-used
              first, above the bucket row. Toggling the active one clears it. */}
          {(() => {
            const isActiveLoc = (name) =>
              !!activeLocation && activeLocation.toLowerCase() === name.toLowerCase();
            const neighborhoods = locationEntries.filter(l => l.count > 0);
            // Keep the active neighborhood visible even if the current filters
            // drop its count to 0, so it can always be toggled back off.
            if (activeLocation && !neighborhoods.some(l => isActiveLoc(l.name))) {
              const existing = locationEntries.find(l => isActiveLoc(l.name));
              neighborhoods.push(existing || { name: activeLocation, count: 0 });
            }
            neighborhoods.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
            if (neighborhoods.length === 0) return null;
            return (
              <div className={styles.tagFilterRow}>
                {neighborhoods.map(l => (
                  <button
                    key={`loc-${l.name}`}
                    type="button"
                    className={`${styles.tagFilter} ${isActiveLoc(l.name) ? styles.tagFilterActive : ''}`}
                    onClick={() => {
                      // Turning a group ON filters to it AND pops its ranking;
                      // clicking the active chip again just clears the filter.
                      const on = !isActiveLoc(l.name);
                      setActiveLocation(on ? l.name : null);
                      setRankingPopout(on ? l.name : null);
                    }}
                  >
                    📍 {l.name} ({l.count})
                  </button>
                ))}
              </div>
            );
          })()}

          <div className={styles.tagFilterRow}>
            {BUCKETS.map(b => (
              <button
                key={`b-${b.key}`}
                type="button"
                className={`${styles.tagFilter} ${activeBucket === b.key ? styles.tagFilterActive : ''}`}
                onClick={() => {
                  const on = activeBucket !== b.key;
                  setActiveBucket(on ? b.key : null);
                  setRankingPopout(on ? b.label : null);
                }}
              >
                {b.icon} {b.label}
              </button>
            ))}
            {unsortedCount > 0 && (
              <button
                type="button"
                className={`${styles.tagFilter} ${activeBucket === 'unsorted' ? styles.tagFilterActive : ''}`}
                onClick={() => setActiveBucket(activeBucket === 'unsorted' ? null : 'unsorted')}
                title="Spots not yet in a bucket — assign them below"
              >
                Unsorted ({unsortedCount})
              </button>
            )}
            {/* Only offered once something is actually tagged — until then the
                filter can only ever return nothing. */}
            {HEALTH_OPTIONS.map(h => {
              const count = healthCounts[h.key] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={`h-${h.key}`}
                  type="button"
                  className={`${styles.tagFilter} ${activeHealth === h.key ? styles.tagFilterActive : ''}`}
                  onClick={() => setActiveHealth(activeHealth === h.key ? null : h.key)}
                >
                  {h.icon} {h.label} ({count})
                </button>
              );
            })}
            {retiredCount > 0 && (
              <button
                type="button"
                className={`${styles.tagFilter} ${showRetired ? styles.tagFilterActive : ''}`}
                onClick={() => setShowRetired(v => !v)}
              >
                {showRetired ? `Hide retired (${retiredCount})` : `Show retired (${retiredCount})`}
              </button>
            )}
            <button
              type="button"
              className={styles.tagFilter}
              onClick={() => setBucketsOpen(true)}
              title="Add, rename, reorder or remove buckets"
            >
              ✎ Edit buckets
            </button>
          </div>

          {loading ? (
            <div className={styles.empty}>Loading…</div>
          ) : viewMode === 'map' ? (
            <RestaurantMapView items={visible} onSelect={openSpot} />
          ) : viewMode === 'rankings' ? (
            <RestaurantRankings
              items={visible}
              ratingsBySpot={ratingsBySpot}
              metric={rankMetric}
              onMetricChange={setRankMetric}
              onSelect={openSpot}
            />
          ) : viewMode === 'table' ? (
            <RestaurantTable
              items={visible}
              allItems={restaurants}
              onRowClick={openSpot}
              myRestaurantIds={myRestaurantIds}
              bulkUpdate={bulkUpdate}
              bulkDelete={bulkDelete}
              cuisineSuggestions={cuisineSuggestions}
              locationSuggestions={locationSuggestions}
              rankCtx={!proximityCenter ? {
                active: true,
                label: 'your list',
                positionOf: rankPositionOf,
                onMove: handleRankMove,
              } : null}
            />
          ) : visible.length === 0 ? (
            <div className={styles.empty}>
              {restaurants.length === 0 ? (
                <>
                  <p className={styles.emptyTitle}>No restaurants yet</p>
                  <p className={styles.emptyText}>
                    Save Instagram videos and websites for places you want to eat at,
                    or paste your spreadsheet via Bulk import. The mobile app syncs both ways.
                  </p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button type="button" className={styles.secondaryBtn} onClick={() => setBulkOpen(true)}>
                      Bulk import
                    </button>
                    <button type="button" className={styles.primaryBtn} onClick={() => setAdding(true)}>
                      + Add your first
                    </button>
                  </div>
                </>
              ) : (
                <p className={styles.emptyText}>Nothing matches. Try clearing filters or the search box.</p>
              )}
            </div>
          ) : (
            (() => {
              const showRank = !proximityCenter;
              const gridClass = listDensity === 'compact' ? styles.gridCompact : styles.grid;
              // Places you've been but never filed. Named, not just counted:
              // the whole job is small enough to finish in one sitting, and a
              // bare number tells you there's work without telling you where.
              const unfiled = visible.filter(r => missingCategories(r).length > 0);
              const labelStyle = { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.55, margin: '10px 2px 2px' };
              // rank == null → not numbered and not reorderable (Want-to-try, or
              // proximity mode). seq is the item's own group's per-owner sequence.
              const renderCard = (r, rank, seq) => {
                const oi = seq.indexOf(r.id);
                const canReorder = rank != null;
                return (
                  <RestaurantCard
                    key={`${r._ownerUid}:${r.id}`}
                    r={r}
                    ratingAgg={aggregateSpotRatings(ratingsBySpot[`${r._ownerUid}__${r.id}`] || [])}
                    compact={listDensity === 'compact'}
                    distanceMiles={r._distance}
                    rank={rank}
                    canMoveUp={canReorder && oi > 0}
                    canMoveDown={canReorder && oi >= 0 && oi < seq.length - 1}
                    onMoveUp={canReorder ? () => handleRankMove(r.id, 'up') : null}
                    onMoveDown={canReorder ? () => handleRankMove(r.id, 'down') : null}
                    drag={canReorder ? {
                      draggable: true,
                      dragging: dragId === r.id,
                      over: dragOverId === r.id && dragId && dragId !== r.id,
                      onDragStart: (e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', r.id); } catch { /* some browsers */ } },
                      onDragOver: (e) => { if (dragId && dragId !== r.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== r.id) setDragOverId(r.id); } },
                      onDrop: (e) => { e.preventDefault(); if (dragId) handleRankDrop(dragId, r.id); setDragId(null); setDragOverId(null); },
                      onDragEnd: () => { setDragId(null); setDragOverId(null); },
                    } : null}
                    onClick={() => openSpot(r)}
                  />
                );
              };
              if (!showRank) {
                return (
                  <>
                    {unfiledNotice(unfiled, setFilingQueue)}
                    <div className={gridClass}>{visible.map(r => renderCard(r, null, []))}</div>
                  </>
                );
              }
              // Want-to-try floats above, unnumbered; the numbered ranking below
              // is just the spots I've ranked (Visited).
              const wantGroup = visible.filter(r => r.status === 'want-to-try');
              const rankedGroup = visible.filter(r => r.status !== 'want-to-try');
              const rankedSeqByOwner = {};
              for (const r of rankedGroup) (rankedSeqByOwner[r._ownerUid] = rankedSeqByOwner[r._ownerUid] || []).push(r.id);
              return (
                <>
                  {unfiledNotice(unfiled, setFilingQueue)}
                  {wantGroup.length > 0 && (
                    <>
                      <div style={labelStyle}>Want to try ({wantGroup.length})</div>
                      <div className={gridClass}>{wantGroup.map(r => renderCard(r, null, []))}</div>
                    </>
                  )}
                  {rankedGroup.length > 0 && (
                    <>
                      {wantGroup.length > 0 && <div style={labelStyle}>Ranked</div>}
                      <div className={gridClass}>{rankedGroup.map((r, i) => renderCard(r, i + 1, rankedSeqByOwner[r._ownerUid] || []))}</div>
                    </>
                  )}
                </>
              );
            })()
          )}
        </main>
      </div>

      {adding && (
        <EditModal
          initial={{ status: 'want-to-try', cuisines: [], locations: [], categories: [], rating: null }}
          cuisineSuggestions={cuisineSuggestions}
          locationSuggestions={locationSuggestions}
          categorySuggestions={categorySuggestions}
          onSave={handleSave}
          onClose={() => setAdding(false)}
        />
      )}
      {filingQueue && filingQueue.length > 0 && (
        <FileSpotsModal
          queue={filingQueue}
          onApply={applyFiling}
          onClose={() => setFilingQueue(null)}
        />
      )}

      {editing && (
        <EditModal
          initial={editing}
          cuisineSuggestions={cuisineSuggestions}
          locationSuggestions={locationSuggestions}
          categorySuggestions={categorySuggestions}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onDelete={() => handleDelete(editing)}
          user={user}
        />
      )}
      {viewing && (
        <SpotDetailModal
          spot={viewing}
          user={user}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
        />
      )}
      {rankingPopout && (
        <RankingPopout
          label={rankingPopout}
          items={visible}
          ratingsBySpot={ratingsBySpot}
          metric={rankMetric}
          onMetricChange={setRankMetric}
          onSelect={(r) => { setRankingPopout(null); openSpot(r); }}
          onClose={() => setRankingPopout(null)}
        />
      )}
      {bulkOpen && (
        <BulkImportModal
          existing={ownerData[user?.uid]?.restaurants || []}
          onClose={() => setBulkOpen(false)}
          onImport={handleBulkImport}
        />
      )}
      {bucketsOpen && (
        <BucketSettingsModal
          buckets={bucketConfig}
          counts={myBucketCounts}
          onSave={persistBuckets}
          onClose={() => setBucketsOpen(false)}
        />
      )}
      {settingsOpen && (
        <MasterListSettingsModal
          cuisines={effectiveMasterCuisines}
          categories={effectiveMasterCategories}
          cuisineCounts={allCuisineCounts}
          categoryCounts={allCategoryCounts}
          activeCuisine={activeCuisine}
          activeCategory={activeCategory}
          // Filtering closes the popup so the results are visible immediately.
          onFilterCuisine={(name) => { setActiveCuisine(name); setSettingsOpen(false); }}
          onFilterCategory={(name) => { selectCategory(name); setSettingsOpen(false); }}
          // Managing auto-saves. Persist BOTH lists (using the effective value of
          // the untouched one) so a first edit doesn't wipe the seeded other list.
          onSetCuisines={(next) => persistMasterLists(next, effectiveMasterCategories)}
          onSetCategories={(next) => persistMasterLists(effectiveMasterCuisines, next)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {friendsOpen && (
        <EatingOutFriendsPanel
          user={user}
          onClose={() => setFriendsOpen(false)}
          onFriendsChanged={onFriendsChanged}
        />
      )}
    </div>
  );
}
