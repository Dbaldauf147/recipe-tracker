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
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shiftDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDayHeader(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAY_ABBR[dt.getUTCDay()]} ${MONTH_ABBR[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
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

// Returns { text, html } for the next 4 days starting at startDateKey,
// shaped like the Daily Tracker page: per-day section, meal-slot
// headers, entry names under each. Skipped days/slots are noted.
export function renderPlannedDays(log, startDateKey) {
  const days = [];
  for (let i = 0; i < 4; i++) {
    const key = shiftDateKey(startDateKey, i);
    const day = log[key] || {};
    const entries = Array.isArray(day.entries) ? day.entries : [];
    const skippedMeals = Array.isArray(day.skippedMeals) ? day.skippedMeals : [];
    const daySkipped = !!day.daySkipped;
    days.push({ key, entries, skippedMeals, daySkipped });
  }

  const textParts = [];
  const htmlParts = [];

  for (const d of days) {
    const header = formatDayHeader(d.key);
    textParts.push(header);
    htmlParts.push(`<div style="margin-top:18px;"><div style="font-weight:600;font-size:15px;color:#111827;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:6px;">${escapeHtml(header)}</div>`);

    if (d.daySkipped) {
      textParts.push('  Day skipped', '');
      htmlParts.push('<div style="color:#9ca3af;font-style:italic;padding-left:8px;">Day skipped</div></div>');
      continue;
    }

    const grouped = {};
    for (const slot of MEAL_SLOTS) grouped[slot] = [];
    for (const entry of d.entries) {
      const slot = entry?.type === 'custom' && !entry?.mealSlot
        ? 'snack'
        : (MEAL_SLOTS.includes(entry?.mealSlot) ? entry.mealSlot : 'snack');
      grouped[slot].push(entry);
    }

    let printedAny = false;
    for (const slot of MEAL_SLOTS) {
      const items = grouped[slot];
      const isSkipped = d.skippedMeals.includes(slot);
      if (items.length === 0 && !isSkipped) continue;
      printedAny = true;
      const label = MEAL_LABELS[slot];
      textParts.push(`  ${label}${isSkipped ? ' (skipped)' : ''}`);
      htmlParts.push(`<div style="margin-top:8px;padding-left:8px;"><div style="font-weight:600;font-size:13px;color:#374151;">${escapeHtml(label)}${isSkipped ? ' <span style="color:#9ca3af;font-weight:400;">(skipped)</span>' : ''}</div>`);
      if (!isSkipped) {
        for (const entry of items) {
          const name = entryDisplayName(entry);
          textParts.push(`    • ${name}`);
          htmlParts.push(`<div style="padding-left:12px;color:#111827;font-size:13px;">• ${escapeHtml(name)}</div>`);
        }
      }
      htmlParts.push('</div>');
    }

    if (!printedAny) {
      textParts.push('  (nothing planned)');
      htmlParts.push('<div style="color:#9ca3af;font-style:italic;padding-left:8px;">Nothing planned</div>');
    }
    textParts.push('');
    htmlParts.push('</div>');
  }

  return {
    text: textParts.join('\n'),
    html: htmlParts.join(''),
  };
}

export function renderMealReminder({ remaining, log, dateKey }) {
  const tomorrow = shiftDateKey(dateKey, 1);
  const planned = renderPlannedDays(log, tomorrow);
  const intro = `You have ${remaining} meal${remaining > 1 ? 's' : ''} left to log today.`;
  const planHeader = "Here's what you have planned for the next 4 days:";
  const footer = 'Log now: https://prep-day.com';
  const text = [intro, '', planHeader, '', planned.text, footer, '', '— Prep Day'].join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:560px;">`
    + `<p style="font-size:15px;margin:0 0 12px 0;">${escapeHtml(intro)}</p>`
    + `<p style="font-size:14px;color:#374151;margin:0 0 4px 0;">${escapeHtml(planHeader)}</p>`
    + planned.html
    + `<p style="margin:20px 0 0 0;"><a href="https://prep-day.com" style="background:#c96442;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;display:inline-block;">Open Prep Day</a></p>`
    + `<p style="color:#9ca3af;font-size:12px;margin-top:24px;">— Prep Day</p>`
    + `</div>`;
  return { subject: 'Prep Day — log your meals', text, html };
}
