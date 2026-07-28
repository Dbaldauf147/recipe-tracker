import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGuestEmail,
  isValidGuestEmail,
  normalizeCalendarSyncSettings,
  resolveEventGuests,
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
