// The words and markup of the weekly meal vote: the email, the receipt sent
// back when someone replies to it, and the small ballot page behind its one
// link. Pure — the routes (api/send-meal-vote.js, api/collect-meal-vote.js,
// api/meal-vote.js) do the reading and writing.
//
// The vote itself is a reply to the email with the meals' numbers. A vote is
// never recorded by opening a link: mail scanners and link previews fetch
// every URL in a message, so a link that voted would vote on its own. On the
// ballot page the Save button is a POST.

import {
  MEAL_VOTE_COLUMN_LABEL, MEAL_VOTE_MORE_NUMBER, ballotOptions, columnOptions, tallyBallot, weekLabel,
} from '../src/utils/mealVote.js';
import { SUGGEST_CATEGORIES } from '../src/utils/suggestForecast.js';
import { BALLOT_INTRO, RECEIPT_INTRO, RETRY_INTRO } from '../src/utils/mealVoteReply.js';

const ACCENT = '#3B6B9C';
const INK = '#1E2A36';
const MUTED = '#7A8FA3';
const LINE = '#DDE6EE';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/** The link a voter opens. `pick` ticks one meal on arrival. */
export function voteUrl(base, { uid, weekOf, token, pick }) {
  const q = new URLSearchParams({ u: uid, w: weekOf, t: token });
  if (pick) q.set('pick', pick);
  return `${String(base).replace(/\/+$/, '')}/api/meal-vote?${q}`;
}

// How the emails mark a meal Joanne has a view on.
const JOANNE = {
  yes: { label: 'Joanne likes', color: '#2E7D4F', text: 'Joanne likes it' },
  no: { label: 'Joanne: not a fan', color: '#B4532A', text: 'Joanne isn\'t a fan' },
};

const MORE_LABEL = 'Send me more meal options';

/**
 * The email for one voter: { subject, text, html }.
 *
 * The meals are numbered straight down Breakfast then Lunch & Dinner, set side
 * by side, and the vote is a reply with the numbers — nothing to open. One
 * extra number (MEAL_VOTE_MORE_NUMBER) asks for the next round of meals. The
 * ballot page stays as a single link at the bottom for anyone who would rather
 * tick boxes.
 *
 * With `round` (an index into ballotRounds), only that round's meals are shown:
 * the email that answers a request for more. `picked` is then the voter's
 * picks so far, which the numbers they reply with are added to.
 */
