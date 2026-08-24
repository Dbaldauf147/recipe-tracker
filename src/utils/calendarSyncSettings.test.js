import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGuestEmail,
  isValidGuestEmail,
  normalizeCalendarSyncSettings,
  resolveEventGuests,
  splitEventKey,
  planEventReuse,
  pinnedDate,
  ANY_WORKOUT,
} from './calendarSyncSettings.js';

const GUEST = 'friend@example.com';
const OWNER = 'me@example.com';

// An event as Google returns it once it has any attendee: the organiser is
// listed alongside the guest, which is the whole reason resolveEventGuests
// doesn't compare lists wholesale.
function eventWith(...emails) {
  return {
    attendees: emails.map(e => (typeof e === 'string' ? { email: e } : e)),
  };
}

test('guest email normalization', () => {
  assert.equal(normalizeGuestEmail('  Friend@Example.COM '), 'friend@example.com');
  assert.equal(normalizeGuestEmail('not-an-email'), '');
  assert.equal(normalizeGuestEmail(''), '');
  assert.equal(normalizeGuestEmail(null), '');
  assert.equal(normalizeGuestEmail(undefined), '');
  assert.equal(isValidGuestEmail('a@b.co'), true);
  assert.equal(isValidGuestEmail('a@b'), false);
  assert.equal(isValidGuestEmail('a b@c.co'), false);
});

test('guestEmail survives a settings round-trip and rejects junk', () => {
  const a = normalizeCalendarSyncSettings({ guestEmail: 'Friend@Example.com' });
  assert.equal(a.guestEmail, GUEST);
  // Re-normalizing a normalized object must not drop it (the UI saves the
  // result of normalize on every keystroke of an unrelated field).
  assert.equal(normalizeCalendarSyncSettings(a).guestEmail, GUEST);
  assert.equal(normalizeCalendarSyncSettings({ guestEmail: 'oops' }).guestEmail, '');
  assert.equal(normalizeCalendarSyncSettings({}).guestEmail, '');
  // Adding it must not disturb the per-kind timing.
  assert.equal(a.weights.time, '18:00');
  assert.equal(a.sauna.after, 'workout');
});

test('a guest already on the event is left alone — the hourly re-invite guard', () => {
  // THE regression this protects: the organiser appears in `attendees` as soon
  // as there is a guest. A naive list comparison would see a mismatch every
  // run, PATCH with sendUpdates=all, and email the guest once an hour forever.
  const ev = eventWith(GUEST, { email: OWNER, organizer: true, self: true });
  const r = resolveEventGuests(ev, GUEST, GUEST);
  assert.equal(r.changed, false);
});

test('repeated runs stay idempotent', () => {
  let ev = eventWith();
  let prev = '';
  const first = resolveEventGuests(ev, GUEST, prev);
  assert.equal(first.changed, true);
  // Simulate Google echoing back the organiser alongside our guest.
  ev = { attendees: [...first.attendees, { email: OWNER, organizer: true, self: true }] };
  prev = GUEST;
  for (let i = 0; i < 5; i++) {
    assert.equal(resolveEventGuests(ev, GUEST, prev).changed, false, `run ${i + 2} must not re-patch`);
  }
});

test('missing guest is added, preserving other attendees and their RSVPs', () => {
  const ev = eventWith(
    { email: 'someone@else.com', responseStatus: 'accepted' },
    { email: OWNER, organizer: true },
  );
  const r = resolveEventGuests(ev, GUEST, '');
  assert.equal(r.changed, true);
  const byEmail = Object.fromEntries(r.attendees.map(a => [a.email, a]));
  assert.equal(byEmail['someone@else.com'].responseStatus, 'accepted', 'RSVP must survive');
  assert.ok(byEmail[OWNER], 'organiser kept');
  assert.ok(byEmail[GUEST], 'guest added');
});

test('changing the guest swaps ours out and leaves hand-added guests', () => {
  const NEW = 'other@example.com';
  const ev = eventWith(GUEST, 'manually@added.com', OWNER);
  const r = resolveEventGuests(ev, NEW, GUEST);
  assert.equal(r.changed, true);
  const emails = r.attendees.map(a => a.email);
  assert.ok(!emails.includes(GUEST), 'the address we previously added is removed');
  assert.ok(emails.includes('manually@added.com'), 'a guest added by hand in Google is kept');
  assert.ok(emails.includes(OWNER), 'organiser kept');
  assert.ok(emails.includes(NEW), 'new guest added');
});

test('clearing the setting removes only our guest', () => {
  const ev = eventWith(GUEST, 'manually@added.com');
  const r = resolveEventGuests(ev, '', GUEST);
  assert.equal(r.changed, true);
  assert.deepEqual(r.attendees.map(a => a.email), ['manually@added.com']);
});

test('clearing when we never added anyone is a no-op', () => {
  const ev = eventWith('manually@added.com');
  assert.equal(resolveEventGuests(ev, '', '').changed, false);
});

test('an event with no attendees and no guest configured is a no-op', () => {
  assert.equal(resolveEventGuests({}, '', '').changed, false);
  assert.equal(resolveEventGuests({ attendees: [] }, '', '').changed, false);
});

test('case and whitespace differences do not cause a re-invite', () => {
  const ev = eventWith('  FRIEND@Example.com  ');
  assert.equal(resolveEventGuests(ev, 'friend@example.com', 'friend@example.com').changed, false);
});

// ---------------------------------------------------------------------------
// planEventReuse / pinnedDate — the churn controls for the hourly sync.
// ---------------------------------------------------------------------------

const TODAY = '2026-08-24';
const TOMORROW = '2026-08-25';
const LATER = '2026-08-27';

