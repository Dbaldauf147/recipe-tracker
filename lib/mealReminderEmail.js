// Shared rendering for the meal-log reminder email body.
// Used by api/send-meal-prompt.js (the hourly cron) and the
// scripts/send-sample-meal-reminder.mjs preview script.

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Desserts, Snacks & Drinks',
};

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shiftDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function dayParts(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDate();
  return {
    weekday: DAY_ABBR[dt.getUTCDay()],
    dayNum,
    ord: ordinalSuffix(dayNum),
  };
}

function entryDisplayName(entry) {
  if (entry?.type === 'custom_meal' || entry?.type === 'recipe') return entry.recipeName || '(unnamed)';
  return entry?.ingredientName || '(unnamed)';
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slotForEntry(entry) {
  if (entry?.type === 'custom' && !entry?.mealSlot) return 'snack';
  return MEAL_SLOTS.includes(entry?.mealSlot) ? entry.mealSlot : 'snack';
}

function aggregateMacros(entries, daySkipped) {
  if (daySkipped) return null;
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  let any = false;
  for (const e of entries) {
    if (!e?.nutrition) continue;
    any = true;
    totals.calories += e.nutrition.calories || 0;
    totals.protein += e.nutrition.protein || 0;
    totals.carbs += e.nutrition.carbs || 0;
    totals.fat += e.nutrition.fat || 0;
  }
  return any ? totals : null;
}

function pctOfGoal(value, goal) {
  if (!goal || goal <= 0) return null;
  return Math.round((value / goal) * 100);
}

// Renders the same 7-day grid the Prepare — Next 7 Days view shows on the
// website: day-headers across the top, four meal-slot rows
// (Breakfast / Lunch / Dinner / Desserts, Snacks & Drinks), plus a Daily
// macros row beneath. Returns { text, html }.
export function renderPrepareWeek(log, startDateKey, goals = null) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const key = shiftDateKey(startDateKey, i);
    const day = log[key] || {};
    const entries = Array.isArray(day.entries) ? day.entries : [];
    const skippedMeals = Array.isArray(day.skippedMeals) ? day.skippedMeals : [];
    const daySkipped = !!day.daySkipped;

    const bySlot = {};
    for (const slot of MEAL_SLOTS) bySlot[slot] = [];
    for (const e of entries) bySlot[slotForEntry(e)].push(e);

    days.push({
      key,
      header: dayParts(key),
      entries,
      skippedMeals,
      daySkipped,
      bySlot,
      macros: aggregateMacros(entries, daySkipped),
    });
  }

  // ── HTML table ────────────────────────────────────────────────
  const cellBase = 'border:1px solid #e5e7eb;padding:6px 8px;vertical-align:top;font-size:12px;line-height:1.35;';
  const headerCell = 'background:#f3f4f6;color:#111827;font-weight:600;text-align:center;';
  const slotLabelCell = 'background:#f9fafb;color:#374151;font-weight:600;text-align:left;white-space:nowrap;';
  const dayHeaderHtml = days.map(d =>
    `<th style="${cellBase}${headerCell}">${escapeHtml(d.header.weekday)}<br/><span style="font-weight:700;font-size:13px;">${d.header.dayNum}<sup style="font-size:9px;font-weight:500;">${escapeHtml(d.header.ord)}</sup></span></th>`
  ).join('');

  function slotRowHtml(slot) {
    const cells = days.map(d => {
      if (d.daySkipped) return `<td style="${cellBase}color:#9ca3af;font-style:italic;text-align:center;">—</td>`;
      const isSkipped = d.skippedMeals.includes(slot);
      if (isSkipped) return `<td style="${cellBase}color:#9ca3af;font-style:italic;text-align:center;">skipped</td>`;
      const items = d.bySlot[slot];
      if (!items || items.length === 0) return `<td style="${cellBase}">&nbsp;</td>`;
      const inner = items.map(e => `<div>${escapeHtml(entryDisplayName(e))}</div>`).join('');
      return `<td style="${cellBase}color:#111827;">${inner}</td>`;
    }).join('');
    return `<tr><th style="${cellBase}${slotLabelCell}">${escapeHtml(MEAL_LABELS[slot])}</th>${cells}</tr>`;
  }

  function macrosRowHtml() {
    const cells = days.map(d => {
      if (!d.macros) return `<td style="${cellBase}color:#9ca3af;text-align:center;">—</td>`;
      const m = d.macros;
      const pctStr = (val, goalKey) => {
        const p = goals ? pctOfGoal(val, goals[goalKey]) : null;
        return p == null ? '' : ` <span style="color:#6b7280;">(${p}%)</span>`;
      };
      return `<td style="${cellBase}color:#111827;font-size:11px;text-align:center;">`
        + `<div>Cal <strong>${Math.round(m.calories)}</strong>${pctStr(m.calories, 'calories')}</div>`
        + `<div>P <strong>${Math.round(m.protein)}g</strong>${pctStr(m.protein, 'protein')}</div>`
        + `<div>C <strong>${Math.round(m.carbs)}g</strong>${pctStr(m.carbs, 'carbs')}</div>`
        + `<div>F <strong>${Math.round(m.fat)}g</strong>${pctStr(m.fat, 'fat')}</div>`
        + `</td>`;
    }).join('');
    return `<tr><th style="${cellBase}${slotLabelCell}">Daily macros</th>${cells}</tr>`;
  }

  const html = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;margin-top:8px;table-layout:fixed;">`
    + `<thead><tr><th style="${cellBase}${headerCell}background:#fff;border:none;">&nbsp;</th>${dayHeaderHtml}</tr></thead>`
    + `<tbody>`
    + MEAL_SLOTS.map(slotRowHtml).join('')
    + macrosRowHtml()
    + `</tbody></table>`;

  // ── Plain text fallback ──────────────────────────────────────
  const textParts = [];
  for (const d of days) {
    textParts.push(`${d.header.weekday} ${d.header.dayNum}${d.header.ord}`);
    if (d.daySkipped) {
      textParts.push('  Day skipped');
      textParts.push('');
      continue;
    }
    let printedAny = false;
    for (const slot of MEAL_SLOTS) {
      const items = d.bySlot[slot];
      const isSkipped = d.skippedMeals.includes(slot);
      if (items.length === 0 && !isSkipped) continue;
      printedAny = true;
      if (isSkipped) {
        textParts.push(`  ${MEAL_LABELS[slot]}: skipped`);
      } else {
        const names = items.map(entryDisplayName).join(', ');
        textParts.push(`  ${MEAL_LABELS[slot]}: ${names}`);
      }
    }
    if (!printedAny) textParts.push('  (nothing planned)');
    if (d.macros) {
      const m = d.macros;
      const pp = (val, key) => {
        const p = goals ? pctOfGoal(val, goals[key]) : null;
        return p == null ? '' : ` (${p}%)`;
      };
      textParts.push(
        `  Macros: ${Math.round(m.calories)} cal${pp(m.calories, 'calories')}`
        + ` / ${Math.round(m.protein)}p${pp(m.protein, 'protein')}`
        + ` / ${Math.round(m.carbs)}c${pp(m.carbs, 'carbs')}`
        + ` / ${Math.round(m.fat)}f${pp(m.fat, 'fat')}`
      );
    }
    textParts.push('');
  }

  return { text: textParts.join('\n'), html };
}

