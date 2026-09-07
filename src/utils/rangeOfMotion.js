// Range-of-motion reference for the Stretch page.
//
// The goal board above it answers "how much time have I held this region?".
// This answers a different question: "how far does it actually move?" — a
// number you measure occasionally and compare against a target and a floor,
// rather than a dose you accumulate.
//
// One entry per TEST, not per muscle: a muscle is only measurable through a
// specific movement. Every entry names the STRETCH_REGIONS region it belongs
// to so the guide can sit alongside the goal board without inventing a second
// set of group names, and the set covers all seven regions.
//
// ⚠️ DIRECTION: `min` is a floor and `target` is the goal, so BIGGER IS BETTER
// on every entry here. If a test is ever added where a smaller angle is the good
// one, this needs an explicit `lowerIsBetter` flag rather than a quiet exception
// — classifyRom() below would silently grade it backwards.
//
// ── The diagram ───────────────────────────────────────────────────────────
// Each test draws itself instead of loading a photo. A photo of a hamstring
// test is one fixed angle; the whole point here is to MOVE the limb, so the
// picture has to be geometry, not a JPEG. (The old card pointed at
// /rom/*.png files that were never added, and said so on every card.)
//
// Every test is therefore modelled as ONE hinge: a pivot, a fixed reference arm
// showing where zero is measured from, and a moving arm you drag. `scene` is
// the static body drawn around it.
//
// Angles are in SCREEN degrees: 0 points right, 90 points UP (romPoint does the
// y flip for you), counter-clockwise positive. A measurement `v` puts the moving
// arm at `zero + dir * v`, so `dir: -1` means the movement reads clockwise on
// screen. Everything is drawn in a 240×180 user-unit box.

/** The drawing box every `scene` and pivot is expressed in. */
export const ROM_VIEW = { w: 240, h: 180 };

// Scene primitives. Deliberately crude — a figure only has to be legible enough
// to say "this is a hip, seen from the side", not anatomical.
const line = (x1, y1, x2, y2, w = 5) => ({ k: 'line', x1, y1, x2, y2, w });
const head = (cx, cy, r = 11) => ({ k: 'circle', cx, cy, r });
const floor = (y, x1 = 12, x2 = 228) => ({ k: 'floor', y, x1, x2 });
const wall = (x, y1, y2) => ({ k: 'wall', x, y1, y2 });

/** A person lying on their back, head to the left, hips at (hx, hy). */
const supine = (hx, hy) => [
  floor(hy),
  head(hx - 74, hy - 12),
  line(hx - 62, hy - 4, hx, hy, 9),
];

/** A person standing side-on facing right, hips at (hx, hy). */
const standingSide = (hx, hy) => [
  floor(hy + 62),
  line(hx, hy, hx - 8, hy + 62, 5),
  line(hx, hy, hx + 10, hy + 62, 5),
];

/**
 * Standing side-on with a head and torso, shoulder at (sx, sy).
 *
 * The shoulder sits LOW in the box and the head is offset back from it, because
 * a shoulder that sweeps 180° needs a whole arm's length of clear space above
 * the pivot — drawn any higher, the hand leaves the picture at the top of the
 * range. (Which is exactly what the geometry test catches.)
 */
const standingShoulder = (sx, sy) => [
  floor(170),
  head(sx - 18, sy - 26),
  line(sx, sy, sx - 10, sy + 60, 9),
  line(sx - 10, sy + 60, sx - 22, sy + 88, 5),
  line(sx - 10, sy + 60, sx, sy + 88, 5),
];

/**
 * @typedef {Object} RomTest
 * @property {string} id           stable key — also the storage key, never rename
 * @property {string} muscle       what's being measured ("Hamstrings")
 * @property {string} region       a STRETCH_REGIONS value, for grouping
 * @property {string} test         the movement ("Straight leg raise")
 * @property {string} unit
 * @property {number} min          the floor to stay above
 * @property {number} target       the number to aim for
 * @property {number} dialMax      how far the dial lets you drag
 * @property {boolean} [bothSides] measured left and right separately
 * @property {string} [startText]  how to get into the start position
 * @property {string} [endText]    how to find the end position
 * @property {string[]} [tips]
 * @property {Object} diagram      { scene, pivot:[x,y], arm, zero, dir, ref:{angle,len}, refLabel }
 */

