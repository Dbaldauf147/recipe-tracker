import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setPainFor, withSetPain } from './setPain.js';

describe('setPain', () => {
  it('marks a set painful with a trimmed note, sorted by set', () => {
    let e = {};
    e = withSetPain(e, 2, { note: '  left shoulder ' });
    e = withSetPain(e, 0, {});
    assert.deepEqual(e.setPain, [{ set: 0 }, { set: 2, note: 'left shoulder' }]);
    assert.equal(setPainFor(e, 2)?.note, 'left shoulder');
    assert.equal(setPainFor(e, 1), null);
  });

  it('replaces the note on the same set rather than duplicating it', () => {
    let e = withSetPain({}, 1, { note: 'knee' });
    e = withSetPain(e, 1, { note: 'right knee' });
    assert.deepEqual(e.setPain, [{ set: 1, note: 'right knee' }]);
  });

  it('clearing the last mark removes the field entirely', () => {
    const e = withSetPain(withSetPain({}, 3, { note: 'wrist' }), 3, null);
    assert.equal('setPain' in e, false);
  });
});