export function renderMealVoteEmail({ base, uid, ballot, voter, round = null, picked = [] }) {
  const week = weekLabel(ballot.weekOf);
  const link = voteUrl(base, { uid, weekOf: ballot.weekOf, token: voter.token });
  const subject = round == null
    ? `Vote on next week's meals — week of ${week}`
    : `Re: Vote on next week's meals — week of ${week}`;
  const all = ballotOptions(ballot).map((o, i) => ({ ...o, n: i + 1 }));
  const shown = round == null ? all : all.filter(o => o.round === round);
  const nums = shown.map(o => o.n);
  // Three numbers that are really in this email, spread across it.
  const example = [...new Set([nums[0], nums[Math.ceil(nums.length / 2) - 1], nums[nums.length - 1]])].join(', ');
  const more = MEAL_VOTE_MORE_NUMBER;
  const chosen = all.filter(o => picked.includes(o.id));
  const sofar = chosen.length ? chosen.map(o => o.n).join(', ') : '';

  const lead = round == null ? `Hi ${voter.name},` : `Here are more meals, ${voter.name}.`;
  const ask = `${BALLOT_INTRO} of the meals you want on the shopping list for the week of ${week}`;
  const textLines = [lead, '', `${ask} — for example: ${example}`];
  if (round != null) {
    textLines.push(sofar
      ? `They're added to what you've picked so far (${sofar}).`
      : 'They\'re added to anything you\'ve already picked.');
  }
  textLines.push('');

  const td = `padding:5px 6px 5px 0;border-bottom:1px solid ${LINE};vertical-align:top;`;
  const column = (cat) => {
    const options = shown.filter(o => o.category === cat);
    if (options.length === 0) return '';
    textLines.push(`${MEAL_VOTE_COLUMN_LABEL[cat]}:`);
    let rows = '';
    for (const o of options) {
      const j = JOANNE[o.joanne];
      textLines.push(`  ${o.n}. ${o.title}${j ? ` (${j.text})` : ''}`);
      rows += `<tr><td style="${td}width:24px;font-size:15px;font-weight:700;color:${ACCENT};">${o.n}</td>`
        + `<td style="${td}padding-right:0;font-size:15px;line-height:1.3;color:${INK};">${esc(o.title)}`
        + (j ? `<br><span style="font-size:11px;font-weight:600;color:${j.color};">${esc(j.label)}</span>` : '')
        + '</td></tr>';
    }
    textLines.push('');
    return `<div style="margin:0 0 4px 0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};font-weight:700;">${esc(MEAL_VOTE_COLUMN_LABEL[cat])}</div>`
      + `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">${rows}</table>`;
  };
  const cells = SUGGEST_CATEGORIES.map(column).filter(Boolean);
  // Side by side: a two-cell table, which every mail client (Outlook too)
  // lays out the same way.
  const grid = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:14px 0 0 0;"><tr>'
    + cells.map((c, i) => `<td width="${Math.floor(100 / cells.length)}%" style="vertical-align:top;${i < cells.length - 1 ? 'padding-right:18px;' : ''}">${c}</td>`).join('')
    + '</tr></table>';
  const moreRow = '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0 0 0;"><tr>'
    + `<td style="padding:6px 10px;border:1px dashed ${ACCENT};border-radius:6px;font-size:15px;color:${INK};">`
    + `<strong style="color:${ACCENT};">${more}</strong>&nbsp;&nbsp;${MORE_LABEL}</td></tr></table>`;

  const footer = round == null
    ? 'Reply again any time to change your votes — the latest reply counts. Reply "none" to pass.'
    : 'Reply "none" to clear your picks and start over.';
  textLines.push(
    `  ${more}. ${MORE_LABEL}`, '',
    footer,
    '', `Rather tick boxes? ${link}`, '', '— Prep Day',
  );

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${INK};max-width:680px;">`
    + `<p style="margin:0 0 4px 0;font-size:15px;">${esc(lead)}</p>`
    + `<p style="margin:0;font-size:15px;line-height:1.4;"><strong>${esc(BALLOT_INTRO)}</strong> of the meals you want on the shopping list for the week of <strong>${esc(week)}</strong> — for example: <strong>${esc(example)}</strong></p>`
    + (round == null ? '' : `<p style="margin:6px 0 0 0;font-size:14px;line-height:1.4;color:#4A5B6E;">${sofar
      ? `They're added to what you've picked so far (<strong>${esc(sofar)}</strong>).`
      : 'They\'re added to anything you\'ve already picked.'}</p>`)
    + grid
    + moreRow
    + `<p style="margin:14px 0 0 0;font-size:13px;line-height:1.4;color:${MUTED};">${esc(footer).replace(/&quot;none&quot;/, '“none”')} Rather tick boxes? <a href="${esc(link)}" style="color:${ACCENT};">Open the ballot</a>.</p>`
    + '</div>';

  return { subject, text: textLines.join('\n'), html };
}

/**
 * The same email as a form, for mail clients that run AMP for Email (Gmail):
 * a checkbox per meal and a Save button that works inside the message. Sent
 * as an extra part alongside the HTML and text, so every other client — and
 * Gmail, whenever it won't run AMP for this sender — shows those instead.
 *
 * Kept to the plainest markup the format has: one form, checkboxes, a button
 * and the two result templates. AMP mail that fails validation is silently
 * replaced by the HTML part, so nothing here is clever.
 *
 * `base` must be the https origin of the site; the form can post nowhere else.
 */
