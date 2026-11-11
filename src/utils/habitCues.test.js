// ⚠️ Mirrored with PrepDay/src/utils/habitCues.test.ts — change both.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cueFields, cuesOf } from './habitCues.js';

describe('habit cues', () => {
  it('reads the legacy single fields when there is no list', () => {
    assert.deepEqual(cuesOf({}), []);
    assert.deepEqual(cuesOf(null), []);
    assert.deepEqual(cuesOf({ cue: 'After coffee' }), ['After coffee']);
    assert.deepEqual(cuesOf({ cue: ' A ', cue2: 'B' }), ['A', 'B']);
    assert.deepEqual(cuesOf({ cue: '', cue2: 'B' }), ['B']);
  });

  it('uses the list when cue / cue2 still match it', () => {
    assert.deepEqual(cuesOf({ cues: ['A', 'B', 'C'], cue: 'A', cue2: 'B' }), ['A', 'B', 'C']);
    assert.deepEqual(cuesOf({ cues: ['A'], cue: 'A' }), ['A']);
  });

  it('lets a website edit of cue / cue2 win, keeping the extras', () => {
    assert.deepEqual(cuesOf({ cues: ['A', 'B', 'C'], cue: 'X', cue2: 'B' }), ['X', 'B', 'C']);
    assert.deepEqual(cuesOf({ cues: ['A', 'B', 'C'], cue: 'A', cue2: '' }), ['A', 'C']);
  });

  it('ignores junk in the list', () => {
    assert.deepEqual(cuesOf({ cues: 'nope', cue: 'A' }), ['A']);
    assert.deepEqual(cuesOf({ cues: ['A', 3, '  ', 'B'], cue: 'A', cue2: 'B' }), ['A', 'B']);
  });

  it('mirrors the first two into cue / cue2 on write', () => {
    assert.deepEqual(cueFields(['A', ' ', 'B', 'C']), { cues: ['A', 'B', 'C'], cue: 'A', cue2: 'B' });
    assert.deepEqual(cueFields([]), { cues: [], cue: '', cue2: '' });
    // Round-trips.
    assert.deepEqual(cuesOf(cueFields(['A', 'B', 'C'])), ['A', 'B', 'C']);
  });
});