/** @type {RomTest[]} */
export const ROM_TESTS = [
  // ── Legs ────────────────────────────────────────────────────────────────
  {
    id: 'hamstrings-slr',
    muscle: 'Hamstrings',
    region: 'Legs',
    test: 'Straight leg raise',
    unit: '°',
    min: 20,
    target: 70,
    dialMax: 90,
    bothSides: true,
    startText: 'Lie on your back with both legs flat on the floor.',
    endText: 'Keeping the knee locked straight, raise one leg as far as it will go. Measure the angle between that leg and the floor.',
    tips: [
      'Keep the raised leg straight — a bent knee flatters the number',
      'Keep the other leg flat; letting it rise borrows range from the hip',
      'Stop where the stretch bites, not where it hurts',
    ],
    diagram: {
      scene: supine(120, 150),
      pivot: [120, 150], arm: 74, zero: 0, dir: 1,
      ref: { angle: 0, len: 66 }, refLabel: 'floor',
    },
  },
  {
    id: 'knee-flexion',
    muscle: 'Quads',
    region: 'Legs',
    test: 'Heel to backside',
    unit: '°',
    min: 120,
    target: 140,
    dialMax: 150,
    bothSides: true,
    startText: 'Lie face down with both legs straight.',
    endText: 'Bend one knee and pull the heel toward your backside. Measure the angle the shin has swept from straight.',
    tips: [
      'Keep your hip flat on the floor — lifting it fakes the last 20°',
      'Pull with a strap if your hand cannot reach',
    ],
    diagram: {
      scene: [floor(150), head(34, 138), line(46, 146, 96, 150, 9)],
      pivot: [150, 150], arm: 62, zero: 0, dir: 1,
      ref: { angle: 180, len: 54 }, refLabel: 'thigh',
    },
  },
  {
    id: 'ankle-dorsiflexion',
    muscle: 'Calves',
    region: 'Legs',
    test: 'Knee-to-wall lunge',
    unit: '°',
    min: 20,
    target: 38,
    dialMax: 50,
    bothSides: true,
    startText: 'Stand facing a wall in a short lunge, front foot flat and pointing straight at it.',
    endText: 'Drive the front knee toward the wall without letting the heel lift. Measure how far the shin has tipped from vertical.',
    tips: [
      'The heel must stay down — that is the whole test',
      'Knee tracks over the middle toes, not inward',
    ],
    diagram: {
      // The wall sits exactly where the knee lands at the end of the dial, so
      // the top of the range reads as "knee touching the wall" rather than the
      // knee passing through it. The foot is lifted clear of the floor line,
      // which it would otherwise be drawn on top of and vanish into.
      scene: [floor(155), wall(212, 40, 155), line(148, 151, 194, 151, 7)],
      pivot: [152, 151], arm: 76, zero: 90, dir: -1,
      ref: { angle: 90, len: 66 }, refLabel: 'vertical',
    },
  },

  // ── Hips / Glutes ───────────────────────────────────────────────────────
  {
    id: 'hip-flexion',
    muscle: 'Glutes',
    region: 'Hips/Glutes',
    test: 'Knee to chest',
    unit: '°',
    min: 100,
    target: 120,
    dialMax: 135,
    bothSides: true,
    startText: 'Lie on your back with both legs flat.',
    endText: 'Pull one knee toward your chest. Measure the angle the thigh has swept up from the floor.',
    tips: [
      'Let the knee bend — this measures the hip, not the hamstring',
      'Keep your lower back on the floor; rocking the pelvis adds fake range',
    ],
    diagram: {
      scene: supine(126, 150),
      pivot: [126, 150], arm: 64, zero: 0, dir: 1,
      ref: { angle: 0, len: 58 }, refLabel: 'floor',
    },
  },
  {
    id: 'hip-extension',
    muscle: 'Hip flexors',
    region: 'Hips/Glutes',
    test: 'Thomas test',
    unit: '°',
    min: 5,
    target: 15,
    dialMax: 30,
    bothSides: true,
    startText: 'Lie on your back at the very edge of a bed with both knees hugged to your chest.',
    endText: 'Let one leg hang off the edge and relax it completely. Measure how far below horizontal the thigh settles.',
    tips: [
      'Keep the other knee hugged in — that is what pins the pelvis',
      'A thigh that stays level or rises is a 0, and a tight hip flexor',
    ],
    diagram: {
      scene: [line(20, 112, 132, 112, 7), head(46, 100), line(58, 106, 118, 110, 9)],
      pivot: [132, 111], arm: 68, zero: 0, dir: -1,
      ref: { angle: 0, len: 60 }, refLabel: 'level',
    },
  },
  {
    id: 'hip-abduction',
    muscle: 'Adductors',
    region: 'Hips/Glutes',
    test: 'Leg out to the side',
    unit: '°',
    min: 30,
    target: 45,
    dialMax: 55,
    bothSides: true,
    startText: 'Lie on your back with both legs straight and together. (Seen from above.)',
    endText: 'Slide one straight leg out to the side as far as it goes. Measure the angle from the midline.',
    tips: [
      'Keep the kneecap pointing at the ceiling — rolling the leg out cheats',
      'Both hips stay square to the ceiling',
    ],
    diagram: {
      scene: [head(120, 30), line(120, 44, 120, 98, 9), line(120, 98, 96, 160, 5)],
      pivot: [120, 98], arm: 66, zero: 270, dir: 1,
      ref: { angle: 270, len: 60 }, refLabel: 'midline',
    },
  },
  {
    id: 'hip-internal-rotation',
    muscle: 'Deep hip rotators',
    region: 'Hips/Glutes',
    test: 'Seated hip internal rotation',
    unit: '°',
    min: 25,
    target: 40,
    dialMax: 50,
    bothSides: true,
    startText: 'Sit on a bench with both knees bent 90° and shins hanging straight down.',
    endText: 'Keeping the knee still, swing the foot outward. Measure how far the shin has swung from vertical.',
    tips: [
      'The thigh must not lift or roll — sit on your hands if it helps',
      'This is the one that quietly limits squats and rotation',
    ],
    diagram: {
      scene: [line(48, 62, 192, 62, 8), line(120, 40, 120, 62, 5)],
      pivot: [120, 64], arm: 74, zero: 270, dir: 1,
      ref: { angle: 270, len: 66 }, refLabel: 'vertical',
    },
  },

  // ── Shoulders ───────────────────────────────────────────────────────────
  {
    id: 'shoulder-flexion',
    muscle: 'Lats',
    region: 'Shoulders',
    test: 'Arm overhead',
    unit: '°',
    min: 150,
    target: 175,
    dialMax: 180,
    bothSides: true,
    startText: 'Stand tall with your back against a wall, ribs down and lower back flat against it.',
    endText: 'Raise one straight arm overhead as far as it goes without the back arching away from the wall. Measure the angle from your side.',
    tips: [
      'Ribs stay down — arching the back is how most people fake 180°',
      'Thumb up, elbow straight',
    ],
    diagram: {
      scene: standingShoulder(116, 80),
      pivot: [116, 80], arm: 62, zero: 270, dir: 1,
      ref: { angle: 270, len: 50 }, refLabel: 'at your side',
    },
  },
  {
    id: 'shoulder-external-rotation',
    muscle: 'Chest & front delts',
    region: 'Shoulders',
    test: 'Elbow at side, rotate out',
    unit: '°',
    min: 70,
    target: 90,
    dialMax: 100,
    bothSides: true,
    startText: 'Tuck your elbow into your side and bend it to 90°, forearm pointing straight ahead.',
    endText: 'Keeping the elbow pinned, rotate the forearm outward. Measure how far it has swung from straight ahead.',
    tips: [
      'Elbow stays glued to your ribs',
      'Do not let the shoulder shrug or drift back',
    ],
    diagram: {
      scene: [head(74, 34), line(74, 48, 74, 118, 9), line(96, 58, 96, 112, 6)],
      pivot: [96, 112], arm: 62, zero: 0, dir: 1,
      ref: { angle: 0, len: 54 }, refLabel: 'straight ahead',
    },
  },
  {
    id: 'shoulder-internal-rotation',
    muscle: 'Rear delts & cuff',
    region: 'Shoulders',
    test: 'Elbow at side, rotate in',
    unit: '°',
    min: 50,
    target: 70,
    dialMax: 90,
    bothSides: true,
    startText: 'Same start: elbow tucked in, bent 90°, forearm pointing straight ahead.',
    endText: 'Rotate the forearm inward across your body. Measure how far it has swung from straight ahead.',
    tips: [
      'Elbow stays at your side — sliding it forward adds range that is not there',
      'A big gap between this and external rotation is worth chasing',
    ],
    diagram: {
      scene: [head(74, 34), line(74, 48, 74, 118, 9), line(96, 58, 96, 112, 6)],
      pivot: [96, 112], arm: 62, zero: 0, dir: -1,
      ref: { angle: 0, len: 54 }, refLabel: 'straight ahead',
    },
  },
  {
    id: 'neck-rotation',
    muscle: 'Neck',
    region: 'Shoulders',
    test: 'Turn your head',
    unit: '°',
    min: 60,
    target: 80,
    dialMax: 90,
    bothSides: true,
    startText: 'Sit tall looking straight ahead, shoulders square. (Seen from above.)',
    endText: 'Turn your head to one side as far as it goes without tilting. Measure how far your nose has swung.',
    tips: [
      'Shoulders stay square — turning the torso is not turning the neck',
      'Chin stays level, no tilting',
    ],
    diagram: {
      scene: [line(64, 128, 176, 128, 8), head(120, 100, 20)],
      pivot: [120, 112], arm: 56, zero: 90, dir: 1,
      ref: { angle: 90, len: 50 }, refLabel: 'straight ahead',
    },
  },

  // ── Chest ───────────────────────────────────────────────────────────────
  {
    id: 'shoulder-extension',
    muscle: 'Pecs',
    region: 'Chest',
    test: 'Arm back behind you',
    unit: '°',
    min: 30,
    target: 55,
    dialMax: 70,
    bothSides: true,
    startText: 'Stand tall with your arm hanging at your side, palm facing in.',
    endText: 'Sweep the straight arm backward as far as it goes without leaning forward. Measure the angle from your side.',
    tips: [
      'Do not lean or round forward — the torso must stay upright',
      'Shoulder stays down, not shrugged',
    ],
    diagram: {
      scene: standingShoulder(116, 80),
      pivot: [116, 80], arm: 62, zero: 270, dir: -1,
      ref: { angle: 270, len: 50 }, refLabel: 'at your side',
    },
  },

  // ── Back ────────────────────────────────────────────────────────────────
  {
    id: 'thoracic-rotation',
    muscle: 'Mid back',
    region: 'Back',
    test: 'Seated rotation',
    unit: '°',
    min: 30,
    target: 45,
    dialMax: 60,
    bothSides: true,
    startText: 'Sit on a chair with a cushion squeezed between your knees, arms crossed on your chest. (Seen from above.)',
    endText: 'Turn your shoulders to one side, keeping the knees dead still. Measure how far your chest has turned.',
    tips: [
      'The knees must not move — that is what stops your hips joining in',
      'Sit tall; slumping costs you rotation',
    ],
    diagram: {
      scene: [line(84, 128, 156, 128, 8), { k: 'circle', cx: 120, cy: 128, r: 7 }],
      pivot: [120, 128], arm: 62, zero: 90, dir: 1,
      ref: { angle: 90, len: 54 }, refLabel: 'hips',
    },
  },
  {
    id: 'trunk-flexion',
    muscle: 'Lower back',
    region: 'Back',
    test: 'Standing forward bend',
    unit: '°',
    min: 40,
    target: 60,
    dialMax: 90,
    startText: 'Stand with your feet hip width and knees straight.',
    endText: 'Bend forward from the hips and let your spine round. Measure how far your torso has tipped from upright.',
    tips: [
      'Knees stay straight but not locked hard',
      'This is a combined spine + hip number — chase it gently',
    ],
    diagram: {
      scene: standingSide(106, 106),
      pivot: [106, 106], arm: 64, zero: 90, dir: -1,
      ref: { angle: 90, len: 58 }, refLabel: 'upright',
    },
  },

  // ── Abdominals ──────────────────────────────────────────────────────────
  {
    id: 'trunk-extension',
    muscle: 'Abdominals',
    region: 'Abdominals',
    test: 'Standing backward bend',
    unit: '°',
    min: 15,
    target: 25,
    dialMax: 40,
    startText: 'Stand tall with your hands on your hips.',
    endText: 'Lean backward, opening the front of your body. Measure how far your torso has tipped from upright.',
    tips: [
      'Bend through the whole spine, not just the low back',
      'Stop at stretch, never at pinch — a pinch means you are hinging at one segment',
    ],
    diagram: {
      scene: standingSide(106, 106),
      pivot: [106, 106], arm: 64, zero: 90, dir: 1,
      ref: { angle: 90, len: 58 }, refLabel: 'upright',
    },
  },

  // ── Arms ────────────────────────────────────────────────────────────────
  {
    id: 'elbow-flexion',
    muscle: 'Triceps',
    region: 'Arms',
    test: 'Hand to shoulder',
    unit: '°',
    min: 130,
    target: 145,
    dialMax: 150,
    bothSides: true,
    startText: 'Hold your upper arm still with the elbow straight.',
    endText: 'Bend the elbow and bring your hand toward your shoulder. Measure how far the forearm has swept from straight.',
    tips: [
      'Keep the upper arm still',
      'Relax the hand — a clenched fist changes nothing but feels tighter',
    ],
    diagram: {
      // Placed so the whole 0–150° sweep sits centred in the box rather than
      // hugging its top edge.
      scene: [line(60, 122, 140, 122, 8), { k: 'circle', cx: 60, cy: 122, r: 9 }],
      pivot: [140, 122], arm: 64, zero: 0, dir: 1,
      ref: { angle: 180, len: 74 }, refLabel: 'upper arm',
    },
  },
  {
    id: 'wrist-extension',
    muscle: 'Forearm flexors',
    region: 'Arms',
    test: 'Wrist bent back',
    unit: '°',
    min: 50,
    target: 70,
    dialMax: 90,
    bothSides: true,
    startText: 'Rest your forearm on a table with the hand off the edge, palm down.',
    endText: 'Bend the hand back toward the ceiling. Measure how far it has swept from level.',
    tips: [
      'Fingers relaxed — clenching shortens the number',
      'The forearm stays flat on the table',
    ],
    diagram: {
      // The table sits low: this sweep goes UP from it.
      scene: [line(46, 119, 146, 119, 8), line(46, 124, 146, 124, 2)],
      pivot: [146, 119], arm: 58, zero: 0, dir: 1,
      ref: { angle: 180, len: 94 }, refLabel: 'forearm',
    },
  },
  {
    id: 'wrist-flexion',
    muscle: 'Forearm extensors',
    region: 'Arms',
    test: 'Wrist bent forward',
    unit: '°',
    min: 60,
    target: 80,
    dialMax: 90,
    bothSides: true,
    startText: 'Same start: forearm flat on a table, hand off the edge, palm down.',
    endText: 'Curl the hand down toward the floor. Measure how far it has swept from level.',
    tips: [
      'Let the fingers hang loose',
      'Keep the forearm pinned to the table',
    ],
    diagram: {
      // …and high for this one, which sweeps DOWN from it.
      scene: [line(46, 61, 146, 61, 8), line(46, 66, 146, 66, 2)],
      pivot: [146, 61], arm: 58, zero: 0, dir: -1,
      ref: { angle: 180, len: 94 }, refLabel: 'forearm',
    },
  },
];

