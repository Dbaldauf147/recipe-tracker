// Voting by replying to the weekly meal vote email.
//
// The email numbers its meals 1–10 and asks for a reply such as "1, 4, 7".
// The reply lands in the mailbox the app sends from, where a cron reads it
// (api/collect-meal-vote.js). Everything here is the pure part: which ballot a
// reply belongs to, and what the person typed.
//
// Two ways a reply is tied to its voter:
//   • the Reply-To address carries a tag (sender+mv<token>@…), so the reply's
//     own To header names the voter and week whoever it is sent from;
//   • failing that — a mail client that ignored Reply-To — the sender's
//     address and the "week of …" in the subject.

import { ballotOptions, weekLabel } from './mealVote.js';

/** Hex characters of the voter token carried in the Reply-To tag. */
export const REPLY_TAG_LENGTH = 24;
/** Words every vote email's subject carries; how the inbox is filtered. */
export const VOTE_SUBJECT_KEY = 'next week\'s meals';
/** Marks mail this app sent, so its own messages are never read as replies. */
export const VOTE_MAIL_HEADER = 'X-Prep-Day-Mail';

// The opening words of the mails this app sends. A reply quotes them; whatever
// follows one is the original message, not something the voter typed.
export const BALLOT_INTRO = 'Reply to this email with the numbers';
export const RECEIPT_INTRO = 'Prep Day counted your vote';
export const RETRY_INTRO = 'Prep Day couldn\'t find any meal numbers';

/**
 * The address replies go to: the sending mailbox, tagged with the voter's
 * token. Returns the plain address when a tag would not fit.
 */
export function replyAddress(sender, token) {
  const address = String(sender || '').trim();
  const at = address.lastIndexOf('@');
  const tag = String(token || '').slice(0, REPLY_TAG_LENGTH);
  if (at < 1 || !/^[0-9a-f]+$/.test(tag) || tag.length < REPLY_TAG_LENGTH) return address;
  const local = `${address.slice(0, at)}+mv${tag}`;
  return local.length > 64 ? address : `${local}${address.slice(at)}`;
}

/** The tag in any of a message's recipient addresses, or ''. */
export function replyTagOf(addresses) {
  for (const a of (Array.isArray(addresses) ? addresses : [addresses])) {
    const m = String(a || '').toLowerCase().match(new RegExp(`\\+mv([0-9a-f]{${REPLY_TAG_LENGTH}})@`));
    if (m) return m[1];
  }
  return '';
}

/** The voter a Reply-To tag belongs to: { id, name, email } or null. */
export function voterForReplyTag(ballot, tag) {
  if (String(tag || '').length !== REPLY_TAG_LENGTH) return null;
  for (const [id, v] of Object.entries(ballot?.voters || {})) {
    if (v?.token && String(v.token).startsWith(tag)) return { id, name: v.name, email: v.email };
  }
  return null;
}

/**
 * Which ballot a reply is for. `accounts` is [{ uid, weeks }]; `message` has
 * to (addresses), from (address), subject and isReply.
 * Returns { uid, weekOf, ballot, voter } or null.
 */
export function matchReply(accounts, message) {
  const tag = replyTagOf(message?.to);
  if (tag) {
    for (const { uid, weeks } of accounts) {
      for (const [weekOf, ballot] of Object.entries(weeks || {})) {
        const voter = voterForReplyTag(ballot, tag);
        if (voter) return { uid, weekOf, ballot, voter };
      }
    }
    return null;
  }
  const from = String(message?.from || '').trim().toLowerCase();
  const subject = String(message?.subject || '').toLowerCase();
  if (!from || !message?.isReply) return null;
  let best = null;
  for (const { uid, weeks } of accounts) {
    for (const [weekOf, ballot] of Object.entries(weeks || {})) {
      const label = weekLabel(weekOf).toLowerCase();
      if (!label || !new RegExp(`week of ${label}(?!\\d)`).test(subject)) continue;
      for (const [id, v] of Object.entries(ballot?.voters || {})) {
        if (v?.email !== from) continue;
        if (!best || weekOf > best.weekOf) best = { uid, weekOf, ballot, voter: { id, name: v.name, email: v.email } };
      }
    }
  }
  return best;
}

