import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workoutCalendarCategory, isPtWorkout, CAL_ICON, CAL_LABEL } from './workoutCategory.js';

const cat = (workoutType, categories) => workoutCalendarCategory({ workoutType }, categories);

test('an explicit PT category wins over the name', () => {
  assert.equal(cat('Knee work', { 'Knee work': 'pt' }), 'pt');
  assert.equal(cat('Push', { Push: 'pt' }), 'pt');
});

test('PT-like type names are guessed as PT', () => {
  for (const name of ['PT', 'pt', 'Knee PT', 'Physical Therapy', 'Physio', 'Shoulder rehab']) {
    assert.equal(cat(name, null), 'pt', name);
  }
});

test('"pt" inside another word is not PT', () => {
  assert.equal(cat('Elliptical', null), 'cardio');
  assert.equal(cat('Uptempo', null), 'weights');
  assert.equal(cat('Push', null), 'weights');
  assert.equal(cat('Yoga', null), 'yoga');
});

test('an explicit non-PT category beats a PT-looking name', () => {
  assert.equal(cat('PT', { PT: 'weights' }), 'weights');
});

test('isPtWorkout follows the category', () => {
  assert.equal(isPtWorkout({ workoutType: 'PT' }, {}), true);
  assert.equal(isPtWorkout({ workoutType: 'Legs' }, { Legs: 'pt' }), true);
  assert.equal(isPtWorkout({ workoutType: 'Legs' }, {}), false);
  assert.equal(isPtWorkout({}, {}), false);
});

test('PT has an icon and a label', () => {
  assert.ok(CAL_ICON.pt);
  assert.equal(CAL_LABEL.pt, 'PT');
});