export function renderMealVoteAmp({ base, uid, ballot, voter }) {
  const week = weekLabel(ballot.weekOf);
  const origin = String(base).replace(/\/+$/, '');
  const link = voteUrl(base, { uid, weekOf: ballot.weekOf, token: voter.token });
  const saved = ballot.votes?.[voter.id]?.picks;
  const ticked = new Set(Array.isArray(saved) ? saved : []);
  const all = ballotOptions(ballot).map((o, i) => ({ ...o, n: i + 1 }));

  const cells = [];
  for (const cat of SUGGEST_CATEGORIES) {
    const options = all.filter(o => o.category === cat);
    if (options.length === 0) continue;
    let col = `<h2>${esc(MEAL_VOTE_COLUMN_LABEL[cat])}</h2><table role="presentation">`;
    for (const o of options) {
      const j = JOANNE[o.joanne];
      col += `<tr><td class="c-box"><input type="checkbox" id="m${o.n}" name="pick" value="${esc(o.id)}"${ticked.has(o.id) ? ' checked' : ''}></td>`
        + `<td class="c-num">${o.n}</td>`
        + `<td class="meal"><label for="m${o.n}">${esc(o.title)}</label>`
        + (j ? `<br><span class="jo ${o.joanne}">${esc(j.label)}</span>` : '')
        + '</td></tr>';
    }
    cells.push(`${col}</table>`);
  }
  const cols = `<table role="presentation" class="grid"><tr>${cells.map(c => `<td class="col">${c}</td>`).join('')}</tr></table>`;

  return '<!doctype html><html ⚡4email><head><meta charset="utf-8">'
    + '<script async src="https://cdn.ampproject.org/v0.js"></script>'
    + '<script async custom-element="amp-form" src="https://cdn.ampproject.org/v0/amp-form-0.1.js"></script>'
    + '<script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>'
    + '<style amp4email-boilerplate>body{visibility:hidden}</style>'
    + '<style amp-custom>'
    + `body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:${INK};background:#ffffff;padding:16px;}`
    + '.wrap{max-width:680px;}'
    + 'p{margin:0 0 4px 0;font-size:16px;line-height:1.45;}'
    + `h2{margin:22px 0 8px 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};}`
    + 'table{width:100%;border-collapse:collapse;}'
    + '.grid td.col{width:50%;vertical-align:top;padding:0 16px 0 0;border:0;}'
    + `th{padding:0 10px 6px 0;border-bottom:1px solid ${LINE};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};text-align:left;font-weight:600;}`
    + `td{padding:5px 6px 5px 0;border-bottom:1px solid ${LINE};vertical-align:top;font-size:13px;line-height:1.3;color:#4A5B6E;}`
    + '.c-box{width:30px;}'
    + 'input{width:20px;height:20px;margin:0;}'
    + `.c-num{width:24px;font-size:15px;font-weight:700;color:${ACCENT};}`
    + `.meal{font-size:15px;color:${INK};}`
    + '.jo{font-size:11px;font-weight:600;}'
    + '.yes{color:#2E7D4F;}'
    + '.no{color:#B4532A;}'
    + `button{margin:22px 0 0 0;padding:12px 22px;border:0;border-radius:6px;background:${ACCENT};color:#ffffff;font-size:16px;font-weight:600;}`
    + '.ok{margin:14px 0 0 0;padding:12px 14px;border-radius:8px;background:#E8F5ED;color:#2E7D4F;font-weight:600;font-size:15px;}'
    + '.bad{margin:14px 0 0 0;padding:12px 14px;border-radius:8px;background:#FBEDE6;color:#B4532A;font-size:15px;}'
    + `.note{margin:16px 0 0 0;font-size:14px;color:${MUTED};}`
    + `a{color:${ACCENT};}`
    + '</style></head><body><div class="wrap">'
    + `<p>Hi ${esc(voter.name)},</p>`
    + `<p><strong>Tick the meals you want</strong> on the shopping list for the week of <strong>${esc(week)}</strong>, then press Save.</p>`
    + `<form method="post" action-xhr="${esc(origin)}/api/meal-vote-amp">`
    + `<input type="hidden" name="u" value="${esc(uid)}">`
    + `<input type="hidden" name="w" value="${esc(ballot.weekOf)}">`
    + `<input type="hidden" name="t" value="${esc(voter.token)}">`
    + cols
    + `<button type="submit">${saved ? 'Update my votes' : 'Save my votes'}</button>`
    + '<div submit-success><template type="amp-mustache"><div class="ok">{{message}}</div></template></div>'
    + '<div submit-error><template type="amp-mustache"><div class="bad">Your votes weren\'t saved. {{message}} You can reply to this email with the meal numbers instead.</div></template></div>'
    + '</form>'
    + '<p class="note">Saving again replaces your vote. The boxes show your vote as it was when this email was sent.</p>'
    + `<p class="note">You can also reply with the numbers — or ${MEAL_VOTE_MORE_NUMBER} for more meal options — or <a href="${esc(link)}">open the ballot</a>.</p>`
    + '</div></body></html>';
}

