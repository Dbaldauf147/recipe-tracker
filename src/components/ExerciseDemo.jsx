import { useEffect, useState } from 'react';

// Matched exercise demos from the public-domain free-exercise-db, via the
// /api/exercise-demo endpoint. Cached in localStorage so repeat opens are
// instant.
const CACHE_PREFIX = 'sunday-exercise-demo-v1:';

function titleCase(s) {
  return (s || '').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Real demonstration for an exercise: the start/finish form photos cross-faded
 * on a loop (so the rep "moves"), the muscles worked, and step-by-step
 * instructions. Renders a friendly message when the name can't be matched.
 */
export function ExerciseDemo({ name }) {
  const [demo, setDemo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [flip, setFlip] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const n = (name || '').trim();
    setDemo(null);
    setShowSteps(false);
    if (!n) return;
    const key = CACHE_PREFIX + n.toLowerCase();
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && 'demo' in cached) { setDemo(cached.demo); return; }
      }
    } catch { /* ignore */ }
    setLoading(true);
    fetch('/api/exercise-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n }),
    })
      .then(r => (r.ok ? r.json() : { match: null }))
      .then(d => {
        if (cancelled) return;
        const m = d && d.match ? d.match : null;
        setDemo(m);
        try { localStorage.setItem(key, JSON.stringify({ demo: m })); } catch { /* ignore */ }
      })
      .catch(() => { if (!cancelled) setDemo(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name]);

  useEffect(() => {
    if (!demo || (demo.images || []).length < 2) return;
    const id = setInterval(() => setFlip(f => !f), 1300);
    return () => clearInterval(id);
  }, [demo]);

  if (loading) {
    return <div style={{ padding: '0.75rem 0', color: 'var(--color-text-muted)' }}>Finding a demo…</div>;
  }
  if (!demo) {
    return (
      <div style={{ padding: '0.5rem 0', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.88rem' }}>
        No form demo found for this name. Try a more standard name (e.g. “Barbell Bench Press”).
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
