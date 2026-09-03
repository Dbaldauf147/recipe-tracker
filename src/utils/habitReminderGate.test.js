// The SERVER's "is this habit the user's to log" gate, in api/_data/habitPeriods.js.
//
// It lives under api/ but is tested from here because the test script only
// globs src/**/*.test.js — and it is worth testing, because two things that
// reach the user without anyone looking at a screen depend on it: the 8am
// reminder push (send-meal-prompt.js) and the weekly summary email's habit
// completion stats (lib/weeklySummary.js).
//
// A bad habit slipping through here is exactly the failure the feature exists
// to prevent, and it would show up as an email or a push notification rather
// than as anything visibly wrong in the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoggableHabit, isBadHabit, habitsPinnedToday } from '../../api/_data/habitPeriods.js';

const THURSDAY = 4; // getDay() index

test('isBadHabit reads the flag the apps write', () => {
  assert.equal(isBadHabit({ habitType: 'bad' }), true);
  assert.equal(isBadHabit({ habitType: 'Bad' }), true);
  assert.equal(isBadHabit({ habitType: ' bad ' }), true);
  assert.equal(isBadHabit({ habitType: '' }), false);
  assert.equal(isBadHabit({}), false);
  assert.equal(isBadHabit(null), false);
});

test('a bad habit is never the user’s to log, whatever its status', () => {
  for (const status of ['Most Days', 'Some Days', 'Rarely', '']) {
    assert.equal(isLoggableHabit({ status, habitType: 'bad' }), false, `status=${status}`);
    assert.equal(isLoggableHabit({ status }), true, `status=${status} without the flag`);
  }
});

test('the parked statuses still gate the way they did', () => {
  for (const status of ['On Hold', 'Abandoned', 'Automatically', 'Not Started', 'Havent Started']) {
    assert.equal(isLoggableHabit({ status }), false, status);
  }
});

test('a bad habit is never pinned for the 8am reminder push', () => {
  // Weekly cadence pinned to today is the one shape that gets a push. A bad
  // habit given that shape by hand still has to stay silent.
  const shape = { name: 'Bit nails', cadence: 'Weekly', weekDays: ['thursday'], status: 'Most Days' };
  assert.deepEqual(habitsPinnedToday([{ ...shape, habitType: 'bad' }], THURSDAY), []);
  assert.equal(habitsPinnedToday([shape], THURSDAY).length, 1, 'the same habit without the flag is pinned');
});