/**
 * The answer to a reply: what was counted, or — when no meal could be found
 * in it — how to say it. { subject, text, html }, sent back into the thread.
 * `outOfMeals`: they asked for more meals and every suggestion is already on
 * the ballot.
 */
export function renderVoteReceipt({ ballot, voter, picks, understood, outOfMeals = false }) {
  const week = weekLabel(ballot.weekOf);
  const subject = `Re: Vote on next week's meals — week of ${week}`;
  const options = ballotOptions(ballot);
  const numbered = options.map((o, i) => ({ ...o, n: i + 1 }));
  const p = (t) => `<p style="margin:0 0 10px 0;font-size:16px;line-height:1.45;">${t}</p>`;
  const wrap = (inner) => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${INK};max-width:520px;">${inner}</div>`;

  if (!understood) {
    const more = { n: MEAL_VOTE_MORE_NUMBER, title: 'Send me more meal options' };
    const listed = [...numbered, more];
    const lines = listed.map(o => `  ${o.n}. ${o.title}`);
    return {
      subject,
      text: [`${RETRY_INTRO} in your reply, ${voter.name}, so nothing has changed.`, '',
        'Reply with just the numbers, like: 1, 4, 7', '', ...lines, '', '— Prep Day'].join('\n'),
      html: wrap(
        p(`${esc(RETRY_INTRO)} in your reply, ${esc(voter.name)}, so nothing has changed.`)
        + p('Reply with just the numbers, like: <strong>1, 4, 7</strong>')
        + `<p style="margin:0;font-size:15px;line-height:1.7;color:${INK};">${listed.map(o => `<strong style="color:${ACCENT};">${o.n}</strong>&nbsp; ${esc(o.title)}`).join('<br>')}</p>`,
      ),
    };
  }
  const chosen = numbered.filter(o => picks.includes(o.id));
  const head = `${RECEIPT_INTRO}, ${voter.name}`;
  const change = (outOfMeals ? 'There are no more meals to suggest — that\'s every one. ' : '')
    + 'To change it, reply again with the numbers you want.';
  if (chosen.length === 0) {
    return {
      subject,
      text: [`${head} — no meals picked for the week of ${week}.`, '', change, '', '— Prep Day'].join('\n'),
      html: wrap(p(`${esc(head)} — no meals picked for the week of ${esc(week)}.`) + p(esc(change))),
    };
  }
  return {
    subject,
    text: [`${RECEIPT_INTRO} for the week of ${week}, ${voter.name}:`, '', ...chosen.map(o => `  ${o.n}. ${o.title}`), '', change, '', '— Prep Day'].join('\n'),
    html: wrap(
      p(`${esc(RECEIPT_INTRO)} for the week of ${esc(week)}, ${esc(voter.name)}:`)
      + `<p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">${chosen.map(o => `<strong style="color:${ACCENT};">${o.n}</strong>&nbsp; ${esc(o.title)}`).join('<br>')}</p>`
      + `<p style="margin:0;font-size:14px;color:${MUTED};">${esc(change)}</p>`,
    ),
  };
}

