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
  MEAL_VOTE_COLUMN_LABEL, ballotOptions, tallyBallot, weekLabel,
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

/**
 * The email for one voter: { subject, text, html }.
 *
 * The meals are numbered 1–10 straight down both columns, and the vote is a
 * reply with the numbers — nothing to open. The ballot page stays as a single
 * link at the bottom for anyone who would rather tick boxes.
 */
export function renderMealVoteEmail({ base, uid, ballot, voter }) {
  const week = weekLabel(ballot.weekOf);
  const link = voteUrl(base, { uid, weekOf: ballot.weekOf, token: voter.token });
  const subject = `Vote on next week's meals — week of ${week}`;
  const total = ballotOptions(ballot).length;
  // Three numbers that are really on this ballot, spread across it.
  const example = [...new Set([1, Math.ceil(total / 2), total])].join(', ');
  const ask = `${BALLOT_INTRO} of the meals you want on the shopping list for the week of ${week}`;

  const textLines = [`Hi ${voter.name},`, '', `${ask} — for example: ${example}`, ''];
  // Three columns beside the number: the meal, whether Joanne likes it, and
  // why Suggested Meals is offering it this week.
  const JOANNE = {
    yes: { label: 'Likes it', color: '#2E7D4F', text: 'Joanne likes it' },
    no: { label: 'Not a fan', color: '#B4532A', text: 'Joanne isn\'t a fan' },
  };
  const cell = `padding:11px 10px 11px 0;border-bottom:1px solid ${LINE};vertical-align:top;`;
  const head = `padding:0 10px 6px 0;border-bottom:1px solid ${LINE};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};text-align:left;font-weight:600;`;
  let cols = '';
  let n = 0;
  for (const cat of SUGGEST_CATEGORIES) {
    const options = ballot.options?.[cat] || [];
    if (options.length === 0) continue;
    textLines.push(`${MEAL_VOTE_COLUMN_LABEL[cat]}:`);
    cols += `<h2 style="margin:22px 0 8px 0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${esc(MEAL_VOTE_COLUMN_LABEL[cat])}</h2>`
      + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">'
      + `<tr><th style="${head}width:30px;">#</th><th style="${head}">Meal</th><th style="${head}width:90px;">Joanne</th><th style="${head}width:48%;padding-right:0;">Why it's suggested</th></tr>`;
    for (const o of options) {
      n++;
      const j = JOANNE[o.joanne];
      textLines.push(`  ${n}. ${o.title}${j ? ` — ${j.text}` : ''}${o.why ? ` — ${o.why}` : ''}`);
      cols += `<tr><td style="${cell}font-size:17px;font-weight:700;color:${ACCENT};">${n}</td>`
        + `<td style="${cell}font-size:16px;color:${INK};">${esc(o.title)}</td>`
        + `<td style="${cell}font-size:13px;line-height:1.5;white-space:nowrap;color:${j ? j.color : MUTED};${j ? 'font-weight:600;' : ''}">${j ? esc(j.label) : '—'}</td>`
        + `<td style="${cell}padding-right:0;font-size:13px;line-height:1.5;color:#4A5B6E;">${o.why ? esc(o.why) : '—'}</td></tr>`;
    }
    textLines.push('');
    cols += '</table>';
  }
  textLines.push(
    'Reply again any time to change your votes — the latest reply counts. Reply "none" to pass.',
    '', `Rather tick boxes? ${link}`, '', '— Prep Day',
  );

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${INK};max-width:900px;">`
    + `<p style="margin:0 0 4px 0;font-size:16px;">Hi ${esc(voter.name)},</p>`
    + `<p style="margin:0;font-size:16px;line-height:1.45;"><strong>${esc(BALLOT_INTRO)}</strong> of the meals you want on the shopping list for the week of <strong>${esc(week)}</strong> — for example: <strong>${esc(example)}</strong></p>`
    + cols
    + `<p style="margin:20px 0 0 0;font-size:14px;line-height:1.45;color:${MUTED};">Reply again any time to change your votes — the latest reply counts. Reply “none” to pass.</p>`
    + `<p style="margin:10px 0 0 0;font-size:14px;color:${MUTED};">Rather tick boxes? <a href="${esc(link)}" style="color:${ACCENT};">Open the ballot</a>.</p>`
    + '</div>';

  return { subject, text: textLines.join('\n'), html };
}

/**
 * The answer to a reply: what was counted, or — when no meal could be found
 * in it — how to say it. { subject, text, html }, sent back into the thread.
 */
export function renderVoteReceipt({ ballot, voter, picks, understood }) {
  const week = weekLabel(ballot.weekOf);
  const subject = `Re: Vote on next week's meals — week of ${week}`;
  const options = ballotOptions(ballot);
  const numbered = options.map((o, i) => ({ ...o, n: i + 1 }));
  const p = (t) => `<p style="margin:0 0 10px 0;font-size:16px;line-height:1.45;">${t}</p>`;
  const wrap = (inner) => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${INK};max-width:520px;">${inner}</div>`;

  if (!understood) {
    const lines = numbered.map(o => `  ${o.n}. ${o.title}`);
    return {
      subject,
      text: [`${RETRY_INTRO} in your reply, ${voter.name}, so nothing has changed.`, '',
        'Reply with just the numbers, like: 1, 4, 7', '', ...lines, '', '— Prep Day'].join('\n'),
      html: wrap(
        p(`${esc(RETRY_INTRO)} in your reply, ${esc(voter.name)}, so nothing has changed.`)
        + p('Reply with just the numbers, like: <strong>1, 4, 7</strong>')
        + `<p style="margin:0;font-size:15px;line-height:1.7;color:${INK};">${numbered.map(o => `<strong style="color:${ACCENT};">${o.n}</strong>&nbsp; ${esc(o.title)}`).join('<br>')}</p>`,
      ),
    };
  }
  const chosen = numbered.filter(o => picks.includes(o.id));
  const head = `${RECEIPT_INTRO}, ${voter.name}`;
  const change = 'To change it, reply again with the numbers you want.';
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
    const options = ballot.options?.[cat] || [];
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
