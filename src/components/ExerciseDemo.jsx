import { useCallback, useEffect, useRef, useState } from 'react';
import { MuscleBodyMap, toMuscleList } from './MuscleMap';
import {
  getCachedExerciseImage, getCachedExerciseImageRecord, compressImage,
  renderFramedImage, saveExerciseImage, deleteExerciseImage,
  framedLayout, FRAME_ASPECT, DEFAULT_TRANSFORM,
} from '../utils/exerciseImages';

/**
 * A user-uploaded custom photo for `name`, or null. Re-reads whenever the
 * exercise-image cache changes (upload, delete, or the login-time sync), so the
 * thumbnail and popup update the moment a photo is added or removed.
 */
export function useCustomExerciseImage(name) {
  const [img, setImg] = useState(() => getCachedExerciseImage(name));
  useEffect(() => {
    const read = () => setImg(getCachedExerciseImage(name));
    read();
    window.addEventListener('exercise-images-synced', read);
    return () => window.removeEventListener('exercise-images-synced', read);
  }, [name]);
  return img;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * Drag-to-pan + zoom framing dialog, opened right after picking a photo and
 * again from "Adjust". The frame matches the aspect ratio the demo popup
 * renders, and Save bakes the framing into the stored image — so the thumbnail,
 * the popup, and the (read-only) mobile app all show exactly this crop.
 */
function ExerciseImageAdjuster({ name, source, initialTransform, onSaved, onClose }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState(null); // { w, h }
  const [transform, setTransform] = useState(() => ({ ...DEFAULT_TRANSFORM, ...(initialTransform || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Track the frame's rendered size so the preview math matches the bake.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setErr("Couldn't read that image.");
    img.src = source;
  }, [source]);

  const layout = natural && frame.w
    ? framedLayout({ naturalW: natural.w, naturalH: natural.h, frameW: frame.w, frameH: frame.h, transform })
    : null;

  // Pan in frame-fractions so the stored offset is resolution-independent, and
  // clamp against the current zoom so an edge never enters the frame.
  const nudge = useCallback((dxPx, dyPx) => {
    if (!frame.w || !natural) return;
    setTransform(t => {
      const l = framedLayout({
        naturalW: natural.w, naturalH: natural.h, frameW: frame.w, frameH: frame.h,
        transform: { ...t, ox: (t.ox || 0) + dxPx / frame.w, oy: (t.oy || 0) + dyPx / frame.h },
      });
      return { ...t, ox: l.ox, oy: l.oy };
    });
  }, [frame.w, frame.h, natural]);

  function onPointerDown(e) {
    if (!layout) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    nudge(e.clientX - d.x, e.clientY - d.y);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e) {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }

  function setZoom(z) {
    setTransform(t => ({ ...t, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) }));
    // Re-clamp the pan: zooming out can leave the old offset out of bounds.
    nudge(0, 0);
  }

  async function onSave() {
    setBusy(true);
    setErr('');
    try {
      const dataUrl = await renderFramedImage(source, transform);
      await saveExerciseImage(name, { dataUrl, source, transform });
      onSaved?.();
      onClose();
    } catch {
      setErr('Saving failed. Try a different image.');
      setBusy(false);
    }
  }

  const btn = (extra = {}) => ({
    borderRadius: 8, padding: '7px 14px', fontSize: '0.85rem', fontWeight: 700,
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, ...extra,
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-bg, #fff)', borderRadius: 14, padding: '1rem',
          width: 'min(94vw, 460px)', boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: 8 }}>Position your photo</div>
        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'relative', width: '100%', aspectRatio: String(FRAME_ASPECT),
            borderRadius: 12, overflow: 'hidden', background: '#0f172a',
            border: '1px solid var(--color-border)', cursor: 'grab', touchAction: 'none',
          }}
        >
          {layout && (
            <img
              src={source}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: layout.left, top: layout.top, width: layout.width, height: layout.height,
                maxWidth: 'none', userSelect: 'none', pointerEvents: 'none',
              }}
            />
          )}
          {/* Centering guides — the frame edges are the crop. */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)' }} />
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM} max={MAX_ZOOM} step={0.01}
            value={transform.zoom}
            onChange={e => setZoom(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => setTransform({ ...DEFAULT_TRANSFORM })}
            style={btn({ border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', padding: '5px 10px', fontSize: '0.78rem' })}
          >
            Center
          </button>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 6 }}>
          Drag the photo to move it. Everything outside the frame is cropped off.
        </div>

        {err && <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 6 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onClose} disabled={busy} style={btn({ border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)' })}>
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={busy || !layout} style={btn({ border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff' })}>
            {busy ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Upload / adjust / remove control for an exercise's custom photo. Shown inside
 * the demo popup. A custom photo replaces the auto-matched form demo everywhere.
 */
function ExerciseImageControls({ name, hasCustom }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // { source, transform } while the framing dialog is open; null when closed.
  const [editing, setEditing] = useState(null);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setErr('');
    setBusy(true);
    try {
      // Shrink first, then frame it — nothing is saved until Save is pressed.
      const source = await compressImage(file);
      setEditing({ source, transform: { ...DEFAULT_TRANSFORM } });
    } catch {
      setErr('Upload failed. Try a different image.');
    } finally {
      setBusy(false);
    }
  }

  function onAdjust() {
    const rec = getCachedExerciseImageRecord(name);
    if (!rec) return;
    // Re-frame the untouched original when we still have it; otherwise the saved
    // crop is all there is — and its transform is already baked in, so start
    // that one from centered rather than applying the offsets twice.
    setEditing(rec.source
      ? { source: rec.source, transform: rec.transform || { ...DEFAULT_TRANSFORM } }
      : { source: rec.dataUrl, transform: { ...DEFAULT_TRANSFORM } });
  }

  async function onRemove() {
    setBusy(true);
    try { await deleteExerciseImage(name); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      {editing && (
        <ExerciseImageAdjuster
          name={name}
          source={editing.source}
          initialTransform={editing.transform}
          onClose={() => setEditing(null)}
        />
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{
          border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff',
          borderRadius: 8, padding: '6px 12px', fontSize: '0.82rem', fontWeight: 700,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Uploading…' : hasCustom ? '📷 Replace photo' : '📷 Upload your own photo'}
      </button>
      {hasCustom && !busy && (
        <button
          type="button"
          onClick={onAdjust}
          style={{
            border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)',
            borderRadius: 8, padding: '6px 12px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
          }}
        >
          ✥ Adjust
        </button>
      )}
      {hasCustom && !busy && (
        <button
          type="button"
          onClick={onRemove}
          style={{
            border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)',
            borderRadius: 8, padding: '6px 12px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Remove
        </button>
      )}
      {err && <span style={{ color: '#dc2626', fontSize: '0.8rem' }}>{err}</span>}
    </div>
  );
}

// Matched exercise demos from the public-domain free-exercise-db, via the
// /api/exercise-demo endpoint. Cached in localStorage so repeat opens are
// instant.
const CACHE_PREFIX = 'sunday-exercise-demo-v1:';

// Passive / recovery / yoga entries that have no demonstrable "form", so we
// don't burn an AI generation trying to illustrate them when the form-photo
// lookup misses.
const NON_DEMO = /\b(sauna|hot\s*tub|hottub|steam\s*room|yoga|vinyasa|bikram|yin|warm\s*up|cool\s*down|rest\s*day|nap|sleep|meditat|walk|jog|run|recumbent|bike|cycling|elliptical|stairmaster)\b/i;

function titleCase(s) {
  return (s || '').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Shared fetch+cache for an exercise demo match. Returns { demo, loading }.
 * `enabled` lets a caller defer the network call until needed — e.g. a
 * thumbnail that only loads once it scrolls into view. The localStorage cache
 * key is shared with every caller, so the table thumbnails and the full-size
 * modal never re-fetch the same name.
 */
export function useExerciseDemoMatch(name, enabled = true) {
  const [demo, setDemo] = useState(null);
  const [aiImage, setAiImage] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const n = (name || '').trim();
    setDemo(null);
    setAiImage(null);
    if (!n || !enabled) return;
    const key = CACHE_PREFIX + n.toLowerCase();
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && ('demo' in cached || 'ai' in cached)) {
          setDemo(cached.demo || null);
          setAiImage(cached.ai || null);
          return;
        }
      }
    } catch { /* ignore */ }

    setLoading(true);
    (async () => {
      // 1. Try the free-exercise-db form photos.
      let match = null;
      try {
        const r = await fetch('/api/exercise-demo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: n }),
        });
        const d = r.ok ? await r.json() : { match: null };
        match = d && d.match ? d.match : null;
      } catch { match = null; }
      if (cancelled) return;
      if (match) {
        setDemo(match);
        setLoading(false);
        try { localStorage.setItem(key, JSON.stringify({ demo: match })); } catch { /* ignore */ }
        return;
      }

      // 2. No form match. Recovery/yoga/passive entries have no "form" to show.
      if (NON_DEMO.test(n)) {
        setLoading(false);
        try { localStorage.setItem(key, JSON.stringify({ demo: null })); } catch { /* ignore */ }
        return;
      }

      // 3. Real exercise we couldn't match — fall back to an AI illustration.
      let aiUrl = null;
      try {
        const r = await fetch('/api/exercise-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: n }),
        });
        if (r.ok) { const d = await r.json(); aiUrl = d && d.url ? d.url : null; }
      } catch { aiUrl = null; }
      if (cancelled) return;
      setAiImage(aiUrl);
      setLoading(false);
      // Only cache a positive result so transient generation failures retry.
      if (aiUrl) {
        try { localStorage.setItem(key, JSON.stringify({ demo: null, ai: aiUrl })); } catch { /* ignore */ }
      }
    })();

    return () => { cancelled = true; };
  }, [name, enabled]);

  return { demo, aiImage, loading };
}

/**
 * Compact, lazy-loaded thumbnail of an exercise's form photos — cross-faded on
 * a loop so the rep "moves". Defers its fetch until scrolled into view, and
 * calls onOpen(name) when clicked (the parent shows the full ExerciseDemo).
 */
export function ExerciseDemoThumb({ name, onOpen, size = 56 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [flip, setFlip] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '250px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const { demo, loading } = useExerciseDemoMatch(name, visible);
  const custom = useCustomExerciseImage(name);
  const imgs = demo?.images || [];

  useEffect(() => {
    if (imgs.length < 2) return;
    const id = setInterval(() => setFlip(f => !f), 1300);
    return () => clearInterval(id);
  }, [imgs.length]);

  const box = { width: size, height: size, borderRadius: 8, flexShrink: 0 };

  // A user-uploaded photo wins over the auto-matched form demo.
  if (custom) {
    return (
      <div ref={ref} style={box}>
        <button
          type="button"
          onClick={() => onOpen?.(name)}
          title={`${name} — your photo`}
          style={{ ...box, position: 'relative', overflow: 'hidden', padding: 0, cursor: 'pointer', border: '1px solid var(--color-border)', background: '#fff' }}
        >
          <img src={custom} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} style={box}>
      {imgs.length > 0 ? (
        <button
          type="button"
          onClick={() => onOpen?.(name)}
          title={`${demo?.name || name} — tap for form demo`}
          style={{ ...box, position: 'relative', overflow: 'hidden', padding: 0, cursor: 'pointer', border: '1px solid var(--color-border)', background: '#fff' }}
        >
          <img src={imgs[0]} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          {imgs[1] && (
            <img src={imgs[1]} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: flip ? 1 : 0, transition: 'opacity 0.6s ease-in-out' }} />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpen?.(name)}
          title={`${name} — muscle map`}
          style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 18, cursor: 'pointer' }}
        >
          {!visible || loading ? '…' : '💪'}
        </button>
      )}
    </div>
  );
}

/**
 * Real demonstration for an exercise: the start/finish form photos cross-faded
 * on a loop (so the rep "moves"), the muscles worked, and step-by-step
 * instructions. Renders a friendly message when the name can't be matched.
 */
export function ExerciseDemo({ name, fallbackPrimary, fallbackSecondary, showMuscleMap = true, showMuscles = true }) {
  const [flip, setFlip] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const { demo, aiImage, loading } = useExerciseDemoMatch(name, true);
  const custom = useCustomExerciseImage(name);

  // Body-map muscles: prefer the matched demo's data; otherwise fall back to the
  // exercise's own library Primary/Secondary columns, so the map shows for every
  // exercise — even ones with no form-photo match.
  const mapPrimary = demo?.primaryMuscles?.length ? demo.primaryMuscles : toMuscleList(fallbackPrimary);
  const mapSecondary = demo?.secondaryMuscles?.length ? demo.secondaryMuscles : toMuscleList(fallbackSecondary);

  useEffect(() => { setShowSteps(false); }, [name]);

  useEffect(() => {
    if (!demo || (demo.images || []).length < 2) return;
    const id = setInterval(() => setFlip(f => !f), 1300);
    return () => clearInterval(id);
  }, [demo]);

  // A user-uploaded photo wins over the auto demo / AI illustration. Still show
  // the muscle map, and the controls to replace or remove it.
  if (custom) {
    return (
      <div>
        {/* Same aspect the adjuster framed to, so what you positioned is what shows. */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: String(FRAME_ASPECT), borderRadius: 12, overflow: 'hidden', background: '#fff', border: '1px solid var(--color-border)' }}>
          <img src={custom} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px' }}>📷 Your photo</span>
        </div>
        {showMuscleMap && <MuscleBodyMap primary={mapPrimary} secondary={mapSecondary} />}
        <ExerciseImageControls name={name} hasCustom />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '0.75rem 0', color: 'var(--color-text-muted)' }}>Finding a demo…</div>;
  }
  if (!demo && aiImage) {
    return (
      <div>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: '#fff', border: '1px solid var(--color-border)' }}>
          <img src={aiImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px' }}>✨ AI illustration</span>
        </div>
        <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          No form photos for this one — here’s an AI illustration instead.
        </div>
        {showMuscleMap && <MuscleBodyMap primary={mapPrimary} secondary={mapSecondary} />}
        <ExerciseImageControls name={name} />
      </div>
    );
  }
  if (!demo) {
    return (
      <div>
        {showMuscleMap && <MuscleBodyMap primary={mapPrimary} secondary={mapSecondary} />}
        <div style={{ padding: '0.5rem 0', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.88rem' }}>
          No form demo found for this name. Try a more standard name (e.g. “Barbell Bench Press”).
        </div>
        <ExerciseImageControls name={name} />
      </div>
    );
  }

  const imgs = demo.images || [];
  const primary = demo.primaryMuscles || [];
  const secondary = demo.secondaryMuscles || [];

  return (
    <div>
      {imgs.length > 0 && (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1.3', borderRadius: 12, overflow: 'hidden', background: '#fff', border: '1px solid var(--color-border)' }}>
          <img src={imgs[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          {imgs[1] && (
            <img src={imgs[1]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: flip ? 1 : 0, transition: 'opacity 0.6s ease-in-out' }} />
          )}
          <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px' }}>● demo</span>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: 8 }}>
        {demo.name}{demo.equipment ? `  ·  ${titleCase(demo.equipment)}` : ''}
      </div>

      {showMuscleMap && <MuscleBodyMap primary={mapPrimary} secondary={mapSecondary} />}

      {showMuscles && (primary.length > 0 || secondary.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {primary.map(m => (
            <span key={`p-${m}`} style={{ background: 'var(--color-accent)', color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{titleCase(m)}</span>
          ))}
          {secondary.map(m => (
            <span key={`s-${m}`} style={{ background: 'var(--color-surface, #f1f5f9)', color: 'var(--color-text-secondary, #475569)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{titleCase(m)}</span>
          ))}
        </div>
      )}

      {(demo.instructions || []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowSteps(s => !s)}
            style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontWeight: 700, cursor: 'pointer', padding: '4px 0', fontSize: '0.85rem' }}
          >
            {showSteps ? 'Hide steps' : `How to do it (${demo.instructions.length} steps)`}
          </button>
          {showSteps && (
            <ol style={{ margin: '4px 0 0', paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {demo.instructions.map((s, i) => (
                <li key={i} style={{ fontSize: '0.85rem', lineHeight: 1.45 }}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <ExerciseImageControls name={name} />
    </div>
  );
}

/**
 * Just the muscles worked — the body map plus primary/secondary pills — with no
 * form photos or upload controls. Split out of `ExerciseDemo` so the exercise
 * popup's "Muscles" tab can own this view while the "Videos" tab owns the form
 * photos. Muscle data comes from the matched demo, falling back to the
 * exercise's own library Primary/Secondary columns.
 */
export function ExerciseMuscles({ name, fallbackPrimary, fallbackSecondary }) {
  const { demo, loading } = useExerciseDemoMatch(name, true);

  const primary = demo?.primaryMuscles?.length ? demo.primaryMuscles : toMuscleList(fallbackPrimary);
  const secondary = demo?.secondaryMuscles?.length ? demo.secondaryMuscles : toMuscleList(fallbackSecondary);

  if (loading && !primary.length && !secondary.length) {
    return <div style={{ padding: '0.75rem 0', color: 'var(--color-text-muted)' }}>Looking up muscles…</div>;
  }

  if (!primary.length && !secondary.length) {
    return (
      <div style={{ padding: '0.75rem 0', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.88rem' }}>
        No muscles recorded for this one. Fill in the Primary/Secondary columns on the Exercises tab and they’ll show up here.
      </div>
    );
  }

  return (
    <div>
      <MuscleBodyMap primary={primary} secondary={secondary} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {primary.map(m => (
          <span key={`p-${m}`} style={{ background: 'var(--color-accent)', color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{titleCase(m)}</span>
        ))}
        {secondary.map(m => (
          <span key={`s-${m}`} style={{ background: 'var(--color-surface, #f1f5f9)', color: 'var(--color-text-secondary, #475569)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{titleCase(m)}</span>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        Filled = primary · outlined = secondary
      </div>
    </div>
  );
}
