// Reads replies to the weekly meal vote email out of the mailbox the app sends
// from (the same Gmail account and app password as lib/mailer.js, over IMAP).
//
// Read-only: the mailbox is opened without write access and bodies are
// fetched with PEEK, so nothing is marked read, moved or deleted. Which
// replies have been handled is remembered on the ballot, not in the mailbox.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { senderAddress, senderPassword } from './mailer.js';
import { VOTE_MAIL_HEADER, VOTE_SUBJECT_KEY, replyTagOf } from '../src/utils/mealVoteReply.js';

const lc = (s) => String(s || '').trim().toLowerCase();
const addresses = (list) => (list || []).map(a => lc(a?.address)).filter(Boolean);
const iso = (d) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString();
};

/** Is this envelope worth downloading? A tagged recipient, or the subject. */
export function looksLikeVoteReply(envelope) {
  if (!envelope) return false;
  if (replyTagOf([...addresses(envelope.to), ...addresses(envelope.cc)])) return true;
  return lc(envelope.subject).includes(VOTE_SUBJECT_KEY);
}

/** A downloaded message, cut down to what the collector needs. */
export async function toReply({ source, envelope, internalDate }) {
  const mail = await simpleParser(source);
  const header = (name) => {
    const v = mail.headers.get(String(name).toLowerCase());
    return typeof v === 'string' ? v : (v?.value ?? v?.text ?? (v == null ? '' : String(v)));
  };
  const autoSubmitted = lc(header('auto-submitted'));
  const precedence = lc(header('precedence'));
  const from = addresses(envelope?.from)[0] || lc(mail.from?.value?.[0]?.address);
  return {
    messageId: mail.messageId || envelope?.messageId || '',
    // When the mailbox received it — the sender can't choose this one.
    date: iso(internalDate) || iso(mail.date),
    from,
    to: [...addresses(envelope?.to), ...addresses(envelope?.cc)],
    subject: String(mail.subject || envelope?.subject || ''),
    isReply: !!(mail.inReplyTo || envelope?.inReplyTo) || /^\s*re\s*:/i.test(String(mail.subject || '')),
    references: [].concat(mail.references || []).filter(Boolean),
    text: mail.text || '',
    // Mail this app sent, and anything a machine sent back (out-of-office,
    // bounces): never a vote, and never answered — that is how loops start.
    ours: !!header(VOTE_MAIL_HEADER),
    automatic: (!!autoSubmitted && autoSubmitted !== 'no')
      || ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)
      || !!header('x-autoreply') || !!header('x-autorespond')
      || !from || /^(mailer-daemon|postmaster|no-?reply)@/.test(from),
  };
}

/**
 * Every candidate reply received in the last `sinceDays`, oldest first.
 * Throws if the mailbox can't be reached.
 */
export async function fetchVoteReplies({ sinceDays = 9, now = new Date() } = {}) {
  const user = senderAddress();
  const pass = senderPassword();
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not configured');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user, pass },
    logger: false,
  });
  // Without a listener a dropped connection is an unhandled 'error' event,
  // which would take the whole function down.
  client.on('error', (err) => console.error('meal-vote inbox: connection error', err?.message || err));
  const out = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const since = new Date(now.getTime() - sinceDays * 86400000);
      const recent = await client.search({ since }, { uid: true });
      if (Array.isArray(recent) && recent.length > 0) {
        const wanted = [];
        for await (const msg of client.fetch(recent, { uid: true, envelope: true }, { uid: true })) {
          if (looksLikeVoteReply(msg.envelope)) wanted.push(msg.uid);
        }
        if (wanted.length > 0) {
          for await (const msg of client.fetch(wanted, { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })) {
            try {
              out.push(await toReply(msg));
            } catch (err) {
              console.error('meal-vote inbox: unreadable message', msg.uid, err?.message || err);
            }
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
