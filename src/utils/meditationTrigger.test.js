// The Gratitude-source triggers the hourly habit automation evaluates. The
// property that matters most: a number Gratitude didn't report is "unknown"
// (null → cell left alone), never "didn't happen" (false → elseMark / Missed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalGratitudeTrigger } from '../../api/run-habit-automations.js';

const med = (threshold) => ({ trigger: 'meditation_done', threshold });

test('meditation_done fires on one completed meditation by default', () => {
  assert.equal(evalGratitudeTrigger(med(''), { count: 0, meditations: 1 }), true);
  assert.equal(evalGratitudeTrigger(med(undefined), { count: 3, meditations: 0 }), false);
});

test('meditation_done honours the rule threshold', () => {
  assert.equal(evalGratitudeTrigger(med('2'), { count: 0, meditations: 1 }), false);
  assert.equal(evalGratitudeTrigger(med(2), { count: 0, meditations: 2 }), true);
});

test('an unreported meditation count is unknown, not a miss', () => {
  assert.equal(evalGratitudeTrigger(med(''), { count: 3, meditations: null }), null);
});

test('gratitude_goal is unchanged, and unknown when its own count is missing', () => {
  const rule = { trigger: 'gratitude_goal', threshold: '' };
  assert.equal(evalGratitudeTrigger(rule, { count: 3, meditations: null }), true);
  assert.equal(evalGratitudeTrigger(rule, { count: 2, meditations: 5 }), false);
  assert.equal(evalGratitudeTrigger(rule, { count: null, meditations: 1 }), null);
});
