// ⚠️ Mirrored with PrepDay/src/utils/habitChecklist.test.ts — change both.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checklistItems, hasChecklist, tickedIds, checklistProgress, isComplete, toggleItem,
  newChecklistItem, addItem, renameItem, removeItem, markActionAfter,
} from './habitChecklist.js';

const items = [{ id: 'a', text: 'Kitchen' }, { id: 'b', text: 'Bath' }, { id: 'c', text: 'Floors' }];
const habit = (extra = {}) => ({ id: 'h1', cadence: 'Monthly', checklist: items, ...extra });

describe('habit checklist', () => {
  it('reads items, ignoring junk', () => {
    assert.deepEqual(checklistItems({}), []);
    assert.deepEqual(checklistItems({ checklist: 'x' }), []);
    assert.deepEqual(checklistItems({ checklist: [null, { id: '', text: 'x' }, { id: 'a', text: 'A' }, { text: 'no id' }] }), [{ id: 'a', text: 'A' }]);
    assert.equal(hasChecklist({}), false);
    assert.equal(hasChecklist(habit()), true);
    assert.equal(hasChecklist({ checklist: [] }), false);
  });

  it('only counts ticks from the current period', () => {
    const h = habit({ checklistDone: { period: '2026-08', ids: ['a', 'b'] } });
    assert.deepEqual(tickedIds(h, '2026-08'), ['a', 'b']);
    assert.deepEqual(tickedIds(h, '2026-09'), []);
    assert.deepEqual(checklistProgress(h, '2026-09'), { done: 0, total: 3 });
  });

  it('ignores ticked ids no longer on the list, and returns list order', () => {
    const h = habit({ checklistDone: { period: 'p', ids: ['c', 'gone', 'a'] } });
    assert.deepEqual(tickedIds(h, 'p'), ['a', 'c']);
    assert.deepEqual(checklistProgress(h, 'p'), { done: 2, total: 3 });
  });

  it('toggles within the period and starts fresh in a new one', () => {
    const h = habit({ checklistDone: { period: 'p', ids: ['a'] } });
    assert.deepEqual(toggleItem(h, 'b', 'p'), { period: 'p', ids: ['a', 'b'] });
    assert.deepEqual(toggleItem(h, 'a', 'p'), { period: 'p', ids: [] });
    assert.deepEqual(toggleItem(h, 'b', 'q'), { period: 'q', ids: ['b'] });
    assert.deepEqual(toggleItem(h, 'nope', 'p'), { period: 'p', ids: ['a'] });
    assert.deepEqual(toggleItem({ checklist: items }, 'c', 'p'), { period: 'p', ids: ['c'] });
  });

  it('is complete only when every current item is ticked', () => {
    assert.equal(isComplete(habit({ checklistDone: { period: 'p', ids: ['a', 'b', 'c'] } }), 'p'), true);
    assert.equal(isComplete(habit({ checklistDone: { period: 'p', ids: ['a', 'b'] } }), 'p'), false);
    assert.equal(isComplete(habit({ checklistDone: { period: 'o', ids: ['a', 'b', 'c'] } }), 'p'), false);
    assert.equal(isComplete({ checklist: [], checklistDone: { period: 'p', ids: [] } }, 'p'), false);
    assert.equal(isComplete({}, 'p'), false);
  });

  it('makes, adds and renames items', () => {
    assert.equal(newChecklistItem('   '), null);
    const it1 = newChecklistItem('  Windows ');
    assert.equal(it1.text, 'Windows');
    assert.match(it1.id, /^ci-[a-z0-9]+$/);
    assert.notEqual(newChecklistItem('x').id, newChecklistItem('x').id);
    const added = addItem(habit(), 'Garage');
    assert.equal(added.length, 4);
    assert.equal(added[3].text, 'Garage');
    assert.equal(addItem(habit(), ' ').length, 3);
    assert.equal(addItem({}, 'First').length, 1);
    assert.deepEqual(renameItem(habit(), 'b', 'Bathroom').map(i => i.text), ['Kitchen', 'Bathroom', 'Floors']);
  });

  it('removing an item prunes its tick in the current period only', () => {
    const cur = removeItem(habit({ checklistDone: { period: 'p', ids: ['a', 'b'] } }), 'b', 'p');
    assert.deepEqual(cur.checklist.map(i => i.id), ['a', 'c']);
    assert.deepEqual(cur.checklistDone, { period: 'p', ids: ['a'] });
    const old = removeItem(habit({ checklistDone: { period: 'o', ids: ['b'] } }), 'b', 'p');
    assert.equal('checklistDone' in old, false);
    // Removing the last unticked item completes the list.
    const h = habit({ checklistDone: { period: 'p', ids: ['a', 'b'] } });
    assert.equal(isComplete({ ...h, ...removeItem(h, 'c', 'p') }, 'p'), true);
  });

  describe('markActionAfter', () => {
    const full = habit({ checklistDone: { period: 'p', ids: ['a', 'b', 'c'] } });
    const part = habit({ checklistDone: { period: 'p', ids: ['a'] } });
    it('marks done when a tick completes the list', () => {
      assert.equal(markActionAfter(full, 'p', undefined, 'tick'), 'done');
      assert.equal(markActionAfter(full, 'p', 'skipped', 'tick'), 'done');
      assert.equal(markActionAfter(full, 'p', 'missed', 'remove'), 'done');
    });
    it('leaves an existing done / exceeded alone', () => {
      assert.equal(markActionAfter(full, 'p', 'done', 'tick'), null);
      assert.equal(markActionAfter(full, 'p', 'exceeded', 'tick'), null);
    });
    it('does nothing while incomplete', () => {
      assert.equal(markActionAfter(part, 'p', undefined, 'tick'), null);
    });
    it('clears a done mark on untick, but not other marks', () => {
      assert.equal(markActionAfter(part, 'p', 'done', 'untick'), 'clear');
      assert.equal(markActionAfter(part, 'p', 'exceeded', 'untick'), null);
      assert.equal(markActionAfter(part, 'p', 'skipped', 'untick'), null);
      assert.equal(markActionAfter(part, 'p', undefined, 'untick'), null);
    });
    it('adding or renaming never touches the mark', () => {
      assert.equal(markActionAfter(part, 'p', 'done', 'add'), null);
      assert.equal(markActionAfter(full, 'p', undefined, 'rename'), null);
    });
    it('never auto-marks a bad habit', () => {
      assert.equal(markActionAfter({ ...full, habitType: 'bad' }, 'p', undefined, 'tick'), null);
      assert.equal(markActionAfter({ ...part, habitType: ' Bad ' }, 'p', 'done', 'untick'), null);
    });
  });
});
