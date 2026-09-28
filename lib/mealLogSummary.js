// Meal-log summary email: one user's logged meals over a date range, with the
// macros for each meal and a total per day. Sent by the owner from the Admin
// Dashboard (api/send-meal-log-summary.js) — to a coach, a partner, the user.
//
// Pure: takes the user's dailyLog map ({ 'YYYY-MM-DD': { entries, ... } }) and
// returns data / { subject, html, text }. Tested by src/utils/mealLogSummary.test.js.

import { escapeHtml } from './mealReminderEmail.js';

export const MAX_RANGE_DAYS = 31;
const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ACCENT = '#c96442';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parts(key) { return String(key).split('-').map(Number); }
function utc(key) { const [y, m, d] = parts(key); return new Date(Date.UTC(y, m - 1, d)); }
function keyOf(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Every date key from start to end inclusive, or null if the range is bad. */
export function rangeDays(start, end) {
  if (!DATE_RE.test(String(start)) || !DATE_RE.test(String(end)) || start > end) return null;
  const out = [];
  for (let dt = utc(start); keyOf(dt) <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
    out.push(keyOf(dt));
    if (out.length > MAX_RANGE_DAYS) return null;
  }
  return out;
}

export function dayLabel(key) {
  const dt = utc(key);
  return `${DOW[dt.getUTCDay()]}, ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

export function rangeLabel(start, end) {
  const [ys, ms, ds] = parts(start);
  const [ye, me, de] = parts(end);
  if (start === end) return `${MONTHS[ms - 1]} ${ds}, ${ys}`;
  if (ys !== ye) return `${MONTHS[ms - 1]} ${ds}, ${ys} – ${MONTHS[me - 1]} ${de}, ${ye}`;
  if (ms !== me) return `${MONTHS[ms - 1]} ${ds} – ${MONTHS[me - 1]} ${de}, ${ye}`;
  return `${MONTHS[ms - 1]} ${ds}–${de}, ${ye}`;
}

// Same slot rule the rest of the app uses: a custom entry with no slot, or any
// unknown slot, is a snack.
function slotOf(e) {
  return SLOT_ORDER.includes(e?.mealSlot) ? e.mealSlot : 'snack';
}

// Recipes / custom meals carry recipeName; single foods carry ingredientName
// plus the amount eaten ("Greek yogurt — 170 g").
function entryName(e) {
  let name = String(e?.recipeName || e?.ingredientName || e?.name || '').trim() || 'Unnamed meal';
  const brand = String(e?.brand || '').trim();
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) name = `${name} (${brand})`;
  if (!e?.recipeName && e?.ingredientName && Number(e.quantity) > 0) {
    name = `${name} — ${Math.round(Number(e.quantity) * 100) / 100}${e.measurement ? ` ${e.measurement}` : ''}`;
  }
  return name;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * Per-day meals and totals. `nutrition: null` on a meal (or `totals: null` on a
 * day) means nothing was estimated — unknown, not zero, so it stays blank
 * rather than dragging the averages down.
 */
export function summarizeMealLog(dailyLog, days) {
  const log = dailyLog && typeof dailyLog === 'object' ? dailyLog : {};
  const out = [];
  const sum = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  let macroDays = 0;
  let mealCount = 0;

  for (const key of days) {
    const day = log[key] || {};
    const skipped = new Set(Array.isArray(day.skippedMeals) ? day.skippedMeals : []);
    const eatOutMarks = new Set(Array.isArray(day.eatingOutMeals) ? day.eatingOutMeals : []);
    const entries = Array.isArray(day.entries) ? day.entries : [];
    const meals = entries
      .filter(e => e && !skipped.has(slotOf(e)))
      .map(e => {
        const servings = num(e.servings);
        return {
          slot: slotOf(e),
          name: entryName(e),
          servings: servings > 0 && Math.abs(servings - 1) > 1e-6 ? Math.round(servings * 100) / 100 : null,
          eatingOut: !!e.eatingOut,
          estimated: !!e.estimated,
          nutrition: e.nutrition && typeof e.nutrition === 'object'
            ? Object.fromEntries(MACRO_KEYS.map(k => [k, num(e.nutrition[k])]))
            : null,
        };
      })
      .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

    // Slots marked "ate out" with nothing logged in them still say something.
    const notes = [];
    if (day.daySkipped) notes.push('Day marked as not tracked');
    for (const s of SLOT_ORDER) {
      if (skipped.has(s)) notes.push(`${SLOT_LABEL[s]} skipped`);
      else if (eatOutMarks.has(s) && !meals.some(m => m.slot === s)) notes.push(`${SLOT_LABEL[s]}: ate out (not logged)`);
    }

    let totals = null;
    if (!day.daySkipped) {
      for (const m of meals) {
        if (!m.nutrition) continue;
        totals = totals || { calories: 0, protein: 0, carbs: 0, fat: 0 };
        for (const k of MACRO_KEYS) totals[k] += m.nutrition[k];
      }
    }
    if (totals) {
      macroDays += 1;
      for (const k of MACRO_KEYS) sum[k] += totals[k];
    }
    mealCount += meals.length;
    out.push({ date: key, label: dayLabel(key), meals, notes, totals });
  }

  const avg = macroDays > 0 ? Object.fromEntries(MACRO_KEYS.map(k => [k, sum[k] / macroDays])) : null;
  return { days: out, mealCount, macroDays, avg };
}

const r = n => Math.round(n).toLocaleString('en-US');
function goalOf(goals, k) { const n = Number(goals?.[k]); return Number.isFinite(n) && n > 0 ? n : null; }

const TH = 'padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;';
const TD = 'padding:6px 8px;text-align:right;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;white-space:nowrap;';
const TDL = 'padding:6px 8px;text-align:left;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;';

function macroCells(n, style) {
  return MACRO_KEYS.map(k => `<td style="${style}">${n ? `${r(n[k])}${k === 'calories' ? '' : 'g'}` : '—'}</td>`).join('');
}

function dayHtml(d, goals) {
  const header = `<tr><th style="${TH}text-align:left;">Meal</th><th style="${TH}">Cal</th><th style="${TH}">Protein</th><th style="${TH}">Carbs</th><th style="${TH}">Fat</th></tr>`;
  const rows = d.meals.map(m => {
    const tags = [
      m.servings ? `${m.servings}× serving` : '',
      m.eatingOut ? 'ate out' : '',
      m.estimated ? 'estimate' : '',
    ].filter(Boolean).join(' · ');
    return `<tr><td style="${TDL}"><span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.03em;">${SLOT_LABEL[m.slot]}</span><br>${escapeHtml(m.name)}${tags ? `<br><span style="color:#9ca3af;font-size:11px;">${escapeHtml(tags)}</span>` : ''}</td>${macroCells(m.nutrition, TD)}</tr>`;
  }).join('');
  const bold = `${TD}font-weight:700;border-bottom:none;`;
  const total = d.totals ? `<tr><td style="${TDL}font-weight:700;border-bottom:none;">Day total</td>${macroCells(d.totals, bold)}</tr>` : '';
  const goalRow = d.totals && MACRO_KEYS.some(k => goalOf(goals, k))
    ? `<tr><td style="${TDL}color:#6b7280;font-size:12px;border-bottom:none;">Goal</td>${MACRO_KEYS.map(k => {
      const g = goalOf(goals, k);
      if (!g) return `<td style="${TD}color:#9ca3af;border-bottom:none;">—</td>`;
      const pct = Math.round((d.totals[k] / g) * 100);
      return `<td style="${TD}color:#6b7280;font-size:12px;border-bottom:none;">${r(g)}${k === 'calories' ? '' : 'g'}<br><span style="color:${pct >= 90 && pct <= 110 ? '#16a34a' : '#6b7280'};">${pct}%</span></td>`;
    }).join('')}</tr>`
    : '';
  const notes = d.notes.length ? `<div style="font-size:12px;color:#6b7280;margin:4px 0 0;">${escapeHtml(d.notes.join(' · '))}</div>` : '';
  const body = d.meals.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${header}${rows}${total}${goalRow}</table>`
    : '<div style="font-size:13px;color:#9ca3af;">Nothing logged.</div>';
  return `<div style="margin:0 0 20px;"><div style="font-size:15px;font-weight:700;color:#111827;margin:0 0 6px;border-bottom:2px solid ${ACCENT};padding-bottom:4px;">${escapeHtml(d.label)}</div>${body}${notes}</div>`;
}

function dayText(d) {
  const lines = [d.label.toUpperCase()];
  if (!d.meals.length) lines.push('  Nothing logged.');
  for (const m of d.meals) {
    const n = m.nutrition;
    const extra = [m.servings ? `${m.servings}x` : '', m.eatingOut ? 'ate out' : ''].filter(Boolean).join(', ');
    lines.push(`  ${SLOT_LABEL[m.slot]}: ${m.name}${extra ? ` (${extra})` : ''} — ${n ? `${r(n.calories)} cal, ${r(n.protein)}g P, ${r(n.carbs)}g C, ${r(n.fat)}g F` : 'no nutrition'}`);
  }
  if (d.totals) lines.push(`  Total: ${r(d.totals.calories)} cal, ${r(d.totals.protein)}g P, ${r(d.totals.carbs)}g C, ${r(d.totals.fat)}g F`);
  for (const note of d.notes) lines.push(`  ${note}`);
  return lines.join('\n');
}

/**
 * @param {object} opts
 * @param {string} opts.name     whose log this is (display name or email)
 * @param {string} opts.start    YYYY-MM-DD
 * @param {string} opts.end      YYYY-MM-DD
 * @param {object} opts.summary  summarizeMealLog() result
 * @param {object} [opts.goals]  nutritionGoals (daily calories/protein/carbs/fat)
 */
export function renderMealLogEmail({ name, start, end, summary, goals }) {
  const who = String(name || '').trim() || 'Prep Day user';
  const range = rangeLabel(start, end);
  const subject = `${who}'s meal log — ${range}`;
  const avg = summary.avg;
  const avgHtml = avg
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 20px;background:#faf7f5;border-radius:8px;">
<tr><th style="${TH}text-align:left;">Daily average<br><span style="font-weight:400;">${summary.macroDays} day${summary.macroDays === 1 ? '' : 's'} with nutrition</span></th><th style="${TH}">Cal</th><th style="${TH}">Protein</th><th style="${TH}">Carbs</th><th style="${TH}">Fat</th></tr>
<tr><td style="${TDL}border-bottom:none;">Average</td>${macroCells(avg, `${TD}font-weight:700;border-bottom:none;`)}</tr>
${MACRO_KEYS.some(k => goalOf(goals, k)) ? `<tr><td style="${TDL}color:#6b7280;font-size:12px;border-bottom:none;">Goal</td>${MACRO_KEYS.map(k => `<td style="${TD}color:#6b7280;font-size:12px;border-bottom:none;">${goalOf(goals, k) ? `${r(goalOf(goals, k))}${k === 'calories' ? '' : 'g'}` : '—'}</td>`).join('')}</tr>` : ''}
</table>`
    : '';
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111827;">
<div style="font-size:20px;font-weight:800;margin:0 0 2px;">${escapeHtml(who)}'s meal log</div>
<div style="font-size:13px;color:#6b7280;margin:0 0 16px;">${escapeHtml(range)} · ${summary.mealCount} meal${summary.mealCount === 1 ? '' : 's'} logged</div>
${avgHtml}
${summary.days.map(d => dayHtml(d, goals)).join('\n')}
<div style="font-size:11px;color:#9ca3af;margin-top:24px;">Nutrition is as logged in Prep Day; entries marked "estimate" were estimated rather than weighed. Sent from <a href="https://prep-day.com" style="color:${ACCENT};">Prep Day</a>.</div>
</div>`;
  const textParts = [`${who}'s meal log — ${range}`, `${summary.mealCount} meals logged`];
  if (avg) textParts.push(`Daily average (${summary.macroDays} days with nutrition): ${r(avg.calories)} cal, ${r(avg.protein)}g P, ${r(avg.carbs)}g C, ${r(avg.fat)}g F`);
  const text = [...textParts, '', ...summary.days.map(dayText).join('\n\n').split('\n')].join('\n');
  return { subject, html, text };
}