export function romTestById(id) {
  return ROM_TESTS.find(t => t.id === id) || null;
}

/** Every region that has at least one test, in ROM_TESTS order. */
export function romRegions() {
  const seen = [];
  for (const t of ROM_TESTS) if (!seen.includes(t.region)) seen.push(t.region);
  return seen;
}

/** Tests in a region, in ROM_TESTS order. */
export function romTestsInRegion(region) {
  return ROM_TESTS.filter(t => t.region === region);
}

/** The sides a test is measured on: both limbs, or the one midline movement. */
export const ROM_SIDES = ['l', 'r'];
export function romSidesFor(test) {
  return test?.bothSides ? ROM_SIDES : [''];
}
export function romSideLabel(side) {
  return side === 'l' ? 'Left' : side === 'r' ? 'Right' : '';
}

/**
 * Grade a measured value against a test.
 * @returns {'target'|'working'|'below'|null} null when there's nothing to grade
 */
export function classifyRom(value, test) {
  // An empty input box is "not measured", not zero — and Number('') is 0, which
  // would otherwise grade a blank field as "below the floor" in red.
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const v = Number(value);
  if (!test || !Number.isFinite(v)) return null;
  if (v >= test.target) return 'target';
  if (v >= test.min) return 'working';
  return 'below';
}

