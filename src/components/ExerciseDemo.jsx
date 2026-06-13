import { useEffect, useRef, useState } from 'react';
import { MuscleBodyMap, toMuscleList } from './MuscleMap';

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
  const imgs = demo?.images || [];

  useEffect(() => {
    if (imgs.length < 2) return;
    const id = setInterval(() => setFlip(f => !f), 1300);
    return () => clearInterval(id);
  }, [imgs.length]);

  const box = { width: size, height: size, borderRadius: 8, flexShrink: 0 };

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
export function ExerciseDemo({ name, fallbackPrimary, fallbackSecondary, showMuscleMap = true }) {
  const [flip, setFlip] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const { demo, aiImage, loading } = useExerciseDemoMatch(name, true);

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

      {(primary.length > 0 || secondary.length > 0) && (
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
    </div>
  );
}