// Quoted text is re-wrapped and re-marked by mail clients, so the words of an
// intro may arrive split across lines with '>' or '*' between them.
const INTROS = [BALLOT_INTRO, RECEIPT_INTRO, RETRY_INTRO].map(intro => new RegExp(
  intro.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, '[\'\u2019]')).join('[\\s>*]+'),
  'i',
));

/**
 * What the person typed: a reply's text without the message it quotes, the
 * signature, or the "Sent from my phone" line.
 */
export function typedText(text) {
  let s = String(text || '').replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ');

  // Where the quoted original begins, by whichever sign comes first.
  let cut = s.length;
  for (const re of [
    ...INTROS,
    /^[ \t>]*On\b[^\n]*(?:\n[^\n]*)?\bwrote:[ \t]*$/mi,
    /^[ \t>]*-{2,}[ \t]*Original Message[ \t]*-{2,}/mi,
    /^[ \t>]*-{2,}[ \t]*Forwarded message[ \t]*-{2,}/mi,
    /^[ \t]*_{8,}[ \t]*$/m,
    /^[ \t>]*\*{0,2}From:\*{0,2}[ \t]+\S/m,
  ]) {
    const m = re.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  const quoted = cut < s.length;
  s = s.slice(0, cut);

  let lines = s.split('\n').filter(l => !/^\s*>/.test(l));
  const sig = lines.findIndex(l => /^--\s?$/.test(l));
  if (sig >= 0) lines = lines.slice(0, sig);
  lines = lines.filter(l => !/^\s*(sent from|get outlook for)\b/i.test(l));

  if (quoted) {
    // The lines just above a quoted message belong to it: its greeting
    // ("Hi Dan,") and the mail client's "On <date>, <who> wrote:" in whatever
    // language — which is full of numbers and always ends in a colon.
    const dropLast = (test) => {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length && test(lines[lines.length - 1].trim())) lines.pop();
    };
    dropLast(l => /^hi\b.*,$/i.test(l));
    dropLast(l => /:$/.test(l));
  }
  return lines.join('\n').trim();
}

/**
 * The meals a reply votes for.
 * Returns { understood, picks, typed }: `understood` is false when nothing in
 * the reply named a meal, and the vote should be left as it was.
 *
 * Accepts the numbers in any punctuation ("1, 4 and 7", "#2 #9"), a range
 * ("6-8"), a meal's name, "all" and "none".
 */
export function parseReply(ballot, text) {
  const options = ballotOptions(ballot);
  const typed = typedText(text);
  const picked = new Set();
  let understood = false;

  const rest = typed.replace(/(?<![\d:/.])(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})(?![\d:/])/g, (all, a, b) => {
    const from = Number(a);
    const to = Number(b);
    if (from < 1 || to > options.length || from >= to) return all;
    for (let n = from; n <= to; n++) picked.add(options[n - 1].id);
    return ' ';
  });
  for (const m of rest.matchAll(/(?<![\d:/.])(\d{1,2})(?![\d:/]|\.\d)/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= options.length) picked.add(options[n - 1].id);
  }

  const flat = typed.toLowerCase().replace(/\s+/g, ' ');
  for (const o of options) {
    const title = String(o.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (title.length >= 4 && flat.includes(title)) picked.add(o.id);
  }

  if (picked.size > 0) understood = true;
  else if (/^(none|nothing|no thanks|skip)\b/i.test(typed)) understood = true;
  else if (/^(all|everything|any)\b/i.test(typed)) {
    understood = true;
    for (const o of options) picked.add(o.id);
  }
  // Ballot order, so a receipt lists meals the way the email did.
  return { understood, picks: options.filter(o => picked.has(o.id)).map(o => o.id), typed };
}
