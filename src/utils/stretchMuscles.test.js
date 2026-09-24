import test from 'node:test';
import assert from 'node:assert/strict';
import { stretchPoseMuscleNames, routineMuscleSeconds } from './stretchMuscles.js';

test('library Primary/Secondary columns win over the pose name', () => {
  const r = stretchPoseMuscleNames('Downward dog', { primary: 'Calves', secondary: 'Hamstrings' });
  assert.equal(r.source, 'library');
  assert.deepEqual(r.names, ['Calves', 'Hamstrings']);
});

test('pose names are read when the library says nothing, and every match counts', () => {
  assert.deepEqual(stretchPoseMuscleNames('Pigeon pose').names, ['glutes']);
  const both = stretchPoseMuscleNames('Standing quad and calf stretch');
  assert.equal(both.source, 'name');
  assert.deepEqual(both.names.sort(), ['calves', 'quadriceps']);
});

test('an unknown pose falls back to its region, then to nothing', () => {
  const r = stretchPoseMuscleNames('Mystery flow', { group: 'Chest' });
  assert.equal(r.source, 'region');
  assert.deepEqual(r.names, ['chest']);
  assert.deepEqual(stretchPoseMuscleNames('Mystery flow', { group: 'Yoga' }), { names: [], source: '' });
});

test('routineMuscleSeconds counts every hold the player plays — reps and both sides', () => {
  const routine = {
    id: 'r', name: 'T', holdSec: 30, transitionSec: 10, switchSec: 5, reps: 2, restSec: 5,
    steps: [
      { id: '1', name: 'Hamstring', bothSides: true }, // 2 reps × 2 sides × 30 = 120
      { id: '2', name: 'Pigeon', reps: 1, holdSec: 45 }, // 45
      { id: '3', name: 'Mystery' },
    ],
  };
  const ids = { Hamstring: ['hamstring'], Pigeon: ['gluteal', 'hamstring'] };
  const { muscles, unmapped } = routineMuscleSeconds(routine, n => ids[n] || []);
  assert.deepEqual(muscles.hamstring, { seconds: 165, poses: ['Hamstring', 'Pigeon'] });
  assert.deepEqual(muscles.gluteal, { seconds: 45, poses: ['Pigeon'] });
  assert.deepEqual(unmapped, ['Mystery']);
});
