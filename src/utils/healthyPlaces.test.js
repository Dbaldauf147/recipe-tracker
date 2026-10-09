import test from 'node:test';
import assert from 'node:assert/strict';
import { healthyByLongestSince, daysSinceVisit } from './healthyPlaces.js';

const NOW = new Date('2026-10-09T12:00:00Z');
const healthy = s => s.health === 'healthy';

test('healthy places, the longest since a visit first', () => {
  const out = healthyByLongestSince([
    { name: 'Sweetgreen', health: 'healthy', status: 'visited', lastVisit: '2026-10-01T12:00:00Z' },
    { name: 'Pizza', status: 'visited', lastVisit: '2025-01-01T12:00:00Z' },
    { name: 'Dig', health: 'healthy', status: 'visited', lastVisit: '2026-06-01T12:00:00Z' },
    { name: 'Cava', health: 'healthy', status: 'visited', lastVisit: '2026-09-09T12:00:00Z' },
  ], healthy, NOW);
  assert.deepEqual(out.dated.map(d => d.spot.name), ['Dig', 'Cava', 'Sweetgreen']);
  assert.deepEqual(out.dated.map(d => d.days), [130, 30, 8]);
});

test('undated visits and never-been places are kept apart; hold-off is left out', () => {
  const out = healthyByLongestSince([
    { name: 'B', health: 'healthy', status: 'visited' },
    { name: 'A', health: 'healthy', status: 'want-to-try' },
    { name: 'C', health: 'healthy', status: 'hold-off', lastVisit: '2026-01-01T12:00:00Z' },
  ], healthy, NOW);
  assert.deepEqual(out.undated.map(d => d.spot.name), ['B']);
  assert.deepEqual(out.never.map(d => d.spot.name), ['A']);
  assert.equal(out.dated.length, 0);
  assert.equal(out.total, 2);
});

test('a want-to-try spot with a visit date counts as been', () => {
  const out = healthyByLongestSince([{ name: 'X', health: 'healthy', status: 'want-to-try', lastVisit: '2026-10-08T12:00:00Z' }], healthy, NOW);
  assert.equal(out.dated[0].days, 1);
});

test('daysSinceVisit ignores junk', () => {
  assert.equal(daysSinceVisit('', NOW), null);
  assert.equal(daysSinceVisit('not a date', NOW), null);
});
