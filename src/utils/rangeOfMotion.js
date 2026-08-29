// Range-of-motion reference for the Stretch page.
//
// The goal board above it answers "how much time have I held this region?".
// This answers a different question: "how far does it actually move?" — a
// number you can measure once a month and compare against a target and a floor,
// rather than a dose you accumulate.
//
// One entry per TEST, not per region: a muscle is only measurable through a
// specific movement, and the picture of that movement is the whole point. Each
// entry names the STRETCH_REGIONS region it belongs to so the guide can sit
// alongside the goal board without inventing a second set of group names.
//
// ⚠️ DIRECTION: `min` is a floor and `target` is the goal, so BIGGER IS BETTER
// on every entry here. If a test is ever added where a smaller angle is the good
// one, this needs an explicit `lowerIsBetter` flag rather than a quiet exception
// — classifyRom() below would silently grade it backwards.

/**
 * @typedef {Object} RomTest
 * @property {string} id           stable key
 * @property {string} muscle       what's being measured ("Hamstrings")
 * @property {string} region       a STRETCH_REGIONS value, for grouping
 * @property {string} test         the movement ("Straight leg raise")
 * @property {string} image        path under public/, or '' until one exists
 * @property {string} unit
 * @property {number} min          the floor to stay above
 * @property {number} target       the number to aim for
 * @property {string} [startText]  how to get into the start position
 * @property {string} [endText]    how to find the end position
 * @property {string[]} [tips]
 */

/** @type {RomTest[]} */
export const ROM_TESTS = [
  {
    id: 'hamstrings-slr',
    muscle: 'Hamstrings',
    region: 'Legs',
    test: 'Straight leg raise',
    image: '/rom/hamstrings-straight-leg-raise.png',
    unit: '°',
    min: 20,
    target: 70,
    startText: 'Lie on your back. Raise one leg straight up toward the ceiling (90°).',
    endText: 'Slowly lower the straight leg toward the floor until you feel a gentle stretch in the hamstring. Do not round your back.',
    tips: [
      'Keep the raised leg straight',
      'Move slowly and in control',
      'Breathe and relax into the stretch',
    ],
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
