import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db } from '../firebase';
import { saveOwnerRestaurants, saveOwnerEatingOutLists, saveField } from '../utils/firestoreSync';
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
import { loadMyEatingOutVotes, setEatingOutVote, saveEatingOutOrder } from '../utils/firestoreSync';
import { EatingOutFriendsPanel } from './EatingOutFriendsPanel';
import styles from './EatingOutPage.module.css';

// Medal characters keyed by rank (1, 2, 3).
const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

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
    out.push({ key, label, icon: (typeof b.icon === 'string' && b.icon.trim()) ? b.icon.trim() : '🍴' });
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

function EditModal({ initial, onSave, onClose, onDelete, cuisineSuggestions, locationSuggestions, categorySuggestions = [] }) {
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
      dish: dish.trim() || undefined,
      meals: meals.length ? meals : undefined,
      address: address.trim() || undefined,
      lat: coords?.lat,
      lng: coords?.lng,
      lastVisit: lastVisit ? new Date(lastVisit + 'T12:00:00').toISOString() : undefined,
      takenJoanne: takenJoanne || undefined,
      dietTags: initial.dietTags,
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

          {imageUrl && (
            <>
              <label className={styles.fieldLabel}>Preview</label>
              <img src={imageUrl} alt="" className={styles.previewImg} />
            </>
          )}

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

          <label className={styles.fieldLabel}>Rating</label>
          <StarRating value={rating} onChange={setRating} />
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

function RestaurantCard({ r, distanceMiles, rank, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onClick, compact, drag }) {
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
        {bucketsOf(r).length > 0 && (
          <div className={styles.cardBuckets}>
            {bucketsOf(r).map(k => (
              <span key={k} className={styles.bucketChip}>
                {BUCKETS.find(b => b.key === k)?.icon} {bucketLabel(k)}
              </span>
            ))}
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

function RestaurantTable({ items, onRowClick, myRestaurantIds, bulkUpdate, bulkDelete, cuisineSuggestions = [], locationSuggestions = [], rankCtx = null }) {
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
  const [rows, setRows] = useState(() => buckets.map(b => ({ key: b.key, label: b.label, icon: b.icon })));

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

  const handleSave = () => {
    // Assign keys to new rows (slug of label, unique), drop blank-label rows.
    const used = new Set(rows.map(r => r.key).filter(Boolean));
    const out = [];
    for (const r of rows) {
      const label = (r.label || '').trim();
      if (!label) continue;
      const key = r.key || makeBucketKey(label, used);
      out.push({ key, label, icon: (r.icon || '').trim() || '🍴' });
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
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                <button type="button" className={styles.iconBtn} onClick={() => move(i, -1)} disabled={i === 0} title="Move up">▲</button>
                <button type="button" className={styles.iconBtn} onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down">▼</button>
                <button type="button" className={styles.iconBtn} onClick={() => removeRow(i)} title="Delete bucket">🗑️</button>
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
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [showRetired, setShowRetired] = useState(false);
  const [proximityQuery, setProximityQuery] = useState('');
  const [proximityCenter, setProximityCenter] = useState(null);
  const [proximityResolving, setProximityResolving] = useState(false);
  const [editing, setEditing] = useState(null);
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
  // My ranked top-3 picks, keyed by (ownerUid, category).
  // Shape: { [ownerUid]: { [category]: [restaurantId1, restaurantId2, restaurantId3] } }.
  // Unified ranking: full ordered list per (ownerUid, dimensionKey). The Table
  // view ▲▼ reorders the whole list; the List/mobile 🥇🥈🥉 medals are its top 3.
  const [myEatingOutVotes, setMyEatingOutVotes] = useState({});

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
    const unsubs = ownerUids.map(uid => {
      const ref = doc(db, 'users', uid);
      return onSnapshot(
        ref,
        (snap) => {
          if (snap.metadata.hasPendingWrites && uid === user.uid) return;
          const data = snap.data() || {};
          const restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
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
            [uid]: { username, restaurants },
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
    return () => { unsubs.forEach(u => u && u()); };
  }, [user?.uid, sharerUids, sharerMeta]);

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
      if (activeCategory && !(r.categories || []).some(c => c.toLowerCase() === activeCategory.toLowerCase())) continue;
      for (const l of (r.locations || [])) {
        counts.set(l, (counts.get(l) || 0) + 1);
      }
    }
    return locationSuggestions.map(l => ({ name: l, count: counts.get(l) || 0 }));
  }, [restaurants, locationSuggestions, filter, activeCuisine, activeBucket, activeCategory, showRetired]);

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

  // The active ranking dimension: ranking now works over a dedicated category,
  // OR over the cuisine/location you've selected — so your existing tags are
  // votable with no extra tagging. `key` is what we store votes under (cuisine
  // and location are namespaced so they never collide with each other or with a
  // real category); `label` is what we show. A category wins if both are set.
  const rankDim = useMemo(() => {
    if (activeCategory) return { key: activeCategory, label: activeCategory };
    if (activeCuisine) return { key: `cuisine:${activeCuisine}`, label: activeCuisine };
    if (activeLocation) return { key: `location:${activeLocation}`, label: activeLocation };
    return null;
  }, [activeCategory, activeCuisine, activeLocation]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = restaurants.filter(r => {
      if (!showRetired && r.frequency === 'retired') return false;
      if (filter !== 'all' && r.status !== filter) return false;
      if (activeCuisine && !(r.cuisines || []).some(c => c.toLowerCase() === activeCuisine.toLowerCase())) return false;
      if (activeLocation && !(r.locations || []).some(l => l.toLowerCase() === activeLocation.toLowerCase())) return false;
      if (activeBucket && !restaurantMatchesBucket(r, activeBucket)) return false;
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
  }, [restaurants, filter, activeCuisine, activeLocation, activeBucket, activeCategory, showRetired, search, proximityCenter]);

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

  // Pull my eating-out votes once when the user is known. Subsequent
  // updates use the local handleVote which writes through to Firestore.
  useEffect(() => {
    if (!user?.uid) { setMyEatingOutVotes({}); return; }
    let cancelled = false;
    loadMyEatingOutVotes(user.uid)
      .then(v => { if (!cancelled) setMyEatingOutVotes(v || {}); })
      .catch(() => { /* keep empty */ });
    return () => { cancelled = true; };
  }, [user?.uid]);

  const handleVoteOnRestaurant = useCallback(async (ownerUid, category, restaurantId, rank) => {
    if (!user?.uid || !category) return;
    setMyEatingOutVotes(prev => {
      const next = { ...prev };
      const byCat = { ...(next[ownerUid] || {}) };
      let list = Array.isArray(byCat[category]) ? byCat[category].filter(id => id !== restaurantId) : [];
      if (rank === 1 || rank === 2 || rank === 3) {
        const idx = Math.min(rank - 1, list.length);
        list = [...list.slice(0, idx), restaurantId, ...list.slice(idx)];
      }
      if (list.length === 0) delete byCat[category];
      else byCat[category] = list;
      if (Object.keys(byCat).length === 0) delete next[ownerUid];
      else next[ownerUid] = byCat;
      return next;
    });
    try {
      await setEatingOutVote(user.uid, ownerUid, category, restaurantId, rank);
    } catch (err) {
      console.error('Failed to save vote:', err);
      alert(`Couldn't save your vote — ${err?.message || 'try again'}`);
    }
  }, [user?.uid]);

  // Does a restaurant belong to the active ranking dimension (cuisine/location/
  // category)? Used to build the ordered list the ▲▼ arrows reorder.
  const matchesRankDim = useCallback((r) => {
    if (activeCategory) return (r.categories || []).some(c => c.toLowerCase() === activeCategory.toLowerCase());
    if (activeCuisine) return (r.cuisines || []).some(c => c.toLowerCase() === activeCuisine.toLowerCase());
    if (activeLocation) return (r.locations || []).some(l => l.toLowerCase() === activeLocation.toLowerCase());
    return false;
  }, [activeCategory, activeCuisine, activeLocation]);

  // The full ranked id list for the active dimension, over MY OWN list: saved
  // order first (for spots still in the dimension), then any not-yet-ranked
  // spots appended alphabetically. This is what positions + ▲▼ act on.
  const myRankOrder = useMemo(() => {
    if (!user?.uid || !rankDim) return [];
    const mine = (ownerData[user.uid]?.restaurants || []).filter(matchesRankDim);
    const byId = new Map(mine.map(r => [r.id, r]));
    const stored = (myEatingOutVotes[user.uid]?.[rankDim.key] || []).filter(id => byId.has(id));
    const storedSet = new Set(stored);
    const rest = mine
      .filter(r => !storedSet.has(r.id))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
      .map(r => r.id);
    return [...stored, ...rest];
  }, [user?.uid, rankDim, ownerData, myEatingOutVotes, matchesRankDim]);

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
    const sameOwner = visible.filter(r => r._ownerUid === ownerUid);
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

  function handleSave(restaurant) {
    // Adds default to MY list; edits go to the original owner's list.
    const ownerUid = restaurant._ownerUid || user?.uid;
    if (!ownerUid) return;
    const ownerList = ownerData[ownerUid]?.restaurants || [];
    const exists = ownerList.some(r => r.id === restaurant.id);
    // Strip our annotation fields so they don't get persisted.
    const { _ownerUid, _ownerUsername, _isMine, ...clean } = restaurant;
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
                    onClick={() => setActiveLocation(isActiveLoc(l.name) ? null : l.name)}
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
                onClick={() => setActiveBucket(activeBucket === b.key ? null : b.key)}
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
            <RestaurantMapView items={visible} onSelect={setEditing} />
          ) : viewMode === 'table' ? (
            <RestaurantTable
              items={visible}
              onRowClick={setEditing}
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
            <div className={listDensity === 'compact' ? styles.gridCompact : styles.grid}>
              {visible.map((r, i) => {
                const showRank = !proximityCenter;
                const seq = ownerSeq[r._ownerUid] || [];
                const oi = seq.indexOf(r.id);
                return (
                  <RestaurantCard
                    key={`${r._ownerUid}:${r.id}`}
                    r={r}
                    compact={listDensity === 'compact'}
                    distanceMiles={r._distance}
                    rank={showRank ? i + 1 : null}
                    canMoveUp={showRank && oi > 0}
                    canMoveDown={showRank && oi >= 0 && oi < seq.length - 1}
                    onMoveUp={showRank ? () => handleRankMove(r.id, 'up') : null}
                    onMoveDown={showRank ? () => handleRankMove(r.id, 'down') : null}
                    drag={showRank ? {
                      draggable: true,
                      dragging: dragId === r.id,
                      over: dragOverId === r.id && dragId && dragId !== r.id,
                      onDragStart: (e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', r.id); } catch { /* some browsers */ } },
                      onDragOver: (e) => { if (dragId && dragId !== r.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== r.id) setDragOverId(r.id); } },
                      onDrop: (e) => { e.preventDefault(); if (dragId) handleRankDrop(dragId, r.id); setDragId(null); setDragOverId(null); },
                      onDragEnd: () => { setDragId(null); setDragOverId(null); },
                    } : null}
                    onClick={() => setEditing(r)}
                  />
                );
              })}
            </div>
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
      {editing && (
        <EditModal
          initial={editing}
          cuisineSuggestions={cuisineSuggestions}
          locationSuggestions={locationSuggestions}
          categorySuggestions={categorySuggestions}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onDelete={() => handleDelete(editing)}
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
