import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPLY_TAG_LENGTH, BALLOT_INTRO, replyAddress, replyTagOf, voterForReplyTag,
  matchReply, typedText, parseReply,
} from './mealVoteReply.js';

const TOKEN_DAN = 'a'.repeat(32);
const TOKEN_JO = 'b'.repeat(32);
const ballot = () => ({
  options: {
    breakfast: [{ id: 'b1', title: 'Overnight Oats' }, { id: 'b2', title: 'Egg Muffins' }, { id: 'b3', title: 'Chia Pudding' }],
    'lunch-dinner': [{ id: 'd1', title: 'Turkey Chili' }, { id: 'd2', title: 'Sheet Pan Salmon' }],
  },
  voters: {
    v0: { name: 'Dan', email: 'dan@example.com', token: TOKEN_DAN },
    v1: { name: 'Joanne', email: 'jo@example.com', token: TOKEN_JO },
  },
  votes: {},
});
const accounts = () => [{ uid: 'u1', weeks: { '2026-11-08': ballot(), '2026-11-15': ballot() } }];

// What the email's own text looks like once a mail client has quoted it.
const QUOTED = [
  'On Fri, Nov 13, 2026 at 8:00 AM Prep Day <prepday@gmail.com> wrote:',
  '',
  '> Hi Joanne,',
  '>',
  `> *${BALLOT_INTRO}* of the meals you want on the shopping list`,
  '> for the week of Nov 15 — for example: 1, 3, 5',
  '>',
  '> Breakfast:',
  '>   1. Overnight Oats',
  '>   2. Egg Muffins',
  '>   3. Chia Pudding',
  '> Lunch & Dinner:',
  '>   4. Turkey Chili',
  '>   5. Sheet Pan Salmon',
].join('\n');

test('reply address: tags the sender with the voter token, or leaves it alone', () => {
  const tagged = replyAddress('prepday@gmail.com', TOKEN_JO);
  assert.equal(tagged, `prepday+mv${'b'.repeat(REPLY_TAG_LENGTH)}@gmail.com`);
  assert.equal(replyTagOf([tagged]), 'b'.repeat(REPLY_TAG_LENGTH));
  assert.equal(replyTagOf(['PrepDay+MV' + 'B'.repeat(REPLY_TAG_LENGTH) + '@Gmail.com']), 'b'.repeat(REPLY_TAG_LENGTH));
  assert.equal(replyTagOf(['prepday@gmail.com', 'x+mvshort@gmail.com']), '');
  assert.equal(replyAddress('prepday@gmail.com', 'short'), 'prepday@gmail.com');
  assert.equal(replyAddress(`${'x'.repeat(50)}@gmail.com`, TOKEN_JO), `${'x'.repeat(50)}@gmail.com`);
  assert.equal(voterForReplyTag(ballot(), 'b'.repeat(REPLY_TAG_LENGTH)).id, 'v1');
  assert.equal(voterForReplyTag(ballot(), 'c'.repeat(REPLY_TAG_LENGTH)), null);
  assert.equal(voterForReplyTag(ballot(), ''), null);
});

test('match: the tag names the voter whoever the reply is from', () => {
  const hit = matchReply(accounts(), {
    to: [replyAddress('prepday@gmail.com', TOKEN_JO)], from: 'someone.else@example.com', subject: 'whatever', isReply: false,
  });
  assert.equal(hit.uid, 'u1');
  assert.equal(hit.voter.id, 'v1');
  // A tag that belongs to nobody is not rescued by the sender's address.
  assert.equal(matchReply(accounts(), {
    to: [replyAddress('prepday@gmail.com', 'c'.repeat(32))], from: 'jo@example.com',
    subject: 'Re: Vote on next week\'s meals — week of Nov 15', isReply: true,
  }), null);
});

