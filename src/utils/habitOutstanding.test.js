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

// `countOutstandingHabits` and `countHabitsNeedingLog` DEFAULT to the real
// clock — they ask `periodKey(cadence)` for TODAY at the moment they run. So
// any log a test hands them without a date has to be keyed by the real current
// day, not by NOW above, or the mark simply isn't found and the habit reads as
// unlogged. (This bit: written on 3 Sep, green all day, red the next morning.)
// Anything given an explicit date — including those two, now the cron passes
// one — keeps using NOW.
const TODAY_REAL = dayKey(new Date());

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
  const log = { [TODAY_REAL]: { b1: 'done' } };
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
  assert.equal(countOutstandingHabits(habits, { [TODAY_REAL]: { g1: 'done' } }, []), 1);
  assert.equal(countOutstandingHabits(habits, { [TODAY_REAL]: { g1: 'done', g2: 'missed' } }, []), 0);
});

// The cron runs on a UTC server and must count against the user's OWN calendar
// day, not the runtime's. Before this, the day rolled over at 8pm Eastern: the
// badge jumped to a full count mid-evening, anything logged after that didn't
// bring it down (the mark landed on today's key while the count read tomorrow's),
// and at real midnight nothing had changed so no new number was ever sent.
test('countOutstandingHabits counts against the date it is given', () => {
  const habits = [good()];
  const log = { [dayKey(NOW)]: { g1: 'done' } };
  assert.equal(countOutstandingHabits(habits, log, [], NOW), 0, 'marked on the day asked about');
  const tomorrow = new Date(2026, 8, 4, 9, 0, 0);
  assert.equal(countOutstandingHabits(habits, log, [], tomorrow), 1, "yesterday's mark does not carry over");
});

test('a date is honoured for weekday tracking and weekly pins too', () => {
  // Weekdays only: due Thu 3 Sep, not Sat 5 Sep.
  const weekdaysOnly = good({ trackDays: [1, 2, 3, 4, 5] });
  assert.equal(countOutstandingHabits([weekdaysOnly], {}, [], NOW), 1);
  assert.equal(countOutstandingHabits([weekdaysOnly], {}, [], new Date(2026, 8, 5)), 0);

  // Pinned to Saturday: not due Thursday, due on the Saturday.
  const pinned = good({ id: 'w1', cadence: 'Weekly', weekDays: ['saturday'] });
  assert.equal(countOutstandingHabits([pinned], {}, [], NOW), 0);
  assert.equal(countOutstandingHabits([pinned], {}, [], new Date(2026, 8, 5)), 1);
});

test('countHabitsNeedingLog still reads the real clock when given no date', () => {
  const habits = [good()];
  assert.equal(countHabitsNeedingLog(habits, {}, []).manual, 1);
  assert.equal(countHabitsNeedingLog(habits, { [TODAY_REAL]: { g1: 'done' } }, []).manual, 0);
});