test('splitEventKey splits on the first bar only', () => {
  assert.deepEqual(splitEventKey('2026-08-25|weights'), { date: '2026-08-25', kind: 'weights' });
  // A kind containing a bar would still round-trip its date.
  assert.deepEqual(splitEventKey('2026-08-25|odd|kind'), { date: '2026-08-25', kind: 'odd|kind' });
  assert.deepEqual(splitEventKey('nope'), { date: 'nope', kind: '' });
});
test('a category flip adopts the day’s existing workout instead of delete+create', () => {
  const { adopt } = planEventReuse([`${TOMORROW}|cardio`], [`${TOMORROW}|weights`], TODAY);
  assert.equal(adopt.get(`${TOMORROW}|cardio`), `${TOMORROW}|weights`);
});

test('an exact match is neither adopted nor skipped', () => {
  const { adopt, skip } = planEventReuse([`${TOMORROW}|weights`], [`${TOMORROW}|weights`], TODAY);
  assert.equal(adopt.size, 0);
  assert.equal(skip.size, 0);
});

test('adoption never crosses days', () => {
  const { adopt } = planEventReuse([`${LATER}|cardio`], [`${TOMORROW}|weights`], TODAY);
  assert.equal(adopt.size, 0);
});

test('sauna and cooking never adopt, and are never adopted from', () => {
  // A dropped sauna must not be recycled into a workout...
  assert.equal(planEventReuse([`${TOMORROW}|weights`], [`${TOMORROW}|sauna`], TODAY).adopt.size, 0);
  // ...nor a dropped workout into a sauna.
  assert.equal(planEventReuse([`${TOMORROW}|sauna`], [`${TOMORROW}|weights`], TODAY).adopt.size, 0);
  assert.equal(planEventReuse([`${TOMORROW}|cooking`], [`${TOMORROW}|weights`], TODAY).adopt.size, 0);
});

test('a legacy untagged event is re-keyed in place, not replaced', () => {
  // Events written before per-category timing carry ANY_WORKOUT.
  const { adopt } = planEventReuse([`${TOMORROW}|weights`], [`${TOMORROW}|${ANY_WORKOUT}`], TODAY);
  assert.equal(adopt.get(`${TOMORROW}|weights`), `${TOMORROW}|${ANY_WORKOUT}`);
});

test('today is pinned — a category flip rewrites nothing and adds nothing', () => {
  // The regression this guards: skipping adoption on a pinned day without also
  // skipping the CREATE leaves today holding two workout events, because the
  // delete loop never sweeps a pinned day either.
  const { adopt, skip } = planEventReuse([`${TODAY}|cardio`], [`${TODAY}|weights`], TODAY);
  assert.equal(adopt.size, 0);
  assert.ok(skip.has(`${TODAY}|cardio`));
});

test('a pinned day still creates a kind it has no event for at all', () => {
  // Today's workout stands; a newly-planned sauna alongside it rewrites nothing,
  // so it goes through as an ordinary create.
  const { adopt, skip } = planEventReuse(
    [`${TODAY}|weights`, `${TODAY}|sauna`],
    [`${TODAY}|weights`],
    TODAY,
  );
  assert.equal(adopt.size, 0);
  assert.equal(skip.size, 0);
});

test('a pinned day with two planned workouts and one event creates only the shortfall', () => {
  const { adopt, skip } = planEventReuse(
    [`${TODAY}|cardio`, `${TODAY}|yoga`],
    [`${TODAY}|weights`],
    TODAY,
  );
  assert.equal(adopt.size, 0);
  // One desired workout is covered by the standing event; the other is a create.
  assert.equal(skip.size, 1);
});

test('a paired day adopts one event per desired workout, and no more', () => {
  // Wednesday held cardio + yoga; the plan now wants weights + cardio there.
  const { adopt } = planEventReuse(
    [`${TOMORROW}|weights`, `${TOMORROW}|cardio`],
    [`${TOMORROW}|cardio`, `${TOMORROW}|yoga`],
    TODAY,
  );
  // cardio matches exactly, so only weights adopts — and the only unmatched
  // event left to take over is the yoga one.
  assert.equal(adopt.size, 1);
  assert.equal(adopt.get(`${TOMORROW}|weights`), `${TOMORROW}|yoga`);
});

test('an event is never adopted twice', () => {
  const { adopt } = planEventReuse(
    [`${TOMORROW}|weights`, `${TOMORROW}|cardio`],
    [`${TOMORROW}|yoga`],
    TODAY,
  );
  assert.equal(adopt.size, 1);
  assert.deepEqual([...new Set(adopt.values())], [`${TOMORROW}|yoga`]);
});

test('adoption is stable across runs given the same inputs', () => {
  const desired = [`${TOMORROW}|cardio`, `${LATER}|yoga`];
  const existing = [`${TOMORROW}|weights`, `${LATER}|weights`];
  const a = planEventReuse(desired, existing, TODAY).adopt;
  // Same sets, opposite insertion order — the pairing must not move.
  const b = planEventReuse([...desired].reverse(), [...existing].reverse(), TODAY).adopt;
  assert.deepEqual([...a].sort(), [...b].sort());
});

test('a day dropping to rest still deletes — there is nothing to adopt into', () => {
  const { adopt, skip } = planEventReuse([], [`${TOMORROW}|weights`], TODAY);
  assert.equal(adopt.size, 0);
  assert.equal(skip.size, 0);
});

test('pinnedDate covers today and nothing else', () => {
  assert.equal(pinnedDate(TODAY, TODAY), true);
  assert.equal(pinnedDate(TOMORROW, TODAY), false);
  assert.equal(pinnedDate('2026-08-23', TODAY), false);
  // No "today" known (a caller that opted out) pins nothing.
  assert.equal(pinnedDate(TODAY, ''), false);
});
