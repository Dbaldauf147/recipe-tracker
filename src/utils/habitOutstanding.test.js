import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBadHabit, countOutstandingHabits, countHabitsNeedingLog,
  yesterdayUnloggedHabits, dayKey, yesterdayDayKey, periodKey,
} from './habitOutstanding.js';

// A fixed "now" so the day keys below are stable wherever this runs.
const NOW = new Date(2026, 8, 3, 9, 0, 0);       // Thu 3 Sep 2026, local
const TODAY = dayKey(NOW);
const YESTERDAY = yesterdayDayKey(NOW);

const good = (over = {}) => ({ id: 'g1', name: 'Read', cadence: 'Daily', status: 'Most Days', ...over });
const bad = (over = {}) => ({ id: 'b1', name: 'Bit nails', cadence: 'Daily', status: 'Most Days', habitType: 'bad', ...over });

test('isBadHabit reads the stored flag, and tolerates how it is written', () => {
  assert.equal(isBadHabit(bad()), true);
  assert.equal(isBadHabit({ habitType: 'Bad' }), true);
  assert.equal(isBadHabit({ habitType: ' bad ' }), true);
  assert.equal(isBadHabit(good()), false);
  assert.equal(isBadHabit({}), false);
  assert.equal(isBadHabit(null), false);
  assert.equal(isBadHabit(undefined), false);
});

test('a bad habit is never counted as needing a log', () => {
  // The whole point of the feature: an unmarked bad habit is the GOOD outcome,
  // so it must not raise the nav badge or the 8am reminder push.
  const habits = [good(), bad()];
  assert.equal(countOutstandingHabits(habits, {}, []), 1, 'only the good habit is outstanding');
  const counts = countHabitsNeedingLog(habits, {}, []);
  assert.deepEqual(counts, { manual: 1, auto: 0 });
});

test('a bad habit stays uncounted no matter its cadence or status', () => {
  for (const cadence of ['Daily', 'Weekly', 'Monthly', 'Annually', '', 'nonsense']) {
    for (const status of ['Most Days', 'Some Days', 'Rarely']) {
      const counts = countHabitsNeedingLog([bad({ cadence, status })], {}, []);
      assert.equal(counts.manual, 0, `cadence=${cadence} status=${status} should not be outstanding`);
      assert.equal(counts.auto, 0);
    }
  }
});

test('logging a bad habit does not turn it into an outstanding one either', () => {
  // Marked or unmarked, it is simply never in the count.
  const log = { [TODAY]: { b1: 'done' } };
  assert.equal(countOutstandingHabits([bad()], log, []), 0);
  assert.equal(countOutstandingHabits([bad()], {}, []), 0);
});

test('a bad habit never shows in the yesterday-never-logged banner', () => {
  // It has history (so it is not "brand new"), was not marked yesterday, and is
  // Daily — every condition the banner looks for except being a good habit.
  const log = {
    '2026-08-01': { g1: 'done', b1: 'done' },
  };
  const missed = yesterdayUnloggedHabits([good(), bad()], log, [], NOW);
  assert.deepEqual(missed.map(h => h.id), ['g1']);
});

test('an automation rule on a bad habit still leaves it out of both halves', () => {
  const automations = [{ habitId: 'b1', enabled: true }];
  const counts = countHabitsNeedingLog([bad()], {}, automations);
  assert.deepEqual(counts, { manual: 0, auto: 0 });
});

test('bad habits keep writing to ordinary day keys', () => {
  // Their marks have to land where the grid and history already read, which is
  // what lets "bad" be a display concern rather than a second storage shape.
  assert.equal(periodKey(bad().cadence, NOW), TODAY);
  assert.equal(YESTERDAY, '2026-09-02');
});

test('the good half of the tracker is untouched by the change', () => {
  const habits = [good(), good({ id: 'g2', name: 'Walk' })];
  assert.equal(countOutstandingHabits(habits, {}, []), 2);
  assert.equal(countOutstandingHabits(habits, { [TODAY]: { g1: 'done' } }, []), 1);
  assert.equal(countOutstandingHabits(habits, { [TODAY]: { g1: 'done', g2: 'missed' } }, []), 0);
});
