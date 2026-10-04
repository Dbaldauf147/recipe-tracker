import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_COLORS_KEY, normalizeHex, resolveMapColors, mapColorOverrides, readMapColors, writeMapColors,
} from './mapColors.js';

const DEFAULTS = { want: '#f59e0b', next: '#f59e0b', visited: '#10b981' };

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

test('normalizeHex accepts 3- and 6-digit hex, rejects the rest', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex(' #1A2b3C '), '#1a2b3c');
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex(null), null);
});

test('saved overrides apply only to known categories with valid colours', () => {
  const out = resolveMapColors(DEFAULTS, { want: '#2563EB', visited: 'nope', bogus: '#000000' });
  assert.deepEqual(out, { want: '#2563eb', next: '#f59e0b', visited: '#10b981' });
});

test('only changed categories are stored, and none means the key is removed', () => {
  const store = memoryStorage();
  writeMapColors(DEFAULTS, { ...DEFAULTS, next: '#7c3aed' }, store);
  assert.deepEqual(JSON.parse(store.dump()[MAP_COLORS_KEY]), { next: '#7c3aed' });
  assert.deepEqual(readMapColors(DEFAULTS, store), { ...DEFAULTS, next: '#7c3aed' });
  writeMapColors(DEFAULTS, { ...DEFAULTS }, store);
  assert.equal(store.dump()[MAP_COLORS_KEY], undefined);
  assert.deepEqual(mapColorOverrides(DEFAULTS, DEFAULTS), {});
});

test('unreadable storage falls back to the defaults', () => {
  const store = memoryStorage({ [MAP_COLORS_KEY]: '{not json' });
  assert.deepEqual(readMapColors(DEFAULTS, store), DEFAULTS);
  const throwing = { getItem() { throw new Error('blocked'); } };
  assert.deepEqual(readMapColors(DEFAULTS, throwing), DEFAULTS);
});
