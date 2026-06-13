// Front/back body map that highlights the muscles an exercise targets.
// Muscle names match the free-exercise-db vocabulary returned by
// /api/exercise-demo (lowercase: "chest", "quadriceps", "lats", …). Primary
// muscles fill solid in the accent colour; secondary muscles fill a lighter
// tint. Anything not targeted stays the neutral body-silhouette colour.

const PRIMARY_FILL = 'var(--color-accent)';
const SECONDARY_FILL = 'color-mix(in srgb, var(--color-accent) 38%, transparent)';
const BODY_FILL = '#e2e8f0';
const BODY_STROKE = '#cbd5e1';

// Shared neutral silhouette, drawn behind the muscle overlays in both views.
function Silhouette() {
  const p = { fill: BODY_FILL, stroke: BODY_STROKE, strokeWidth: 1 };
  return (
    <g>
      <circle cx="60" cy="20" r="13" {...p} />
      <rect x="55" y="31" width="10" height="8" {...p} />
      <circle cx="40" cy="47" r="9" {...p} />
      <circle cx="80" cy="47" r="9" {...p} />
      <polygon points="42,42 78,42 73,101 47,101" {...p} />
      <rect x="29" y="48" width="12" height="36" rx="6" {...p} />
      <rect x="79" y="48" width="12" height="36" rx="6" {...p} />
      <rect x="30" y="82" width="10" height="36" rx="5" {...p} />
      <rect x="80" y="82" width="10" height="36" rx="5" {...p} />
      <circle cx="35" cy="121" r="5" {...p} />
      <circle cx="85" cy="121" r="5" {...p} />
      <polygon points="47,100 73,100 70,123 50,123" {...p} />
      <rect x="48" y="121" width="11" height="48" rx="5" {...p} />
      <rect x="61" y="121" width="11" height="48" rx="5" {...p} />
      <rect x="49" y="167" width="9" height="48" rx="4" {...p} />
      <rect x="62" y="167" width="9" height="48" rx="4" {...p} />
    </g>
  );
}

// Each muscle maps to render fns per view. `f` is the fill colour to use.
// Symmetric muscles draw a mirrored left/right pair. Coordinates are tuned to
// sit on top of the silhouette above.
const REGIONS = {
  neck: {
    front: f => <rect x="55" y="31" width="10" height="8" rx="2" fill={f} />,
    back: f => <rect x="55" y="31" width="10" height="8" rx="2" fill={f} />,
  },
  traps: {
    front: f => <><ellipse cx="50" cy="43" rx="5" ry="3" fill={f} /><ellipse cx="70" cy="43" rx="5" ry="3" fill={f} /></>,
    back: f => <ellipse cx="60" cy="46" rx="15" ry="8" fill={f} />,
  },
  shoulders: {
    front: f => <><circle cx="40" cy="47" r="8" fill={f} /><circle cx="80" cy="47" r="8" fill={f} /></>,
    back: f => <><circle cx="40" cy="47" r="8" fill={f} /><circle cx="80" cy="47" r="8" fill={f} /></>,
  },
  chest: {
    front: f => <><ellipse cx="52" cy="57" rx="8" ry="6" fill={f} /><ellipse cx="68" cy="57" rx="8" ry="6" fill={f} /></>,
  },
  abdominals: {
    front: f => <rect x="53" y="66" width="14" height="26" rx="3" fill={f} />,
  },
  biceps: {
    front: f => <><ellipse cx="35" cy="61" rx="5" ry="11" fill={f} /><ellipse cx="85" cy="61" rx="5" ry="11" fill={f} /></>,
  },
  triceps: {
    back: f => <><ellipse cx="35" cy="61" rx="5" ry="11" fill={f} /><ellipse cx="85" cy="61" rx="5" ry="11" fill={f} /></>,
  },
  forearms: {
    front: f => <><ellipse cx="35" cy="99" rx="5" ry="13" fill={f} /><ellipse cx="85" cy="99" rx="5" ry="13" fill={f} /></>,
    back: f => <><ellipse cx="35" cy="99" rx="5" ry="13" fill={f} /><ellipse cx="85" cy="99" rx="5" ry="13" fill={f} /></>,
  },
  lats: {
    back: f => <><path d="M44 60 q9 4 8 18 l-6 0 q-4 -10 -2 -18 Z" fill={f} /><path d="M76 60 q-9 4 -8 18 l6 0 q4 -10 2 -18 Z" fill={f} /></>,
  },
  'middle back': {
    back: f => <rect x="54" y="56" width="12" height="16" rx="2" fill={f} />,
  },
  'lower back': {
    back: f => <rect x="54" y="82" width="12" height="16" rx="2" fill={f} />,
  },
  glutes: {
    back: f => <><ellipse cx="53" cy="114" rx="8" ry="9" fill={f} /><ellipse cx="67" cy="114" rx="8" ry="9" fill={f} /></>,
  },
  quadriceps: {
    front: f => <><ellipse cx="53" cy="140" rx="6" ry="22" fill={f} /><ellipse cx="67" cy="140" rx="6" ry="22" fill={f} /></>,
  },
  hamstrings: {
    back: f => <><ellipse cx="53" cy="144" rx="6" ry="20" fill={f} /><ellipse cx="67" cy="144" rx="6" ry="20" fill={f} /></>,
  },
  abductors: {
    front: f => <><ellipse cx="46" cy="126" rx="3" ry="9" fill={f} /><ellipse cx="74" cy="126" rx="3" ry="9" fill={f} /></>,
  },
  adductors: {
    front: f => <><ellipse cx="56" cy="135" rx="3" ry="13" fill={f} /><ellipse cx="64" cy="135" rx="3" ry="13" fill={f} /></>,
  },
  calves: {
    back: f => <><ellipse cx="53" cy="189" rx="5" ry="14" fill={f} /><ellipse cx="67" cy="189" rx="5" ry="14" fill={f} /></>,
  },
};

