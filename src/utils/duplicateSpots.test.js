import test from 'node:test';
import assert from 'node:assert/strict';
import { findExistingMatches } from './duplicateSpots.js';

const list = [
  { id: '1', name: "Joe's Pizza", address: '123 Main St, Brooklyn' },
  { id: '2', name: 'Lilia', address: '567 Union Ave', url: 'https://www.instagram.com/p/abc123xyz/' },
  { id: '3', name: 'Bar Primi' },
];

test('matches by normalised name', () => {
  const m = findExistingMatches({ name: 'Joes Pizza Co.' }, list);
  assert.deepEqual(m.map(x => [x.spot.id, x.by]), [['1', ['name']]]);
});

test('matches by address and by link', () => {
  assert.deepEqual(findExistingMatches({ name: 'Somewhere', address: '123 Main Street, Brooklyn' }, list).map(x => x.spot.id), ['1']);
  assert.deepEqual(findExistingMatches({ url: 'http://instagram.com/p/abc123xyz?igsh=1' }, list)[0].by, ['link']);
});

test('reports every reason on one spot', () => {
  assert.deepEqual(findExistingMatches({ name: 'Lilia', address: '567 Union Avenue' }, list)[0].by, ['name', 'address']);
});

test('no false matches; own id skipped; blanks never match', () => {
  assert.equal(findExistingMatches({ name: 'Primi' }, list).length, 0);
  assert.equal(findExistingMatches({ id: '2', name: 'Lilia' }, list).length, 0);
  assert.equal(findExistingMatches({ name: '', address: '', url: '' }, [{ id: 'x' }]).length, 0);
});
