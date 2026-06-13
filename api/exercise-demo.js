/**
 * Exercise demo lookup — matches a free-text exercise name to the public-domain
 * free-exercise-db dataset (https://github.com/yuhonas/free-exercise-db, The
 * Unlicense) and returns real start/finish form photos, the muscles worked, the
 * equipment, and step-by-step instructions.
 *
 * POST /api/exercise-demo   Body: { name: string }
 * Returns: { match: { id, name, level, equipment, category, primaryMuscles[],
 *                     secondaryMuscles[], instructions[], images: [url0, url1] } | null }
 *
 * Each exercise has exactly two photos (the start and end of the movement), so
 * the client cross-fades them to animate the rep. No API key, no rate limits —
 * the dataset is vendored at api/_data/free-exercise-db.json.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const DATA = require('./_data/free-exercise-db.json');

const IMAGE_BASE = 'https://yuhonas.github.io/free-exercise-db/exercises/';

// Normalize a free-text name to a single lowercase, space-separated key.
function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Library-specific rewrites: gym/app names that don't tokenize onto the dataset
// wording even after the generic rules below. Each maps a normalized input name
// to a query string that DOES land on the right free-exercise-db entry. Names
// not listed here (and genuinely absent from the dataset — sauna, yoga, warm-up)
// are left to fall through and are handled by the client's AI-image fallback.
const ALIASES = {
  'cable woodchoppers': 'standing cable wood chop',
  'cable woodchoppers high to low': 'standing cable wood chop',
  'deadbug': 'dead bug',
  'elbow plank': 'plank',
  'cable lat pullover': 'straight-arm dumbbell pullover',
  'lat pull downs bar underhand grip': 'underhand cable pulldowns',
  'middle grip row': 'seated cable row',
  'plate loaded low row': 'seated cable row',
  'seated neutral grip row': 'seated cable row',
  'seated pronated machine row': 'seated cable row',
  'seated vertical row machine': 'seated cable row',
  'wide grip row': 'seated cable row',
  'inclined machine press': 'incline dumbbell press',
  'air squats': 'bodyweight squat',
  'curtsey lunges': 'crossover reverse lunge',
  'seated abductors': 'thigh abductor',
  'sumo squat': 'plie dumbbell squat',
  'sumo squat cable machine': 'plie dumbbell squat',
};

// String-level rewrites (applied before tokenizing) that expand gym shorthand
// and collapse compound moves to single tokens so "pull up", "pull-up" and
// "pullups" all land on the same token the dataset uses.
const PHRASES = [
  [/\bohp\b/g, 'overhead press'],
  [/\brdl\b/g, 'romanian deadlift'],
  [/\bsldl\b/g, 'stiff leg deadlift'],
  [/\bdb\b/g, 'dumbbell'],
  [/\bbb\b/g, 'barbell'],
  [/\bkb\b/g, 'kettlebell'],
  [/\bbw\b/g, 'bodyweight'],
  [/\bpull\s*ups?\b/g, 'pullup'],
  [/\bpush\s*ups?\b/g, 'pushup'],
  [/\bchin\s*ups?\b/g, 'chinup'],
  [/\bsit\s*ups?\b/g, 'situp'],
  [/\bpull\s*downs?\b/g, 'pulldown'],
  [/\bpush\s*downs?\b/g, 'pushdown'],
  [/\bpress\s*downs?\b/g, 'pushdown'],
  [/\bwood\s*chopp?ers?\b/g, 'wood chop'],
  [/\bdeadbug\b/g, 'dead bug'],
  [/\bjump\s*rope\b/g, 'rope jumping'],
  [/\btri\s*cep[s]?\b/g, 'triceps'],
  [/\bbi\s*cep[s]?\b/g, 'biceps'],
  [/\bdumbells?\b/g, 'dumbbell'],
];
// Irregular trailing plurals → the dataset's singular wording.
const SINGULARIZE = {
  presses: 'press', curls: 'curl', raises: 'raise', rows: 'row', squats: 'squat',
  lunges: 'lunge', extensions: 'extension', flyes: 'fly', flys: 'fly', flies: 'fly',
  deadlifts: 'deadlift', dips: 'dip', crunches: 'crunch', thrusters: 'thruster',
  kickbacks: 'kickback', pushdowns: 'pushdown', pulldowns: 'pulldown',
};
// Plural-looking words that must NOT be singularized (e.g. the dataset spells
// these muscles/moves with a trailing "s").
const PROTECT = new Set(['triceps', 'biceps', 'abs', 'lats', 'glutes', 'press']);
// Words that carry no matching signal.
const STOP = new Set(['the', 'a', 'an', 'with', 'and', 'on', 'to', 'of', 'for', 'grip', 'standing', 'seated', 'machine']);

// Reduce a single token to its singular form: explicit map first, then a generic
// "drop trailing s" (skipping words that end in ss/us/is) so plurals like
// "pulls" → "pull" and "bridges" → "bridge" land on the dataset wording.
function singular(t) {
  if (SINGULARIZE[t]) return SINGULARIZE[t];
  if (PROTECT.has(t)) return t;
  if (t.length > 3 && /s$/.test(t) && !/(ss|us|is)$/.test(t)) {
    return t.replace(/ies$/, 'y').replace(/s$/, '');
  }
  return t;
}

export function tokenize(name) {
  let s = ` ${String(name || '').toLowerCase()} `.replace(/[^a-z0-9]+/g, ' ');
  for (const [re, rep] of PHRASES) s = s.replace(re, ` ${rep} `);
  const raw = s.split(/\s+/).filter(Boolean);
  const out = [];
  for (let t of raw) {
    t = singular(t);
    if (STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

// Precompute token sets once per cold start.
const INDEX = DATA.map(e => ({ e, tokens: new Set(tokenize(e.name)) }));

export function bestMatch(rawQuery) {
  const query = ALIASES[normKey(rawQuery)] || rawQuery;
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return null;
  const qSet = new Set(qTokens);
  let best = null;
  let bestScore = 0;
  for (const { e, tokens } of INDEX) {
    let shared = 0;
    for (const t of qSet) if (tokens.has(t)) shared++;
    if (shared === 0) continue;
    const extra = tokens.size - shared;             // words the candidate has that the query didn't
    const missing = qSet.size - shared;             // query words not in the candidate
    const containment = missing === 0 ? 5 : 0;      // bonus when the whole query is covered
    const score = shared * 3 + containment - extra * 0.4 - missing * 1.5;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  // Require a meaningful overlap so we don't return nonsense for unknown names.
  if (!best || bestScore < 3) return null;
  return best;
}

function toUrl(rel) {
  return IMAGE_BASE + encodeURI(String(rel || ''));
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  const e = bestMatch(name.trim());
  if (!e) return res.status(200).json({ match: null });
  return res.status(200).json({
    match: {
      id: e.id,
      name: e.name,
      level: e.level || null,
      equipment: e.equipment || null,
      category: e.category || null,
      primaryMuscles: e.primaryMuscles || [],
      secondaryMuscles: e.secondaryMuscles || [],
      instructions: e.instructions || [],
      images: (e.images || []).map(toUrl),
    },
  });
}
