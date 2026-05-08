import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import styles from './EatingOutPage.module.css';

// Backend mirror of the mobile Eating Out tab. Reads & writes the same
// `restaurants` field on the user's Firestore doc, so changes on either
// platform sync live.

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'want-to-try', label: 'Want to try' },
  { key: 'visited', label: 'Visited' },
];

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
  const [status, setStatus] = useState(initial.status || 'want-to-try');
  const [extracting, setExtracting] = useState(false);

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
      status,
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

          <label className={styles.fieldLabel}>Cuisines / food types</label>
          <TagChips
            values={cuisines}
            onChange={setCuisines}
            suggestions={cuisineSuggestions}
            placeholder="Type a cuisine and press Enter"
          />

          <label className={styles.fieldLabel}>Locations</label>
          <TagChips
            values={locations}
            onChange={setLocations}
            suggestions={locationSuggestions}
            placeholder="Type a location and press Enter"
          />

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

function RestaurantCard({ r, onClick }) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      {r.imageUrl
        ? <img src={r.imageUrl} alt="" className={styles.cardImage} />
        : <div className={`${styles.cardImage} ${styles.cardImagePlaceholder}`}>🍽️</div>}
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>{r.name}</h3>
          {r.status === 'want-to-try' && <span className={styles.wantBadge}>Want to try</span>}
        </div>
        {r.rating != null && (
          <div className={styles.cardStars}>
            {[1, 2, 3, 4, 5].map(n => (
              <span key={n} className={n <= r.rating ? styles.starFilled : styles.starEmpty}>
                {n <= r.rating ? '★' : '☆'}
              </span>
            ))}
          </div>
        )}
        {(r.cuisines?.length > 0 || r.locations?.length > 0) && (
          <div className={styles.cardMeta}>
            {[...(r.cuisines || []), ...(r.locations || [])].join(' · ')}
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

export function EatingOutPage({ user, onClose }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [activeCuisine, setActiveCuisine] = useState(null);
  const [activeLocation, setActiveLocation] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  // Subscribe to the user doc — keeps the website list in sync with the
  // mobile app, since both write the same `restaurants` field.
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return restaurants.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (activeCuisine && !(r.cuisines || []).some(c => c.toLowerCase() === activeCuisine.toLowerCase())) return false;
      if (activeLocation && !(r.locations || []).some(l => l.toLowerCase() === activeLocation.toLowerCase())) return false;
      if (q) {
        const hay = [r.name, ...(r.cuisines || []), ...(r.locations || []), r.notes || '', r.description || ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [restaurants, filter, activeCuisine, activeLocation, search]);

  const persist = useCallback(async (next) => {
    setRestaurants(next);
    if (!user?.uid) return;
    try {
      await saveField(user.uid, 'restaurants', next);
    } catch (err) {
      console.error('Failed to save restaurants:', err);
      alert('Save failed — your changes are local only. Try refreshing.');
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onClose}>← Back</button>
        <h1 className={styles.title}>Eating Out</h1>
        <button type="button" className={styles.primaryBtn} onClick={() => setAdding(true)}>
          + Add restaurant
        </button>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.searchInput}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search restaurants, cuisines, places…"
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
      </div>

      {(cuisineSuggestions.length > 0 || locationSuggestions.length > 0) && (
        <div className={styles.tagFilterRow}>
          {cuisineSuggestions.map(c => (
            <button
              key={`c-${c}`}
              type="button"
              className={`${styles.tagFilter} ${activeCuisine === c ? styles.tagFilterActive : ''}`}
              onClick={() => setActiveCuisine(activeCuisine === c ? null : c)}
            >
              {c}
            </button>
          ))}
          {locationSuggestions.map(l => (
            <button
              key={`l-${l}`}
              type="button"
              className={`${styles.tagFilter} ${activeLocation === l ? styles.tagFilterActive : ''}`}
              onClick={() => setActiveLocation(activeLocation === l ? null : l)}
            >
              📍 {l}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          {restaurants.length === 0 ? (
            <>
              <p className={styles.emptyTitle}>No restaurants yet</p>
              <p className={styles.emptyText}>
                Save Instagram videos and websites for places you want to eat at.
                The mobile app syncs both ways.
              </p>
              <button type="button" className={styles.primaryBtn} onClick={() => setAdding(true)}>
                + Add your first
              </button>
            </>
          ) : (
            <p className={styles.emptyText}>Nothing matches. Try clearing filters or the search box.</p>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map(r => (
            <RestaurantCard key={r.id} r={r} onClick={() => setEditing(r)} />
          ))}
        </div>
      )}

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
    </div>
  );
}
