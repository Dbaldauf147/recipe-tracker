import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROM_TESTS, classifyRom, romRangeLabel, romRegions, romTestById, ROM_VIEW,
  romArmPoint, romValueFromPoint, romDialRange, romPoint, romScreenAngle,
  clampRomValue, romSidesFor,
} from './rangeOfMotion.js';
import { STRETCH_REGIONS } from './stretchGoal.js';

test('every test names a real stretch region', () => {
  // The guide sits next to the goal board; a region the board has never heard of
  // would render under a heading that matches nothing above it.
  for (const t of ROM_TESTS) {
    assert.ok(STRETCH_REGIONS.includes(t.region), `${t.id} has unknown region ${t.region}`);
  }
});

test('every test has a floor below its target', () => {
  // classifyRom grades bigger-is-better; min >= target would make "working"
  // unreachable and silently mislabel everything.
  for (const t of ROM_TESTS) {
    assert.ok(Number.isFinite(t.min) && Number.isFinite(t.target), `${t.id} missing numbers`);
    assert.ok(t.min < t.target, `${t.id}: min ${t.min} is not below target ${t.target}`);
  }
});

test('ids are unique', () => {
  const ids = ROM_TESTS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the hamstring card carries the numbers it has always had', () => {
  const t = romTestById('hamstrings-slr');
  assert.ok(t);
  assert.equal(t.min, 20);
  assert.equal(t.target, 70);
  assert.equal(romRangeLabel(t), '20°–70°');
});

test('a measurement is graded against the floor and the target', () => {
  const t = romTestById('hamstrings-slr');
  assert.equal(classifyRom(75, t), 'target');
  assert.equal(classifyRom(70, t), 'target', 'the target itself counts as met');
  assert.equal(classifyRom(45, t), 'working');
  assert.equal(classifyRom(20, t), 'working', 'the floor itself is still in range');
  assert.equal(classifyRom(19, t), 'below');
});

test('nothing to grade returns null rather than a bogus grade', () => {
  const t = romTestById('hamstrings-slr');
  assert.equal(classifyRom('', t), null);
  assert.equal(classifyRom(undefined, t), null);
  assert.equal(classifyRom('abc', t), null);
  assert.equal(classifyRom(50, null), null);
});

test('romRegions lists each region once, in order', () => {
  const regions = romRegions();
  assert.equal(new Set(regions).size, regions.length);
  for (const r of regions) assert.ok(STRETCH_REGIONS.includes(r));
});

// ── Coverage ──────────────────────────────────────────────────────────────

test('every stretch region has at least one test', () => {
  // "All major muscles" is the promise the card makes; a region with no test
  // would show an empty tab.
  for (const r of STRETCH_REGIONS) {
    assert.ok(ROM_TESTS.some(t => t.region === r), `no ROM test covers ${r}`);
  }
});

// ── Dial geometry ─────────────────────────────────────────────────────────

test('the dial can always reach the target', () => {
  for (const t of ROM_TESTS) {
    assert.ok(t.dialMax >= t.target, `${t.id}: dialMax ${t.dialMax} cannot reach target ${t.target}`);
  }
});

test('the arm stays inside the drawing box across the whole sweep', () => {
  // A pivot placed carelessly sends the limb off the edge of the SVG at one end
  // of its travel, which reads as the handle simply vanishing mid-drag.
  const pad = 4;
  for (const t of ROM_TESTS) {
    const { max } = romDialRange(t);
    for (let v = 0; v <= max; v += 5) {
      const [x, y] = romArmPoint(t, v);
      assert.ok(x >= pad && x <= ROM_VIEW.w - pad, `${t.id} at ${v}°: x=${x.toFixed(1)} off box`);
      assert.ok(y >= pad && y <= ROM_VIEW.h - pad, `${t.id} at ${v}°: y=${y.toFixed(1)} off box`);
    }
  }
});

test('a point on the arm reads back as the value that put it there', () => {
  for (const t of ROM_TESTS) {
    const { max } = romDialRange(t);
    for (const v of [0, Math.round(t.min), Math.round(t.target), max]) {
      const [x, y] = romArmPoint(t, v);
      assert.equal(romValueFromPoint(t, x, y), v, `${t.id} round trip at ${v}°`);
    }
  }
});

test('dragging past an end sticks to that end rather than wrapping', () => {
  const t = romTestById('hamstrings-slr');
  const { max } = romDialRange(t);
  // 20° beyond either end of the arc, still on the circle.
  const [bx, by] = romPoint(t.diagram.pivot, t.diagram.arm, romScreenAngle(t, -20));
  assert.equal(romValueFromPoint(t, bx, by), 0);
  const [ax, ay] = romPoint(t.diagram.pivot, t.diagram.arm, romScreenAngle(t, max + 20));
  assert.equal(romValueFromPoint(t, ax, ay), max);
});

test('the reading does not depend on how far out you grab the arm', () => {
  // The handle is at arm length, but a drag wanders; only the angle counts.
  const t = romTestById('shoulder-flexion');
  const near = romPoint(t.diagram.pivot, 20, romScreenAngle(t, 130));
  const far = romPoint(t.diagram.pivot, 200, romScreenAngle(t, 130));
  assert.equal(romValueFromPoint(t, near[0], near[1]), 130);
  assert.equal(romValueFromPoint(t, far[0], far[1]), 130);
});

test('clampRomValue keeps a typed number on the dial', () => {
  const t = romTestById('hamstrings-slr');
  assert.equal(clampRomValue(t, 45), 45);
  assert.equal(clampRomValue(t, -10), 0);
  assert.equal(clampRomValue(t, 500), 90);
  assert.equal(clampRomValue(t, 'abc'), null);
});

test('bothSides tests are the ones with a left and a right', () => {
  assert.deepEqual(romSidesFor(romTestById('hamstrings-slr')), ['l', 'r']);
  assert.deepEqual(romSidesFor(romTestById('trunk-flexion')), ['']);
});