const PAGE_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#F8FAFB;color:${INK};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:17px;line-height:1.4}
main{max-width:520px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:24px;margin:0 0 4px}
.sub{margin:0 0 20px;color:#4A5B6E}
h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};margin:24px 0 8px}
.card{background:#fff;border:1px solid ${LINE};border-radius:10px;overflow:hidden}
label.row{display:flex;align-items:center;gap:12px;padding:14px;border-bottom:1px solid ${LINE};cursor:pointer}
.row:last-child{border-bottom:0}
label.row input{width:22px;height:22px;flex:none;accent-color:${ACCENT}}
.row.result{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid ${LINE}}
.row.none{color:${MUTED}}
.who{flex:none;font-size:13px;color:#2E7D4F;background:#E8F5ED;border-radius:999px;padding:2px 10px;white-space:nowrap}
button,.btn{display:block;width:100%;margin-top:24px;padding:14px;border:0;border-radius:8px;background:${ACCENT};color:#fff;font-size:17px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
.btn.quiet{background:transparent;color:${ACCENT};border:1px solid ${ACCENT};margin-top:12px}
.note{margin:16px 0 0;font-size:14px;color:${MUTED}}
.ok{background:#E8F5ED;color:#2E7D4F;border-radius:8px;padding:12px 14px;margin:0 0 4px;font-weight:600}
`;

function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow">'
    + `<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>`
    + `<body><main>${body}</main></body></html>`;
}

/**
 * The ballot. Ticked boxes are the voter's saved picks — or, the first time,
 * the meal whose link they tapped in the email.
 */
export function renderBallotPage({ uid, ballot, voter, pick }) {
  const saved = ballot.votes?.[voter.id]?.picks;
  const ticked = new Set(Array.isArray(saved) ? saved : []);
  const allowed = new Set(ballotOptions(ballot).map(o => o.id));
  if (pick && allowed.has(pick)) ticked.add(pick);
  const week = weekLabel(ballot.weekOf);
  let body = `<h1>Next week's meals</h1><p class="sub">${esc(voter.name)}, tick what you want on the shopping list for the week of ${esc(week)}.</p>`
    + '<form method="post" action="/api/meal-vote">'
    + `<input type="hidden" name="u" value="${esc(uid)}">`
    + `<input type="hidden" name="w" value="${esc(ballot.weekOf)}">`
    + `<input type="hidden" name="t" value="${esc(voter.token)}">`;
  for (const cat of SUGGEST_CATEGORIES) {
    const options = columnOptions(ballot, cat);
    if (options.length === 0) continue;
    body += `<h2>${esc(MEAL_VOTE_COLUMN_LABEL[cat])}</h2><div class="card">`
      + options.map(o => (
        `<label class="row"><input type="checkbox" name="pick" value="${esc(o.id)}"${ticked.has(o.id) ? ' checked' : ''}>`
        + `<span>${esc(o.title)}</span></label>`
      )).join('')
      + '</div>';
  }
  body += `<button type="submit">${saved ? 'Update my votes' : 'Save my votes'}</button></form>`
    + (saved ? '<p class="note">These are the votes you saved earlier.</p>' : '<p class="note">Nothing is counted until you press Save.</p>');
  return page(`Meal vote — week of ${week}`, body);
}

/** After saving: everyone's votes so far, and a way back to change yours. */
export function renderResultPage({ uid, ballot, voter }) {
  const week = weekLabel(ballot.weekOf);
  const tally = tallyBallot(ballot);
  const waiting = tally.voters.filter(v => !v.voted).map(v => v.name);
  let body = `<p class="ok">Saved — thanks, ${esc(voter.name)}.</p>`
    + `<h1>Votes so far</h1><p class="sub">Week of ${esc(week)}${waiting.length ? ` · still waiting on ${esc(waiting.join(', '))}` : ' · everyone has voted'}</p>`;
  for (const cat of SUGGEST_CATEGORIES) {
    const rows = tally.columns[cat] || [];
    if (rows.length === 0) continue;
    body += `<h2>${esc(MEAL_VOTE_COLUMN_LABEL[cat])}</h2><div class="card">`
      + rows.map(r => (
        `<div class="row result${r.voters.length ? '' : ' none'}"><span>${esc(r.title)}</span>`
        + (r.voters.length ? `<span class="who">${esc(r.voters.join(' + '))}</span>` : '')
        + '</div>'
      )).join('')
      + '</div>';
  }
  const back = voteUrl('', { uid, weekOf: ballot.weekOf, token: voter.token });
  body += `<a class="btn quiet" href="${esc(back)}">Change my votes</a>`;
  return page(`Meal vote — week of ${week}`, body);
}

export function renderMessagePage(title, message) {
  return page(title, `<h1>${esc(title)}</h1><p class="sub">${esc(message)}</p>`);
}
