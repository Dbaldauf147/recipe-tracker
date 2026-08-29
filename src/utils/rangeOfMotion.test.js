import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROM_TESTS, classifyRom, romRangeLabel, romRegions, romTestById } from './rangeOfMotion.js';
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

test('the hamstring card carries the numbers from the reference image', () => {
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