// Common user/abbreviated terms → the canonical region key used in REGIONS.
const SYNONYMS = {
  quad: 'quadriceps', quads: 'quadriceps', quadricep: 'quadriceps',
  ham: 'hamstrings', hams: 'hamstrings', hamstring: 'hamstrings',
  glute: 'glutes', gluteus: 'glutes', gluteals: 'glutes',
  pec: 'chest', pecs: 'chest', pectoral: 'chest', pectorals: 'chest',
  delt: 'shoulders', delts: 'shoulders', deltoid: 'shoulders', deltoids: 'shoulders', shoulder: 'shoulders',
  lat: 'lats', latissimus: 'lats',
  ab: 'abdominals', abs: 'abdominals', core: 'abdominals', abdominal: 'abdominals', obliques: 'abdominals',
  bicep: 'biceps', tricep: 'triceps',
  calf: 'calves', calfs: 'calves',
  trap: 'traps', trapezius: 'traps',
  erectors: 'lower back', 'spinal erectors': 'lower back', 'upper back': 'middle back',
};

function canon(m) {
  const k = String(m).toLowerCase().trim();
  return SYNONYMS[k] || k;
}

function norm(list) {
  return new Set((list || []).map(canon).filter(Boolean));
}

// Accepts an array, or a free-text string like "Chest, Triceps and Shoulders",
// and returns an array of muscle names (canonicalised later by norm()).
export function toMuscleList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value)
    .split(/[,/&;|]+|\band\b/i)
    .map(s => s.trim())
    .filter(Boolean);
}

function Figure({ view, label, fillFor }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg viewBox="0 0 120 222" width="110" style={{ maxWidth: '100%' }} role="img" aria-label={`${label} body map`}>
        <Silhouette />
        {Object.entries(REGIONS).map(([muscle, views]) => {
          const render = views[view];
          const fill = fillFor(muscle);
          if (!render || !fill) return null;
          return <g key={muscle}>{render(fill)}</g>;
        })}
      </svg>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  );
}

export function MuscleBodyMap({ primary = [], secondary = [] }) {
  const primarySet = norm(primary);
  const secondarySet = norm(secondary);
  if (primarySet.size === 0 && secondarySet.size === 0) return null;

  const fillFor = m => (primarySet.has(m) ? PRIMARY_FILL : secondarySet.has(m) ? SECONDARY_FILL : null);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18 }}>
        <Figure view="front" label="Front" fillFor={fillFor} />
        <Figure view="back" label="Back" fillFor={fillFor} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-secondary, #475569)' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: PRIMARY_FILL, display: 'inline-block' }} /> Primary
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-secondary, #475569)' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: SECONDARY_FILL, border: `1px solid ${BODY_STROKE}`, display: 'inline-block' }} /> Secondary
        </span>
      </div>
    </div>
  );
}