function goalsSummary(goals) {
  if (!goals) return null;
  const parts = [];
  if (goals.calories) parts.push(`${Math.round(goals.calories)} cal`);
  if (goals.protein) parts.push(`${Math.round(goals.protein)}g protein`);
  if (goals.carbs) parts.push(`${Math.round(goals.carbs)}g carbs`);
  if (goals.fat) parts.push(`${Math.round(goals.fat)}g fat`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function renderMealReminder({ remaining, log, dateKey, goals = null }) {
  // Show today + the next 6 days, matching the Prepare — Next 7 Days view.
  const week = renderPrepareWeek(log, dateKey, goals);
  const intro = `You have ${remaining} meal${remaining > 1 ? 's' : ''} left to log today.`;
  const planHeader = 'Prepare — Next 7 Days';
  const subHeader = 'Pick what you’re cooking each day — meals fill forward from that day.';
  const goalsLine = goalsSummary(goals);
  const goalsHeader = goalsLine ? 'Your daily goals' : null;
  const footer = 'Log now: https://prep-day.com';

  const textBlocks = [intro, ''];
  if (goalsLine) textBlocks.push(goalsHeader, goalsLine, '');
  textBlocks.push(planHeader, subHeader, '', week.text, footer, '', '— Prep Day');
  const text = textBlocks.join('\n');

  const goalsHtml = goalsLine
    ? `<h2 style="font-size:16px;font-weight:600;margin:18px 0 4px 0;color:#111827;">${escapeHtml(goalsHeader)}</h2>`
      + `<p style="font-size:13px;color:#374151;margin:0 0 4px 0;">${escapeHtml(goalsLine)}</p>`
      + `<p style="font-size:12px;color:#9ca3af;margin:0 0 8px 0;">Percentages below show each day’s totals vs. these goals.</p>`
    : '';

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:720px;">`
    + `<p style="font-size:15px;margin:0 0 12px 0;">${escapeHtml(intro)}</p>`
    + goalsHtml
    + `<h2 style="font-size:16px;font-weight:600;margin:18px 0 4px 0;color:#111827;">${escapeHtml(planHeader)}</h2>`
    + `<p style="font-size:13px;color:#6b7280;margin:0 0 8px 0;">${escapeHtml(subHeader)}</p>`
    + week.html
    + `<p style="margin:20px 0 0 0;"><a href="https://prep-day.com" style="background:#c96442;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;display:inline-block;">Open Prep Day</a></p>`
    + `<p style="color:#9ca3af;font-size:12px;margin-top:24px;">— Prep Day</p>`
    + `</div>`;
  return { subject: 'Prep Day — log your meals', text, html };
}