test('match: without a tag, the sender and the week in the subject', () => {
  const msg = { to: ['prepday@gmail.com'], from: 'jo@example.com', subject: 'RE: Vote on next week\'s meals — week of Nov 8', isReply: true };
  const hit = matchReply(accounts(), msg);
  assert.equal(hit.weekOf, '2026-11-08');
  assert.equal(hit.voter.id, 'v1');
  assert.equal(matchReply(accounts(), { ...msg, from: 'stranger@example.com' }), null);
  assert.equal(matchReply(accounts(), { ...msg, isReply: false }), null);
  assert.equal(matchReply(accounts(), { ...msg, subject: 'Re: lunch?' }), null);
  // "Nov 1" must not match the week of Nov 15.
  assert.equal(matchReply(accounts(), { ...msg, subject: 'Re: … week of Nov 1' }), null);
});

test('typed text: the quoted email, signature and phone footer are not the vote', () => {
  assert.equal(typedText(`1, 4\n\n${QUOTED}`), '1, 4');
  assert.equal(typedText(`2 and 5\n\nSent from my iPhone\n\n${QUOTED}`), '2 and 5');
  assert.equal(typedText('3\n-- \nJoanne\n555 0142'), '3');
  assert.equal(typedText('1\r\n\r\n-----Original Message-----\r\nFrom: Prep Day\r\n 1. Overnight Oats'), '1');
  assert.equal(typedText('4\n\nFrom: Prep Day <prepday@gmail.com>\nSent: Friday, November 13, 2026 8:00 AM\n1. Overnight Oats'), '4');
  // Gmail wraps a long attribution line onto two.
  assert.equal(typedText('5\n\nOn Fri, Nov 13, 2026 at 8:00 AM Prep Day <prepday@gmail.com>\nwrote:\n\n> 1. Overnight Oats'), '5');
  // A client whose attribution line isn't recognised, quoting without '>'.
  assert.equal(typedText(`2\n\nLe ven. 13 nov. 2026 à 08:00, Prep Day a écrit :\n\nHi Joanne,\n\n${BALLOT_INTRO} of the meals\n 1. Overnight Oats`), '2');
  // The intro re-wrapped mid-phrase by the quoting client.
  assert.equal(typedText('3\n\n> Reply to this email\n> with the numbers of the meals\n> 1. Overnight Oats'), '3');
  assert.equal(typedText(QUOTED), '');
});

test('parse: numbers in any punctuation, ranges, names, all and none', () => {
  const b = ballot();
  const picks = (text) => parseReply(b, text).picks;
  assert.deepEqual(picks('1, 4'), ['b1', 'd1']);
  assert.deepEqual(picks('#5 and #2 please!'), ['b2', 'd2']);
  assert.deepEqual(picks('1.\n3.\n'), ['b1', 'b3']);
  assert.deepEqual(picks('2-4'), ['b2', 'b3', 'd1']);
  assert.deepEqual(picks('1 to 3'), ['b1', 'b2', 'b3']);
  assert.deepEqual(picks('the turkey chili and 1'), ['b1', 'd1']);
  assert.deepEqual(picks('All of them'), ['b1', 'b2', 'b3', 'd1', 'd2']);
  assert.deepEqual(parseReply(b, 'None this week'), { understood: true, picks: [], typed: 'None this week' });
  // Numbers that are off the ballot, or part of a time or date, are not votes.
  assert.deepEqual(picks('1, 9, 12'), ['b1']);
  assert.equal(parseReply(b, 'back at 5:30 on 11/15').understood, false);
  assert.equal(parseReply(b, 'Sounds good, thanks').understood, false);
  assert.equal(parseReply(b, '').understood, false);
});

test('parse: a reply that quotes the whole ballot votes only for what was typed', () => {
  const b = ballot();
  assert.deepEqual(parseReply(b, `4\n\n${QUOTED}`).picks, ['d1']);
  const empty = parseReply(b, QUOTED);
  assert.equal(empty.understood, false);
  assert.equal(empty.typed, '');
});
