import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db } from '../firebase';
import { saveField } from '../utils/firestoreSync';
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
import styles from './EatingOutPage.module.css';

const VISITED_COLOR = '#10b981';
const WANT_COLOR = '#f59e0b';

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

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'want-to-try', label: 'Want to try' },
  { key: 'visited', label: 'Visited' },
];

const MEAL_TYPES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch-dinner', label: 'Lunch / Dinner' },
  { key: 'drinking', label: 'Drinking' },
  { key: 'coffee', label: 'Coffee' },
  { key: 'other', label: 'Other' },
  { key: 'all', label: 'Anytime' },
];

const FREQUENCIES = [
  { key: 'regular', label: 'Regular' },
  { key: 'special', label: 'Special' },
  { key: 'retired', label: 'Retired' },
];

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
        placeholder={placeholder}
      />
      {filtered.length > 0 && (
        <div className={styles.suggestionRow}>
          {filtered.map(s => (
            <button key={s} type="button" className={styles.suggestionChip} onClick={() => commit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditModal({ initial, onSave, onClose, onDelete, cuisineSuggestions, locationSuggestions }) {
  const [name, setName] = useState(initial.name || '');
  const [url, setUrl] = useState(initial.url || '');
  const [imageUrl, setImageUrl] = useState(initial.imageUrl || '');
  const [description, setDescription] = useState(initial.description || '');
  const [notes, setNotes] = useState(initial.notes || '');
  const [cuisines, setCuisines] = useState(initial.cuisines || []);
  const [locations, setLocations] = useState(initial.locations || []);
  const [rating, setRating] = useState(initial.rating ?? null);
  const [ratingLabel, setRatingLabel] = useState(initial.ratingLabel || '');
  const [status, setStatus] = useState(initial.status || 'want-to-try');
  const [mealType, setMealType] = useState(initial.mealType || '');
  const [frequency, setFrequency] = useState(initial.frequency || '');
  const [dish, setDish] = useState(initial.dish || '');
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
      if (!data?.name && !data?.imageUrl) {
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
      rating,
      ratingLabel: ratingLabel.trim() || undefined,
      status,
      mealType: mealType || undefined,
      frequency: frequency || undefined,
      dish: dish.trim() || undefined,
      address: address.trim() || undefined,
      lat: coords?.lat,
      lng: coords?.lng,
      lastVisit: lastVisit ? new Date(lastVisit + 'T12:00:00').toISOString() : undefined,
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

          <label className={styles.fieldLabel}>Meal type</label>
          <div className={styles.statusRow}>
            <button
              type="button"
              className={`${styles.statusBtn} ${!mealType ? styles.statusBtnActive : ''}`}
              onClick={() => setMealType('')}
            >
              —
            </button>
            {MEAL_TYPES.map(m => (
              <button
                key={m.key}
                type="button"
                className={`${styles.statusBtn} ${mealType === m.key ? styles.statusBtnActive : ''}`}
                onClick={() => setMealType(m.key)}
              >
                {m.label}
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

function RestaurantCard({ r, distanceMiles, onClick }) {
  const isRetired = r.frequency === 'retired';
  return (
    <button type="button" className={`${styles.card} ${isRetired ? styles.cardRetired : ''}`} onClick={onClick}>
      {r.imageUrl
        ? <img src={r.imageUrl} alt="" className={styles.cardImage} />
        : <div className={`${styles.cardImage} ${styles.cardImagePlaceholder}`}>🍽️</div>}
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>{r.name}</h3>
          {r.status === 'want-to-try' && <span className={styles.wantBadge}>Want to try</span>}
          {isRetired && <span className={styles.retiredBadge}>Retired</span>}
        </div>
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

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

function RestaurantMapView({ items, onSelect }) {
  const mapPoints = useMemo(
    () => items.filter(r => typeof r.lat === 'number' && typeof r.lng === 'number'),
    [items],
  );
  const missing = items.length - mapPoints.length;
  const fallbackCenter = [40.7128, -74.0060];
  const center = mapPoints[0] ? [mapPoints[0].lat, mapPoints[0].lng] : fallbackCenter;

  return (
    <div className={styles.mapWrap}>
      {missing > 0 && (
        <div className={styles.mapHint}>
          {missing} restaurant{missing === 1 ? '' : 's'} without an address {missing === 1 ? "isn't" : "aren't"} shown.
          Open one and tap <strong>Lookup</strong> to geocode it.
        </div>
      )}
      {mapPoints.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing to plot</p>
          <p className={styles.emptyText}>
            No restaurants in this filter have an address yet. Add one and tap Lookup.
          </p>
        </div>
      ) : (
        <div className={styles.mapContainer}>
          <MapContainer center={center} zoom={12} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={mapPoints} />
            {mapPoints.map(r => (
              <Marker
                key={r.id}
                position={[r.lat, r.lng]}
                icon={r.status === 'visited' ? visitedIcon : wantIcon}
              >
                <Popup>
                  <div className={styles.mapPopup}>
                    <strong>{r.name}</strong>
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
      )}
      <div className={styles.mapLegend}>
        <span className={styles.mapLegendItem}>
          <span className={styles.mapLegendDot} style={{ background: VISITED_COLOR }} /> Visited
        </span>
        <span className={styles.mapLegendItem}>
          <span className={styles.mapLegendDot} style={{ background: WANT_COLOR }} /> Want to try
        </span>
      </div>
    </div>
  );
}

export function EatingOutPage({ user, onClose }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [activeCuisine, setActiveCuisine] = useState(null);
  const [activeLocation, setActiveLocation] = useState(null);
  const [activeMealType, setActiveMealType] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [proximityQuery, setProximityQuery] = useState('');
  const [proximityCenter, setProximityCenter] = useState(null);
  const [proximityResolving, setProximityResolving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [viewMode, setViewMode] = useState('list');

  useEffect(() => {
    if (!user?.uid) {
      setRestaurants([]);
      setLoading(false);
      return;
    }
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.metadata.hasPendingWrites) {
          const data = snap.data() || {};
          const arr = Array.isArray(data.restaurants) ? data.restaurants : [];
          setRestaurants(arr);
        }
        setLoading(false);
      },
      (err) => {
        console.error('EatingOutPage subscription error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user?.uid]);

  const cuisineSuggestions = useMemo(() => {
    const set = new Set();
    for (const r of restaurants) for (const c of (r.cuisines || [])) set.add(c);
    return Array.from(set).sort();
  }, [restaurants]);

  const locationSuggestions = useMemo(() => {
    const set = new Set();
    for (const r of restaurants) for (const l of (r.locations || [])) set.add(l);
    return Array.from(set).sort();
  }, [restaurants]);

  // Counts respect all *other* active filters so the sidebar reflects what
  // the user would actually see if they clicked. Each side ignores its own
  // active selection so unselecting is always reachable.
  const cuisineEntries = useMemo(() => {
    const counts = new Map();
    for (const r of restaurants) {
      if (!showRetired && r.frequency === 'retired') continue;
      if (filter !== 'all' && r.status !== filter) continue;
      if (activeLocation && !(r.locations || []).some(l => l.toLowerCase() === activeLocation.toLowerCase())) continue;
      if (activeMealType && r.mealType !== activeMealType) continue;
      for (const c of (r.cuisines || [])) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }
    return cuisineSuggestions.map(c => ({ name: c, count: counts.get(c) || 0 }));
  }, [restaurants, cuisineSuggestions, filter, activeLocation, activeMealType, showRetired]);

  const locationEntries = useMemo(() => {
    const counts = new Map();
    for (const r of restaurants) {
      if (!showRetired && r.frequency === 'retired') continue;
      if (filter !== 'all' && r.status !== filter) continue;
      if (activeCuisine && !(r.cuisines || []).some(c => c.toLowerCase() === activeCuisine.toLowerCase())) continue;
      if (activeMealType && r.mealType !== activeMealType) continue;
      for (const l of (r.locations || [])) {
        counts.set(l, (counts.get(l) || 0) + 1);
      }
    }
    return locationSuggestions.map(l => ({ name: l, count: counts.get(l) || 0 }));
  }, [restaurants, locationSuggestions, filter, activeCuisine, activeMealType, showRetired]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = restaurants.filter(r => {
      if (!showRetired && r.frequency === 'retired') return false;
      if (filter !== 'all' && r.status !== filter) return false;
      if (activeCuisine && !(r.cuisines || []).some(c => c.toLowerCase() === activeCuisine.toLowerCase())) return false;
      if (activeLocation && !(r.locations || []).some(l => l.toLowerCase() === activeLocation.toLowerCase())) return false;
      if (activeMealType && r.mealType !== activeMealType) return false;
      if (q) {
        const hay = [
          r.name, r.dish, r.address, r.notes, r.description, r.ratingLabel,
          ...(r.cuisines || []), ...(r.locations || []),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (proximityCenter) {
      list = list
        .map(r => {
          if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return { r, d: null };
          return { r, d: haversineMiles(proximityCenter, { lat: r.lat, lng: r.lng }) };
        })
        .filter(x => x.d != null)
        .sort((a, b) => a.d - b.d)
        .map(x => ({ ...x.r, _distance: x.d }));
    }
    return list;
  }, [restaurants, filter, activeCuisine, activeLocation, activeMealType, showRetired, search, proximityCenter]);

  const persist = useCallback(async (next) => {
    setRestaurants(next);
    if (!user?.uid) return;
    try {
      await saveField(user.uid, 'restaurants', next);
    } catch (err) {
      console.error('Failed to save restaurants:', err);
      const reason = err?.message || 'unknown error';
      alert(`Save failed — your changes are local only.\n\n${reason}\n\nTry refreshing.`);
    }
  }, [user?.uid]);

  function handleSave(restaurant) {
    const exists = restaurants.some(r => r.id === restaurant.id);
    const next = exists
      ? restaurants.map(r => (r.id === restaurant.id ? restaurant : r))
      : [restaurant, ...restaurants];
    persist(next);
    setEditing(null);
    setAdding(false);
  }

  function handleDelete(id) {
    persist(restaurants.filter(r => r.id !== id));
    setEditing(null);
  }

  function handleBulkImport(rows, strategy) {
    let next;
    let summary;
    if (strategy === 'replace-all') {
      const incomingIds = new Set(rows.map(r => r.id).filter(Boolean));
      const incomingNames = new Set(rows.map(r => (r.name || '').toLowerCase().trim()));
      const willDelete = restaurants.filter(r =>
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
      const filtered = restaurants.filter(r =>
        !incomingIds.has(r.id) && !incomingNames.has((r.name || '').toLowerCase().trim()),
      );
      next = [...rows, ...filtered];
      summary = `Imported ${rows.length} restaurant${rows.length === 1 ? '' : 's'}.`;
    } else {
      next = [...rows, ...restaurants];
      summary = `Imported ${rows.length} restaurant${rows.length === 1 ? '' : 's'}.`;
    }
    persist(next);
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
  const geocodedCount = useMemo(
    () => restaurants.filter(r => typeof r.lat === 'number' && typeof r.lng === 'number').length,
    [restaurants],
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onClose}>← Back</button>
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
        <button type="button" className={styles.secondaryBtn} onClick={() => setBulkOpen(true)}>
          Bulk import
        </button>
        <button type="button" className={styles.primaryBtn} onClick={() => setAdding(true)}>
          + Add restaurant
        </button>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarColumns}>
            <div className={styles.sidebarPanel}>
              <div className={styles.sidebarHeader}>
                <span className={styles.sidebarTitle}>Cuisines</span>
                <span className={styles.sidebarCount}>{cuisineEntries.length}</span>
              </div>
              <button
                type="button"
                className={`${styles.sidebarItem} ${!activeCuisine ? styles.sidebarItemActive : ''}`}
                onClick={() => setActiveCuisine(null)}
              >
                <span className={styles.sidebarItemName}>All cuisines</span>
              </button>
              {cuisineEntries.length === 0 ? (
                <div className={styles.sidebarEmpty}>No cuisines yet.</div>
              ) : (
                cuisineEntries.map(c => (
                  <button
                    key={`c-${c.name}`}
                    type="button"
                    className={`${styles.sidebarItem} ${activeCuisine === c.name ? styles.sidebarItemActive : ''} ${c.count === 0 ? styles.sidebarItemDim : ''}`}
                    onClick={() => setActiveCuisine(activeCuisine === c.name ? null : c.name)}
                  >
                    <span className={styles.sidebarItemName}>{c.name}</span>
                    <span className={styles.sidebarItemCount}>{c.count}</span>
                  </button>
                ))
              )}
            </div>

            <div className={styles.sidebarPanel}>
              <div className={styles.sidebarHeader}>
                <span className={styles.sidebarTitle}>Locations</span>
                <span className={styles.sidebarCount}>{locationEntries.length}</span>
              </div>
              <button
                type="button"
                className={`${styles.sidebarItem} ${!activeLocation ? styles.sidebarItemActive : ''}`}
                onClick={() => setActiveLocation(null)}
              >
                <span className={styles.sidebarItemName}>All locations</span>
              </button>
              {locationEntries.length === 0 ? (
                <div className={styles.sidebarEmpty}>No locations yet.</div>
              ) : (
                locationEntries.map(l => (
                  <button
                    key={`l-${l.name}`}
                    type="button"
                    className={`${styles.sidebarItem} ${activeLocation === l.name ? styles.sidebarItemActive : ''} ${l.count === 0 ? styles.sidebarItemDim : ''}`}
                    onClick={() => setActiveLocation(activeLocation === l.name ? null : l.name)}
                  >
                    <span className={styles.sidebarItemName}>📍 {l.name}</span>
                    <span className={styles.sidebarItemCount}>{l.count}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <main className={styles.main}>
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
                className={`${styles.filterBtn} ${viewMode === 'map' ? styles.filterBtnActive : ''}`}
                onClick={() => setViewMode('map')}
              >
                Map
              </button>
            </div>
          </div>

          <form className={styles.proximityRow} onSubmit={handleProximity}>
            <input
              type="text"
              className={styles.searchInput}
              value={proximityQuery}
              onChange={e => setProximityQuery(e.target.value)}
              placeholder="Near… (type an address and press Enter)"
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

          <div className={styles.tagFilterRow}>
            {MEAL_TYPES.map(m => (
              <button
                key={`m-${m.key}`}
                type="button"
                className={`${styles.tagFilter} ${activeMealType === m.key ? styles.tagFilterActive : ''}`}
                onClick={() => setActiveMealType(activeMealType === m.key ? null : m.key)}
              >
                {m.label}
              </button>
            ))}
            {retiredCount > 0 && (
              <button
                type="button"
                className={`${styles.tagFilter} ${showRetired ? styles.tagFilterActive : ''}`}
                onClick={() => setShowRetired(v => !v)}
              >
                {showRetired ? `Hide retired (${retiredCount})` : `Show retired (${retiredCount})`}
              </button>
            )}
          </div>

          {loading ? (
            <div className={styles.empty}>Loading…</div>
          ) : viewMode === 'map' ? (
            <RestaurantMapView items={visible} onSelect={setEditing} />
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
            <div className={styles.grid}>
              {visible.map(r => (
                <RestaurantCard
                  key={r.id}
                  r={r}
                  distanceMiles={r._distance}
                  onClick={() => setEditing(r)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {adding && (
        <EditModal
          initial={{ status: 'want-to-try', cuisines: [], locations: [], rating: null }}
          cuisineSuggestions={cuisineSuggestions}
          locationSuggestions={locationSuggestions}
          onSave={handleSave}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <EditModal
          initial={editing}
          cuisineSuggestions={cuisineSuggestions}
          locationSuggestions={locationSuggestions}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onDelete={() => handleDelete(editing.id)}
        />
      )}
      {bulkOpen && (
        <BulkImportModal
          existing={restaurants}
          onClose={() => setBulkOpen(false)}
          onImport={handleBulkImport}
        />
      )}
    </div>
  );
}