export const ROM_STATUS_META = {
  target: { label: 'At target', color: '#16a34a' },
  working: { label: 'In range', color: '#d97706' },
  below: { label: 'Below the floor', color: '#dc2626' },
};

/** "20°–70°" — the band as it reads on the reference card. */
export function romRangeLabel(test) {
  if (!test) return '';
  return `${test.min}${test.unit}–${test.target}${test.unit}`;
}

// ── Dial geometry ─────────────────────────────────────────────────────────
// Pure, so the drag maths is testable without a DOM.

const DEG = Math.PI / 180;

/** How far the dial can be dragged. The floor is always 0 — nothing here goes negative. */
export function romDialRange(test) {
  return { min: 0, max: Math.max(test?.dialMax ?? 0, test?.target ?? 0) };
}

export function clampRomValue(test, v) {
  const { min, max } = romDialRange(test);
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * A point `len` from `[px,py]` at `deg`, in SVG user units.
 * 0° points right and 90° points UP — the y flip happens here so no caller has
 * to remember that SVG's y axis grows downward.
 */
export function romPoint([px, py], len, deg) {
  return [px + len * Math.cos(deg * DEG), py - len * Math.sin(deg * DEG)];
}

/** Where the moving arm sits on screen for a measurement. */
export function romScreenAngle(test, value) {
  const d = test.diagram;
  return d.zero + d.dir * Number(value || 0);
}

/** The far end of the moving arm for a measurement. */
export function romArmPoint(test, value) {
  const d = test.diagram;
  return romPoint(d.pivot, d.arm, romScreenAngle(test, value));
}

/**
 * Inverse of romScreenAngle: what measurement does a pointer at (x, y) mean?
 *
 * The dial is an arc, not a full circle, so there is always a dead sector
 * behind it. Rather than let a drag through that sector wrap around to the far
 * end, the raw angle is wrapped into ONE 360° window centred on the dial and
 * then clamped — so dragging off either end sticks to whichever end you left.
 */
export function romValueFromPoint(test, x, y) {
  const d = test.diagram;
  const [px, py] = d.pivot;
  const deg = Math.atan2(py - y, x - px) / DEG;
  const { min, max } = romDialRange(test);
  let raw = (deg - d.zero) * d.dir;
  // The window starts half of the leftover circle below the floor, which puts
  // an equal dead zone either side of the arc.
  const slack = (360 - (max - min)) / 2;
  const start = min - slack;
  raw = ((raw - start) % 360 + 360) % 360 + start;
  return Math.min(max, Math.max(min, Math.round(raw)));
}
