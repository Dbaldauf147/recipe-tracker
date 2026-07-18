import { useEffect, useMemo, useState } from 'react';
import { saveField, loadField, loadHabitAutoStatus } from '../utils/firestoreSync';
import { HABIT_FIELDS, seedHabits, makeHabitId } from '../data/habitsSeed';

// Personal habit tracker (Atomic Habits: Cue → Craving → Response → Reward).
// Gated to baldaufdan@gmail.com in App.jsx. Data lives on the user doc under
// `habits`. Four sub-tabs: KPI (stats), Routines (grouped), Daily Routine
// (ordered daily checklist), Habits (the full editable table + paste import).

const SUB_TABS = [
  { id: 'kpi', label: 'KPI' },
  { id: 'routines', label: 'Routines' },
  { id: 'automatic', label: 'Automatic' },
  { id: 'autoreview', label: 'Auto Review' },
  { id: 'history', label: 'History' },
  { id: 'onhold', label: 'On Hold' },
  { id: 'habits', label: 'Habits' },
];
// "On Hold" habits are paused — hidden from the Routines/Daily lists and parked
// in their own tab, so they don't clutter the active routines.
const ON_HOLD_STATUS = 'On Hold';
// Statuses hidden from the Routines + Daily Routine lists. On Hold has its own
// tab; Abandoned is managed in the main Habits table. Mirrors the mobile app.
const PARKED_STATUSES = [ON_HOLD_STATUS, 'Abandoned'];

const DAILY_ROUTINES = ['Morning', 'Lunch', 'Afternoon', 'After Work', 'Bedtime'];
const STATUS_OPTIONS = ['Automatically', 'Most Days', 'Some Days', 'Rarely', 'On Hold', 'Not Started', 'Abandoned'];
// Tracking cadence chosen per-habit in the habit popup. Stored on the habit as
// `cadence` (NOT part of HABIT_FIELDS, so the paste-from-sheet column mapping
// stays aligned to the spreadsheet).
const CADENCE_OPTIONS = ['Daily', 'Weekly', 'Monthly', 'Annually'];
// Section order for the Routines tab, which groups by cadence/frequency.
const CADENCE_RANK = { Daily: 0, Weekly: 1, Monthly: 2, Annually: 3 };
const ACCENT = '#3B6B9C';

function routineType(routine) {
  const r = (routine || '').trim();
  if (DAILY_ROUTINES.includes(r)) return 'daily';
  if (/^sunday/i.test(r)) return 'weekly';
  if (/^monthly/i.test(r)) return 'monthly';
  if (!r || r === '-') return 'unsorted';
  return 'other';
}

// Parse a KPI cell to a 0-100 completion % when it looks like one.
function pctOf(kpi) {
  const s = String(kpi || '').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (m) return parseFloat(m[1]);
  return null;
}

// Default table sort: routine type (daily → weekly → monthly → other →
// unsorted), then daily block order / trailing routine number, then Daily #.
function routineRank(routine) {
  const r = (routine || '').trim();
  const typeOrder = { daily: 0, weekly: 1, monthly: 2, other: 3, unsorted: 4 }[routineType(r)];
  const dailyIdx = DAILY_ROUTINES.indexOf(r);
  const numMatch = r.match(/(\d+)\s*$/);
  return { typeOrder, dailyIdx: dailyIdx < 0 ? 50 : dailyIdx, num: numMatch ? parseInt(numMatch[1], 10) : 9999 };
}
// Manual drag-order within a routine group. Missing → Infinity so unordered
// habits sink below explicitly-ordered ones. Shared with the mobile app.
function habitOrderNum(h) {
  const n = parseFloat(h?.order);
  return Number.isFinite(n) ? n : Infinity;
}
function compareByRoutine(a, b) {
  const ra = routineRank(a.routine), rb = routineRank(b.routine);
  if (ra.typeOrder !== rb.typeOrder) return ra.typeOrder - rb.typeOrder;
  if (ra.dailyIdx !== rb.dailyIdx) return ra.dailyIdx - rb.dailyIdx;
  if (ra.num !== rb.num) return ra.num - rb.num;
  // Same routine group: manual drag order wins, then legacy Daily #, then name.
  const oa = habitOrderNum(a), ob = habitOrderNum(b);
  if (oa !== ob) return oa - ob;
  const da = parseInt(a.dailyOrder, 10), db = parseInt(b.dailyOrder, 10);
  if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
  return (a.name || '').localeCompare(b.name || '');
}

// Order daily habits: routine block order, then the numeric Daily Routine #.
function dailyOrderKey(h) {
  const block = DAILY_ROUTINES.indexOf((h.routine || '').trim());
  const n = parseInt(h.dailyOrder, 10);
  return [block < 0 ? 99 : block, Number.isFinite(n) ? n : 9999];
}

// ---- Per-cadence check-off logging --------------------------------------
// Stored on the user doc under `habitLog`, shared with the mobile app so the
// two stay in sync. Shape: habitLog[periodKey][habitId] = 'done'|'skipped'|
// 'missed'. The period key depends on the habit's cadence: a calendar day for
// Daily (YYYY-MM-DD), an ISO week for Weekly (YYYY-Www), a month for Monthly
// (YYYY-MM), or a year for Annually (YYYY). Keep this logic byte-identical to
// PrepDay/src/components/HabitsScreen.tsx.
const pad2 = (n) => String(n).padStart(2, '0');

function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ISO-8601 week key, e.g. "2026-W25" (week starts Monday).
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

// The local Sunday that STARTS the week containing d (Sun..Sat), matching the
// Sunday-anchored weeks the Week Plan uses.
function sundayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // getDay() 0=Sun
  return x;
}
// Sunday-anchored WEEK KEY for weekly habits. Keeps the "YYYY-Www" format (so all
// key parsing stays valid) but groups a Sunday→Saturday week into ONE key by
// taking the ISO week of the following day: every day Sun..Sat maps to the same
// key, and a Sunday weigh-in counts for the week it STARTS (not the ISO week it
// ends). This aligns weekly habits with the app's Sun–Sat weeks.
function weekKey(d) {
  return isoWeekKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
}

function cadenceCanon(c) {
  const x = (c || '').trim().toLowerCase();
  if (x === 'weekly') return 'Weekly';
  if (x === 'monthly') return 'Monthly';
  if (x === 'annually') return 'Annually';
  return 'Daily';
}

function periodKey(cadence, date = new Date()) {
  switch (cadenceCanon(cadence)) {
    case 'Weekly': return weekKey(date);
    case 'Monthly': return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    case 'Annually': return String(date.getFullYear());
    default: return dayKey(date);
  }
}

// A cell was auto-set by the automation engine iff habitLogAuto recorded the
// same mark the cell currently holds. If the mark was hand-changed or erased,
// the values diverge and the "(A)" badge disappears on its own.
function isAutoMark(habitLogAuto, key, habitId, currentMark) {
  return !!currentMark && habitLogAuto?.[key]?.[habitId] === currentMark;
}
// Small "(A)" badge shown next to an auto-logged mark.
function AutoBadge({ title = 'Automatically logged' }) {
  return (
    <span title={title} style={{ fontSize: '0.6rem', fontWeight: 800, color: '#2563eb', background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 4, padding: '0 3px', marginLeft: 3, verticalAlign: 'middle', lineHeight: 1.4 }}>A</span>
  );
}
// "(A)" badge shown next to a habit's *name* when the habit is tracked
// automatically (has an enabled automation rule targeting it). Distinct from
// AutoBadge, which marks an individual auto-logged cell.
function AutoNameBadge({ title = 'Tracked automatically' }) {
  return (
    <span title={title} style={{ fontSize: '0.58rem', fontWeight: 800, color: '#2563eb', background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 4, padding: '0 3px', marginLeft: 5, verticalAlign: 'middle', lineHeight: 1.4, flex: '0 0 auto' }}>A</span>
  );
}

function periodHint(cadence) {
  switch (cadenceCanon(cadence)) {
    case 'Weekly': return 'This week';
    case 'Monthly': return 'This month';
    case 'Annually': return 'This year';
    default: return 'Today';
  }
}

// The bare period noun for a cadence ('week' / 'month' / 'year' / 'day'), used in
// the routine-table column tooltips (e.g. "this week", "next month (upcoming)").
function periodNoun(cadence) {
  switch (cadenceCanon(cadence)) {
    case 'Weekly': return 'week';
    case 'Monthly': return 'month';
    case 'Annually': return 'year';
    default: return 'day';
  }
}

// The key for the period immediately before the current one (yesterday / last
// week / last month / last year, per cadence).
function prevPeriodKey(cadence, date = new Date()) {
  const d = new Date(date);
  switch (cadenceCanon(cadence)) {
    case 'Weekly': d.setDate(d.getDate() - 7); break;
    case 'Monthly': d.setMonth(d.getMonth() - 1); break;
    case 'Annually': d.setFullYear(d.getFullYear() - 1); break;
    default: d.setDate(d.getDate() - 1);
  }
  return periodKey(cadence, d);
}

function prevPeriodHint(cadence) {
  switch (cadenceCanon(cadence)) {
    case 'Weekly': return 'Last week';
    case 'Monthly': return 'Last month';
    case 'Annually': return 'Last year';
    default: return 'Yesterday';
  }
}

function periodStart(key) {
  if (/^\d{4}-W\d{2}$/.test(key)) {
    const y = +key.slice(0, 4), w = +key.slice(6);
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week1Mon = jan4.getTime() - (jan4Day - 1) * 86400000;
    // Weekly keys are Sunday-anchored (see weekKey): the week STARTS the day
    // before this ISO Monday, so back up one day to the Sunday.
    return week1Mon + (w - 1) * 7 * 86400000 - 86400000;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  if (/^\d{4}-\d{2}$/.test(key)) { const [y, m] = key.split('-').map(Number); return Date.UTC(y, m - 1, 1); }
  if (/^\d{4}$/.test(key)) return Date.UTC(+key, 0, 1);
  return 0;
}

function periodLabel(key) {
  if (/^\d{4}-W\d{2}$/.test(key)) {
    const start = new Date(periodStart(key));
    return `Week of ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${key.slice(0, 4)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (/^\d{4}$/.test(key)) return key;
  return key;
}

// ---- Habit "next log" recurrence (mirrors the weigh-in schedule model) ------
// Stored per non-daily cadence in the habitNextLog user-doc field as an object:
//   Weekly:   { repeatEvery, weekDays:['monday',…] }
//   Monthly:  { repeatEvery, monthOption:'day'|'weekday', monthDay, monthWeek, monthWeekday }
//   Annually: { repeatEvery, annualMonth (0-11), annualDay }
// The next date is anchored on the last logged occurrence for that cadence, so
// it rolls forward as you log — just like weigh-ins anchor on the last weigh.
const WD_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_LETTERS = [['sunday', 'S'], ['monday', 'M'], ['tuesday', 'T'], ['wednesday', 'W'], ['thursday', 'T'], ['friday', 'F'], ['saturday', 'S']];
const MONTH_WEEKS = ['1st', '2nd', '3rd', '4th', 'last'];
const startOfDayLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDaysLocal = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDayLocal = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const capWord = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function nthWeekdayMatches(date, ordinal, weekdayName) {
  if (WD_NAMES[date.getDay()] !== weekdayName) return false;
  const dom = date.getDate();
  if (ordinal === 'last') {
    const lastDom = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return dom > lastDom - 7;
  }
  return Math.floor((dom - 1) / 7) === MONTH_WEEKS.indexOf(ordinal);
}
function isScheduledDay(canon, rec, date) {
  if (!rec) return true;
  if (canon === 'Weekly') {
    const days = (rec.weekDays && rec.weekDays.length) ? rec.weekDays : ['monday'];
    return days.includes(WD_NAMES[date.getDay()]);
  }
  if (canon === 'Monthly') {
    if ((rec.monthOption || 'day') === 'day') return date.getDate() === (rec.monthDay || 1);
    return nthWeekdayMatches(date, rec.monthWeek || '1st', rec.monthWeekday || 'monday');
  }
  if (canon === 'Annually') return date.getMonth() === (rec.annualMonth ?? 0) && date.getDate() === (rec.annualDay || 1);
  return true;
}
function cadenceOfKey(key) {
  if (/^\d{4}-W\d{2}$/.test(key)) return 'Weekly';
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'Daily';
  if (/^\d{4}-\d{2}$/.test(key)) return 'Monthly';
  if (/^\d{4}$/.test(key)) return 'Annually';
  return null;
}
function periodsBetween(canon, a, b) {
  if (canon === 'Weekly') return Math.round((startOfISOWeek(b).getTime() - startOfISOWeek(a).getTime()) / (7 * 86400000));
  if (canon === 'Monthly') return (b.getFullYear() * 12 + b.getMonth()) - (a.getFullYear() * 12 + a.getMonth());
  if (canon === 'Annually') return b.getFullYear() - a.getFullYear();
  return Math.round((startOfDayLocal(b).getTime() - startOfDayLocal(a).getTime()) / 86400000);
}
// The most recent date any of this cadence's habits were logged (anchor for the
// "every N" interval), derived from habitLog period keys.
function lastLoggedOccurrence(canon, list, habitLog) {
  const ids = new Set(list.map(h => h.id));
  let bestTs = null;
  for (const key of Object.keys(habitLog || {})) {
    if (cadenceOfKey(key) !== canon) continue;
    const bucket = habitLog[key] || {};
    let has = false;
    for (const id in bucket) { if (ids.has(id)) { has = true; break; } }
    if (!has) continue;
    const ts = periodStart(key);
    if (bestTs === null || ts > bestTs) bestTs = ts;
  }
  return bestTs === null ? null : new Date(bestTs);
}
function nextRecurrenceDate(canon, rec, list, habitLog, allLogged) {
  const today = startOfDayLocal(new Date());
  const N = Math.max(1, Number(rec?.repeatEvery) || 1);
  const anchor = lastLoggedOccurrence(canon, list, habitLog);
  const gateOK = d => !anchor || periodsBetween(canon, anchor, d) >= N;
  const find = fromOffset => {
    for (let i = fromOffset; i <= 800; i++) {
      const d = addDaysLocal(today, i);
      if (isScheduledDay(canon, rec, d) && gateOK(d)) return d;
    }
    return null;
  };
  const first = find(0);
  if (!first) return { date: today, dueNow: false };
  // Today is a scheduled day but the period is already fully logged → roll to the
  // next occurrence so we don't nag for something already done.
  if (sameDayLocal(first, today) && allLogged) {
    const next = find(1);
    return { date: next || first, dueNow: false };
  }
  return { date: first, dueNow: sameDayLocal(first, today) };
}
function defaultRec(canon) {
  if (canon === 'Weekly') return { repeatEvery: 1, weekDays: ['monday'] };
  if (canon === 'Monthly') return { repeatEvery: 1, monthOption: 'day', monthDay: 1 };
  if (canon === 'Annually') return { repeatEvery: 1, annualMonth: 0, annualDay: 1 };
  return { repeatEvery: 1 };
}
function recurrenceSummary(canon, rec) {
  const N = Math.max(1, Number(rec?.repeatEvery) || 1);
  if (canon === 'Weekly') {
    const days = (rec.weekDays && rec.weekDays.length ? rec.weekDays : ['monday'])
      .slice().sort((a, b) => WD_NAMES.indexOf(a) - WD_NAMES.indexOf(b))
      .map(d => capWord(d).slice(0, 3)).join(', ');
    return `Every ${N > 1 ? `${N} weeks` : 'week'} · ${days}`;
  }
  if (canon === 'Monthly') {
    const every = `Every ${N > 1 ? `${N} months` : 'month'}`;
    if ((rec.monthOption || 'day') === 'day') return `${every} · day ${rec.monthDay || 1}`;
    return `${every} · ${rec.monthWeek || '1st'} ${capWord(rec.monthWeekday || 'monday')}`;
  }
  if (canon === 'Annually') return `Every ${N > 1 ? `${N} years` : 'year'} · ${MONTH_ABBR[rec.annualMonth ?? 0]} ${rec.annualDay || 1}`;
  return '';
}

// Inline recurrence editor for a cadence section — the weigh-in "Change
// Schedule" controls, scoped to one cadence (unit fixed by the section).
function NextLogRecurrenceEditor({ canon, rec, onChange, onDone }) {
  const N = Math.max(1, Number(rec.repeatEvery) || 1);
  const unit = canon === 'Weekly' ? 'week' : canon === 'Monthly' ? 'month' : 'year';
  const stepBtn = { width: 24, height: 24, borderRadius: 6, border: '1px solid var(--color-border,#e2e8f0)', background: 'var(--color-surface,#fff)', cursor: 'pointer', fontWeight: 700, lineHeight: 1 };
  const pill = active => ({ padding: '0.25rem 0.55rem', borderRadius: 6, border: `1px solid ${active ? ACCENT : 'var(--color-border,#e2e8f0)'}`, background: active ? ACCENT + '14' : 'var(--color-surface,#fff)', color: active ? ACCENT : 'var(--color-text,#475569)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 });
  const circle = active => ({ width: 26, height: 26, borderRadius: 13, border: `1px solid ${active ? ACCENT : 'var(--color-border,#e2e8f0)'}`, background: active ? ACCENT : 'var(--color-surface,#fff)', color: active ? '#fff' : 'var(--color-text-muted,#64748b)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 });
  const wrap = { marginTop: 8, padding: '0.6rem 0.7rem', border: '1px solid var(--color-border,#e2e8f0)', borderRadius: 8, background: 'var(--color-surface,#fff)', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 340 };
  const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
  const lbl = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted,#64748b)' };
  const num = { minWidth: 18, textAlign: 'center', fontWeight: 700, fontSize: '0.8rem' };

  const weekDays = (rec.weekDays && rec.weekDays.length) ? rec.weekDays : ['monday'];
  const toggleDay = d => {
    const set = new Set(weekDays);
    if (set.has(d)) { if (set.size > 1) set.delete(d); } else set.add(d);
    onChange({ weekDays: WD_NAMES.filter(n => set.has(n)) });
  };

  return (
    <div style={wrap}>
      <div style={row}>
        <span style={lbl}>Repeat every</span>
        <button style={stepBtn} onClick={() => onChange({ repeatEvery: Math.max(1, N - 1) })}>−</button>
        <span style={num}>{N}</span>
        <button style={stepBtn} onClick={() => onChange({ repeatEvery: N + 1 })}>+</button>
        <span style={lbl}>{unit}{N > 1 ? 's' : ''}</span>
      </div>

      {canon === 'Weekly' && (
        <div style={row}>
          <span style={lbl}>On</span>
          {WD_LETTERS.map(([name, letter]) => (
            <button key={name} title={capWord(name)} style={circle(weekDays.includes(name))} onClick={() => toggleDay(name)}>{letter}</button>
          ))}
        </div>
      )}

      {canon === 'Monthly' && (
        <>
          <div style={row}>
            <button style={pill((rec.monthOption || 'day') === 'day')} onClick={() => onChange({ monthOption: 'day' })}>On a day</button>
            <button style={pill(rec.monthOption === 'weekday')} onClick={() => onChange({ monthOption: 'weekday' })}>On a weekday</button>
          </div>
          {(rec.monthOption || 'day') === 'day' ? (
            <div style={row}>
              <span style={lbl}>Day</span>
              <button style={stepBtn} onClick={() => onChange({ monthDay: Math.max(1, (rec.monthDay || 1) - 1) })}>−</button>
              <span style={num}>{rec.monthDay || 1}</span>
              <button style={stepBtn} onClick={() => onChange({ monthDay: Math.min(31, (rec.monthDay || 1) + 1) })}>+</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={row}>
                {MONTH_WEEKS.map(w => (
                  <button key={w} style={pill((rec.monthWeek || '1st') === w)} onClick={() => onChange({ monthWeek: w })}>{w}</button>
                ))}
              </div>
              <div style={row}>
                {WD_LETTERS.map(([name, letter]) => (
                  <button key={name} title={capWord(name)} style={circle((rec.monthWeekday || 'monday') === name)} onClick={() => onChange({ monthWeekday: name })}>{letter}</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {canon === 'Annually' && (
        <div style={row}>
          <span style={lbl}>On</span>
          <select value={rec.annualMonth ?? 0} onChange={e => onChange({ annualMonth: Number(e.target.value) })} style={{ fontSize: '0.75rem', padding: '0.2rem', borderRadius: 6, border: '1px solid var(--color-border,#e2e8f0)' }}>
            {MONTH_ABBR.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <button style={stepBtn} onClick={() => onChange({ annualDay: Math.max(1, (rec.annualDay || 1) - 1) })}>−</button>
          <span style={num}>{rec.annualDay || 1}</span>
          <button style={stepBtn} onClick={() => onChange({ annualDay: Math.min(31, (rec.annualDay || 1) + 1) })}>+</button>
        </div>
      )}

      <div>
        <button style={{ ...pill(false), borderColor: ACCENT, color: ACCENT }} onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

const MARK_META = {
  exceeded: { label: 'Above & Beyond', short: 'Gold', color: '#d4a017', icon: '★' },
  done: { label: 'Did it', short: 'Did it', color: '#16a34a', icon: '✓' },
  skipped: { label: 'Skip', short: 'Skip', color: '#64748b', icon: '⏭' },
  missed: { label: 'No', short: 'No', color: '#dc2626', icon: '✕' },
};
// Canonical display/sort order, best → worst.
const MARK_ORDER = ['exceeded', 'done', 'skipped', 'missed'];
// The per-day menu opened by clicking a strip cell: the four marks + Erase.
const DAY_MENU_OPTIONS = [
  ...MARK_ORDER.map(m => ({ mark: m, ...MARK_META[m] })),
  { mark: null, label: 'Erase', color: '#94a3b8', icon: '⌫' },
];

// ---- Automatic habit tracking (config + reference hub) ---------------------
// Rules are stored on the user doc as `habitAutomations`: an array of
// { id, habitId, source, trigger, threshold, mark, enabled, logic }. This tab
// is the control panel where the rules are authored; the engine that actually
// fires them (reading Prep Day entries / HealthKit / webhook events and calling
// setMark) is wired up separately. Sources + triggers are curated below.
const AUTO_SOURCES = [
  { id: 'prepday', label: 'Prep Day entry', icon: '🍽️', blurb: 'Reacts to things already logged in Prep Day (workouts, meals, weigh-ins).' },
  { id: 'rally', label: 'Rally', icon: '📞', blurb: 'Reacts to activity in your Rally app — e.g. how many people you reached out to today.' },
  { id: 'gratitude', label: 'Gratitude', icon: '🙏', blurb: 'Reacts to your Gratitude app — e.g. logging all 3 of today\'s gratitudes.' },
  { id: 'healthkit', label: 'Apple Health', icon: '❤️', blurb: 'Reads HealthKit metrics from the iOS app (steps, workouts, sleep, mindfulness).' },
  { id: 'external', label: 'External / webhook', icon: '🔗', blurb: 'Another tool POSTs an event to Prep Day to mark the habit.' },
];
const AUTO_TRIGGERS = {
  prepday: [
    { id: 'workout_logged', label: 'A workout is logged that day' },
    { id: 'meal_logged', label: 'Any meal is logged that day' },
    { id: 'all_meals_logged', label: 'All 3 main meals logged' },
    { id: 'weighin_logged', label: 'A weigh-in is recorded' },
    { id: 'recipe_prepped', label: 'A planned recipe is prepped' },
    { id: 'custom', label: 'Custom — describe in Logic' },
  ],
  rally: [
    { id: 'reach_out_goal', label: 'Reached out to at least', numeric: true, unit: 'people (default 2)' },
    { id: 'custom', label: 'Custom — describe in Logic' },
  ],
  gratitude: [
    { id: 'gratitude_goal', label: 'Logged at least', numeric: true, unit: 'gratitudes (default 3)' },
    { id: 'custom', label: 'Custom — describe in Logic' },
  ],
  healthkit: [
    { id: 'steps', label: 'Steps reach', numeric: true, unit: 'steps' },
    { id: 'active_energy', label: 'Active energy reaches', numeric: true, unit: 'kcal' },
    { id: 'exercise_minutes', label: 'Exercise minutes reach', numeric: true, unit: 'min' },
    { id: 'hk_workout', label: 'A Health workout is recorded' },
    { id: 'mindful_minutes', label: 'Mindful minutes reach', numeric: true, unit: 'min' },
    { id: 'sleep_hours', label: 'Sleep reaches', numeric: true, unit: 'hrs' },
    { id: 'custom', label: 'Custom — describe in Logic' },
  ],
  external: [
    { id: 'webhook', label: 'Webhook event received' },
    { id: 'custom', label: 'Custom — describe in Logic' },
  ],
};
function triggerDef(source, trigger) {
  return (AUTO_TRIGGERS[source] || []).find(t => t.id === trigger) || null;
}
// The webhook endpoint external tools would POST to (receiver not live yet).
const AUTO_WEBHOOK_URL = 'https://prep-day.com/api/habit-event';

// ---- Per-weekday tracking (Daily habits only) ---------------------------
// A Daily habit can be limited to certain weekdays (e.g. weekdays only, not
// Sat/Sun). Stored on the habit as `trackDays`: an array of JS weekday numbers
// (0=Sun … 6=Sat). Absent or empty → tracked every day (the default). Ignored
// for non-Daily cadences, whose period isn't a single weekday. Shared with the
// mobile app via the `habits` field.
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
function habitTrackDays(h) {
  const t = h?.trackDays;
  return Array.isArray(t) && t.length > 0 ? t : ALL_WEEKDAYS;
}
// Is a Daily habit tracked on this date? Non-daily habits track every period.
function tracksDate(h, date = new Date()) {
  if (cadenceCanon(h?.cadence) !== 'Daily') return true;
  return habitTrackDays(h).includes(date.getDay());
}
// True when a Daily habit is limited to a strict subset of weekdays.
function hasCustomTrackDays(h) {
  return cadenceCanon(h?.cadence) === 'Daily' && Array.isArray(h?.trackDays) && h.trackDays.length > 0 && h.trackDays.length < 7;
}
// Short weekday names indexed by JS getDay() (0=Sun … 6=Sat).
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// "Mon, Tue, Wed, Thu, Fri" for a trackDays array, in Mon-first order.
function trackDaysLabel(trackDays) {
  const set = new Set(Array.isArray(trackDays) ? trackDays : []);
  return [1, 2, 3, 4, 5, 6, 0].filter(wd => set.has(wd)).map(wd => WEEKDAY_SHORT[wd]).join(', ');
}

// Period keys in the rolling KPI window for a habit's cadence: last 30 days
// (daily), last 4 weeks (weekly), last 12 months (monthly), last 5 years
// (annual). "Monthly window for daily/weekly, annual for monthly." For Daily
// habits, `trackDays` limits the window to the weekdays the habit is tracked on,
// so untracked days (e.g. weekends) don't drag the completion % down.
function habitWindowKeys(cadence, trackDays) {
  const canon = cadenceCanon(cadence);
  const now = new Date();
  const keys = [];
  if (canon === 'Weekly') {
    for (let i = 0; i < 4; i++) keys.push(weekKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7)));
  } else if (canon === 'Monthly') {
    for (let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`); }
  } else if (canon === 'Annually') {
    for (let i = 0; i < 5; i++) keys.push(String(now.getFullYear() - i));
  } else {
    const allowed = Array.isArray(trackDays) && trackDays.length > 0 ? trackDays : ALL_WEEKDAYS;
    for (let i = 0; i < 30; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      if (allowed.includes(d.getDay())) keys.push(dayKey(d));
    }
  }
  return keys;
}

// Completion KPI from the log: (Did it + Above & Beyond) ÷ every period in the
// window. Falls back to the stored kpi value when the habit has no logged marks
// in the window (e.g. established "Automatically" habits you don't log).
function habitKpi(h, habitLog) {
  if (!habitLog) return pctOf(h.kpi);
  const keys = habitWindowKeys(h.cadence, h.trackDays);
  let done = 0, logged = 0;
  for (const k of keys) {
    const mk = habitLog[k] ? habitLog[k][h.id] : undefined;
    if (mk) logged++;
    if (mk === 'done' || mk === 'exceeded') done++;
  }
  if (logged === 0) return pctOf(h.kpi);
  return Math.round((done / keys.length) * 100);
}

// Human-readable label for the rolling KPI window of a cadence (see
// habitWindowKeys). Used to explain the completion % in a hover tooltip.
function habitWindowLabel(cadence) {
  const canon = cadenceCanon(cadence);
  if (canon === 'Weekly') return 'last 4 weeks';
  if (canon === 'Monthly') return 'last 12 months';
  if (canon === 'Annually') return 'last 5 years';
  return 'last 30 days';
}

// Explains the completion KPI shown next to a habit: the numerator/denominator
// and how it's counted. Mirrors the math in habitKpi().
function habitKpiTooltip(h, habitLog) {
  const canon = cadenceCanon(h.cadence);
  const unit = canon === 'Weekly' ? 'week' : canon === 'Monthly' ? 'month' : canon === 'Annually' ? 'year' : 'day';
  const windowLabel = habitWindowLabel(h.cadence);
  if (!habitLog) return `Stored completion value.`;
  const keys = habitWindowKeys(h.cadence, h.trackDays);
  let done = 0, logged = 0;
  for (const k of keys) {
    const mk = habitLog[k] ? habitLog[k][h.id] : undefined;
    if (mk) logged++;
    if (mk === 'done' || mk === 'exceeded') done++;
  }
  if (logged === 0) {
    return `Stored completion value — no marks logged in the ${windowLabel}.`;
  }
  const total = keys.length;
  const pct = Math.round((done / total) * 100);
  const trackedNote = hasCustomTrackDays(h)
    ? `\nOnly tracked days count — ${trackDaysLabel(h.trackDays)}.`
    : '';
  return `${pct}% completion over the ${windowLabel}.\n`
    + `${done} of ${total} ${unit}${total === 1 ? '' : 's'} marked “Did it” or “Above & Beyond”.\n`
    + `Every ${unit} in the window counts, so unlogged ${unit}s count as missed.`
    + trackedNote;
}

// Targets a pasted habits column can map to (the editable fields + Cadence).
const HABIT_IMPORT_TARGETS = [...HABIT_FIELDS, { key: 'cadence', label: 'Cadence' }];
// Header text → field key, for auto-mapping pasted columns.
const HABIT_HEADER_SYNONYMS = {
  kpi: 'kpi', '%': 'kpi', completion: 'kpi',
  routine: 'routine',
  'daily routine': 'dailyOrder', 'daily routine #': 'dailyOrder', 'daily #': 'dailyOrder', dailyorder: 'dailyOrder', 'daily order': 'dailyOrder', order: 'dailyOrder', '#': 'dailyOrder',
  habit: 'name', name: 'name', 'habit name': 'name',
  cue: 'cue', 'cue / trigger': 'cue', 'cue/trigger': 'cue', trigger: 'cue', '1st cue': 'cue', 'first cue': 'cue',
  '2nd cue': 'cue2', 'second cue': 'cue2', cue2: 'cue2',
  craving: 'craving', response: 'response', reward: 'reward', age: 'age', status: 'status',
  'start date': 'startDate', startdate: 'startDate', start: 'startDate', date: 'startDate',
  cadence: 'cadence', frequency: 'cadence',
};
function autoMapHabitColumns(columns) {
  return columns.map(c => HABIT_HEADER_SYNONYMS[(c || '').trim().toLowerCase()] || '');
}

export function HabitsPage({ onBack, user }) {
  const [habits, setHabits] = useState([]);
  const [habitLog, setHabitLog] = useState({});
  // Which habitLog cells the automation engine set (mirrors habitLog; value is
  // the mark it wrote). Drives the "(A)" badge on auto-logged marks.
  const [habitLogAuto, setHabitLogAuto] = useState({});
  // Automatic-tracking rules (see AUTO_SOURCES). Stored on the user doc as
  // `habitAutomations`; authored on the Automatic tab.
  const [automations, setAutomations] = useState([]);
  // Habit ids that are tracked automatically — i.e. have at least one enabled
  // automation rule targeting them. Drives the "(A)" badge shown next to the
  // habit's name in the Routines / History tables.
  const autoTrackedIds = useMemo(() => {
    const s = new Set();
    for (const r of automations || []) {
      if (r && r.enabled && r.habitId) s.add(r.habitId);
    }
    return s;
  }, [automations]);
  // Per-cell auto-tracking status from the engine ("why it was / wasn't
  // recorded"), keyed { [periodKey]: { [habitId]: { reason, ... } } }. Drives
  // the hover tooltip on auto-tracked habits' cells.
  const [habitAutoStatus, setHabitAutoStatus] = useState({});
  // Hover-tooltip text for one cell of an auto-tracked habit: the engine's
  // recorded reason when we have one for that period, else a rule-based
  // explanation. Returns '' for habits that aren't auto-tracked.
  const autoStatusFor = useMemo(() => {
    const rulesByHabit = new Map();
    for (const r of automations || []) {
      if (r?.enabled && r.habitId) {
        if (!rulesByHabit.has(r.habitId)) rulesByHabit.set(r.habitId, []);
        rulesByHabit.get(r.habitId).push(r);
      }
    }
    return (habitId, key, mark) => {
      if (!autoTrackedIds.has(habitId)) return '';
      const st = habitAutoStatus?.[key]?.[habitId];
      if (st?.reason) return `Automatic — ${st.reason}`;
      const labels = (rulesByHabit.get(habitId) || [])
        .map(r => triggerDef(r.source, r.trigger)?.label)
        .filter(Boolean);
      const when = labels.length ? labels.join(' or ').toLowerCase() : 'a linked event happens';
      return mark
        ? `Auto-tracked — marks when ${when}.`
        : `Auto-tracked — marks when ${when}. Nothing auto-recorded for this period yet.`;
    };
  }, [automations, autoTrackedIds, habitAutoStatus]);
  // Manual "next log date" override per non-daily cadence, e.g.
  // { Weekly: '2026-07-20', Monthly: '2026-08-01', Annually: '2027-01-01' }.
  // Empty/absent → the auto-computed next-log date is shown instead.
  const [habitNextLog, setHabitNextLog] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('routines');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  // Pasted habit-import column mapping: per-column field key ('' = ignore).
  const [importMapping, setImportMapping] = useState([]);
  // Which habit's detail popup is open (by id). Derived from habits each render
  // so edits/deletes keep the popup in sync.
  const [openHabitId, setOpenHabitId] = useState(null);
  // The day-menu popup: { habitId, key, label } for the cell being edited.
  const [dayMenu, setDayMenu] = useState(null);
  // The "move to routine" popup (by habit id), opened by double-clicking a
  // habit on the Routines tab.
  const [moveHabitId, setMoveHabitId] = useState(null);
  // The routine pending deletion (shows the delete-routine confirm modal).
  const [deleteRoutineName, setDeleteRoutineName] = useState(null);
  const openHabit = openHabitId ? habits.find(h => h.id === openHabitId) || null : null;
  const moveHabit = moveHabitId ? habits.find(h => h.id === moveHabitId) || null : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [remote, remoteLog, remoteAuto, remoteLogAuto, remoteNextLog, remoteAutoStatus] = await Promise.all([
          user?.uid ? loadField(user.uid, 'habits') : null,
          user?.uid ? loadField(user.uid, 'habitLog') : null,
          user?.uid ? loadField(user.uid, 'habitAutomations') : null,
          user?.uid ? loadField(user.uid, 'habitLogAuto') : null,
          user?.uid ? loadField(user.uid, 'habitNextLog') : null,
          user?.uid ? loadHabitAutoStatus(user.uid) : null,
        ]);
        if (cancelled) return;
        if (Array.isArray(remote) && remote.length > 0) setHabits(remote);
        else setHabits(seedHabits());
        if (remoteLog && typeof remoteLog === 'object') setHabitLog(remoteLog);
        if (Array.isArray(remoteAuto)) setAutomations(remoteAuto);
        if (remoteLogAuto && typeof remoteLogAuto === 'object') setHabitLogAuto(remoteLogAuto);
        if (remoteNextLog && typeof remoteNextLog === 'object') setHabitNextLog(remoteNextLog);
        if (remoteAutoStatus && typeof remoteAutoStatus === 'object') setHabitAutoStatus(remoteAutoStatus);
      } catch {
        if (!cancelled) setHabits(seedHabits());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  function persist(next) {
    setHabits(next);
    if (user?.uid) saveField(user.uid, 'habits', next).catch(() => {});
  }
  function persistAutomations(next) {
    setAutomations(next);
    if (user?.uid) saveField(user.uid, 'habitAutomations', next).catch(() => {});
  }

  // "Auto-skip rest days" — a one-tap wrapper over the Automatic engine's
  // workout rule. On = an enabled prepday `workout_logged` rule that marks the
  // habit Did-it on workout days and (via elseMark) Skip on a finished rest day
  // (a past day with no workout). Off = remove our rule, or just drop the skip
  // if the user has customized it into something else.
  const workoutRuleFor = (habitId) => (automations || []).find(
    r => r?.habitId === habitId && r.source === 'prepday' && r.trigger === 'workout_logged',
  );
  const isWorkoutAutoSkipOn = (habitId) => {
    const r = workoutRuleFor(habitId);
    return !!(r && r.enabled && r.elseMark === 'skipped');
  };
  function setWorkoutAutoSkip(habitId, on) {
    const existing = workoutRuleFor(habitId);
    if (on) {
      if (existing) {
        persistAutomations(automations.map(r => r.id === existing.id
          ? { ...r, enabled: true, mark: r.mark || 'done', elseMark: 'skipped' }
          : r));
      } else {
        persistAutomations([...(automations || []), {
          id: makeHabitId(), habitId, source: 'prepday', trigger: 'workout_logged',
          threshold: '', mark: 'done', elseMark: 'skipped', enabled: true, logic: '',
        }]);
      }
      return;
    }
    if (!existing) return;
    // Only remove the rule outright when it's the plain one we created; if it
    // carries other customization, just stop the skip so we don't nuke it.
    const isOurs = existing.mark === 'done' && existing.elseMark === 'skipped' && !existing.threshold;
    persistAutomations(isOurs
      ? automations.filter(r => r.id !== existing.id)
      : automations.map(r => r.id === existing.id ? { ...r, elseMark: '' } : r));
  }
  // Set (dateStr = 'YYYY-MM-DD') or clear (empty) the manual next-log date for a
  // cadence. Empty removes the key so the section falls back to auto-compute.
  function setNextLogDate(cadence, dateStr) {
    setHabitNextLog(prev => {
      const next = { ...prev };
      if (dateStr) next[cadence] = dateStr;
      else delete next[cadence];
      if (user?.uid) saveField(user.uid, 'habitNextLog', next).catch(() => {});
      return next;
    });
  }

  // The mark for a habit in its current cadence period (today / this week /
  // this month / this year).
  function markOf(h) {
    const bucket = habitLog[periodKey(h.cadence)];
    return bucket ? bucket[h.id] : undefined;
  }

  // Toggle a habit's mark for its current period. Tapping the active mark
  // again clears it. Persists the whole habitLog to Firestore (web↔mobile).
  function onMark(h, mark) {
    const key = periodKey(h.cadence);
    setHabitLog(prev => {
      const bucket = { ...(prev[key] || {}) };
      if (bucket[h.id] === mark) delete bucket[h.id];
      else bucket[h.id] = mark;
      const next = { ...prev, [key]: bucket };
      if (Object.keys(bucket).length === 0) delete next[key];
      if (user?.uid) saveField(user.uid, 'habitLog', next).catch(() => {});
      return next;
    });
  }
  // Set (or erase, when mark is null) a habit's mark for an arbitrary period
  // key — used by the day-menu so you can edit any day in the week strip, not
  // just today.
  function setMarkForKey(habitId, key, mark) {
    setHabitLog(prev => {
      const bucket = { ...(prev[key] || {}) };
      if (!mark) delete bucket[habitId];
      else bucket[habitId] = mark;
      const next = { ...prev, [key]: bucket };
      if (Object.keys(bucket).length === 0) delete next[key];
      if (user?.uid) saveField(user.uid, 'habitLog', next).catch(() => {});
      return next;
    });
  }
  // Bulk set (or erase, when mark is null) many cells at once — used by the
  // weekly table's bulk-edit mode. `cells` is [{ habitId, key }, …]. One state
  // update + one Firestore write for the whole batch.
  function setMarksForCells(cells, mark) {
    if (!cells || cells.length === 0) return;
    setHabitLog(prev => {
      const next = { ...prev };
      for (const { habitId, key } of cells) {
        const bucket = { ...(next[key] || {}) };
        if (!mark) delete bucket[habitId];
        else bucket[habitId] = mark;
        if (Object.keys(bucket).length === 0) delete next[key];
        else next[key] = bucket;
      }
      if (user?.uid) saveField(user.uid, 'habitLog', next).catch(() => {});
      return next;
    });
  }
  // Merge an imported history map ({ key: { habitId: mark } }) into habitLog.
  function mergeHabitLog(incoming) {
    setHabitLog(prev => {
      const next = { ...prev };
      for (const key of Object.keys(incoming)) {
        next[key] = { ...(next[key] || {}), ...incoming[key] };
      }
      if (user?.uid) saveField(user.uid, 'habitLog', next).catch(() => {});
      return next;
    });
  }
  function updateHabit(id, key, value) {
    persist(habits.map(h => (h.id === id ? { ...h, [key]: value } : h)));
  }
  // Assign sequential `order` (0,1,2…) to a routine group after a drag, in a
  // single persist so the whole reorder is one Firestore write.
  function reorderHabits(orderedIds) {
    const pos = new Map(orderedIds.map((id, i) => [id, String(i)]));
    persist(habits.map(h => (pos.has(h.id) ? { ...h, order: pos.get(h.id) } : h)));
  }
  // Move a habit to another routine ('' = No routine). Clears its order so it
  // lands at the bottom of the destination group until dragged.
  function setHabitRoutine(id, routine) {
    persist(habits.map(h => (h.id === id ? { ...h, routine, order: '' } : h)));
  }
  function addHabit() {
    const blank = { id: makeHabitId() };
    HABIT_FIELDS.forEach(f => { blank[f.key] = ''; });
    persist([...habits, blank]);
    setTab('habits');
  }
  function deleteHabit(id) {
    persist(habits.filter(h => h.id !== id));
  }
  // Bulk ops over a Set of ids — one Firestore write each (persist saves the
  // whole array), so editing 50 habits costs one write, not 50.
  function bulkUpdate(ids, key, value) {
    persist(habits.map(h => (ids.has(h.id) ? { ...h, [key]: value } : h)));
  }
  function bulkDelete(ids) {
    persist(habits.filter(h => !ids.has(h.id)));
  }
  // Rename a routine = retag every habit in it. Delete a routine = either drop
  // its habits or move them to Unsorted (cleared routine). Routines aren't a
  // stored entity — they only exist as the `routine` field on habits.
  function renameRoutine(oldName, newName) {
    const nn = (newName || '').trim();
    if (!nn || nn === oldName) return;
    persist(habits.map(h => ((h.routine || '').trim() === oldName ? { ...h, routine: nn } : h)));
  }
  function deleteRoutine(name, mode) {
    if (mode === 'delete-habits') {
      persist(habits.filter(h => (h.routine || '').trim() !== name));
    } else { // 'unsort'
      persist(habits.map(h => ((h.routine || '').trim() === name ? { ...h, routine: '' } : h)));
    }
  }

  // Bulk import: paste from Google Sheets (tab-separated). The first row is the
  // header used for column mapping; remaining rows are habits.
  const importColumns = useMemo(() => {
    const first = importText.replace(/\r/g, '').split('\n').find(l => l.trim().length > 0);
    return first ? first.split('\t').map(c => (c || '').trim()) : [];
  }, [importText]);
  const importDataRows = useMemo(
    () => Math.max(0, importText.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0).length - 1),
    [importText],
  );
  const importColSig = importColumns.join('');
  // Re-auto-match whenever the header line changes (edits below the header keep
  // the user's manual mapping). columns is derived from colSig.
  useEffect(() => {
    setImportMapping(autoMapHabitColumns(importColumns));
  }, [importColSig]); // eslint-disable-line react-hooks/exhaustive-deps

  function runImport(mode) {
    const lines = importText.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) { setImportOpen(false); return; }
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split('\t');
      const o = { id: makeHabitId() };
      HABIT_FIELDS.forEach(f => { o[f.key] = ''; });
      let hasName = false;
      for (let c = 0; c < importMapping.length; c++) {
        const field = importMapping[c];
        if (!field) continue;
        const val = (cells[c] || '').trim();
        o[field] = val;
        if (field === 'name' && val) hasName = true;
      }
      if (!hasName) continue; // skip rows with no habit name
      rows.push(o);
    }
    if (rows.length === 0) { setImportOpen(false); return; }
    persist(mode === 'replace' ? rows : [...habits, ...rows]);
    setImportText('');
    setImportOpen(false);
    setTab('habits');
  }

  // Red count badges per sub-tab: how many items still need action.
  //  • Routines / Daily Routine — active habits (not parked, not-yet-started, or
  //    on autopilot) with no mark yet for their current cadence period.
  //  • Auto Review — automatic habits not confirmed for the current month.
  // Tabs with nothing to complete (KPI/Automatic/History/On Hold/Habits) get 0.
  const tabBadges = useMemo(() => {
    const isActive = (h) => {
      const st = (h.status || '').trim();
      return !PARKED_STATUSES.includes(st) && st !== 'Not Started' && st !== 'Havent Started' && st !== 'Automatically';
    };
    const needsMark = (h) => {
      // A daily habit that isn't tracked today (e.g. weekends off) isn't due.
      if (!tracksDate(h)) return false;
      const bucket = habitLog[periodKey(h.cadence)];
      return !(bucket && bucket[h.id]);
    };
    const currentMonth = periodKey('Monthly');
    let routines = 0, daily = 0, autoreview = 0;
    for (const h of habits) {
      if (isActive(h) && needsMark(h)) {
        routines++;
        if (routineType(h.routine) === 'daily') daily++;
      }
      if ((h.status || '').trim() === 'Automatically' && (h.autoConfirmedMonth || '') !== currentMonth) autoreview++;
    }
    return { routines, daily, autoreview };
  }, [habits, habitLog]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading habits…</div>
    );
  }

  return (
    // The whole Habits page fills the full content width (less grey on the sides).
    <div style={{ maxWidth: '100%', margin: '0 auto', padding: '0 0.5rem 3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0 0.25rem' }}>
        <button onClick={onBack} style={backBtn}>&larr; Back</button>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Habits</h1>
        <div style={{ flex: 1 }} />
        <button onClick={() => setImportOpen(true)} style={ghostBtn}>Paste from sheet</button>
        <button onClick={addHabit} style={primaryBtn}>+ Add habit</button>
      </div>
      <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem', lineHeight: 1.45 }}>
        Cue → Craving → Response → Reward. The cue is about <em>noticing</em> the reward; the craving is about <em>wanting</em> it.
      </p>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border, #e2e8f0)', marginBottom: '1rem' }}>
        {SUB_TABS.map(t => {
          const badge = tabBadges[t.id] || 0;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0.55rem 1rem', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '0.9rem', fontWeight: 600,
                color: tab === t.id ? ACCENT : 'var(--color-text-muted, #64748b)',
                borderBottom: tab === t.id ? `2px solid ${ACCENT}` : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.label}
              {badge > 0 && (
                <span
                  title={`${badge} to complete`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                    background: '#dc2626', color: '#fff', fontSize: '0.68rem', fontWeight: 700, lineHeight: 1,
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'kpi' && <KpiView habits={habits} habitLog={habitLog} />}
      {tab === 'routines' && <RoutinesView habits={habits} habitLog={habitLog} habitLogAuto={habitLogAuto} autoTrackedIds={autoTrackedIds} autoStatusFor={autoStatusFor} nextLogMap={habitNextLog} onSetNextLog={setNextLogDate} onUpdate={updateHabit} openMenu={(habitId, key, label) => setDayMenu({ habitId, key, label })} onMove={setMoveHabitId} onReorder={reorderHabits} onSetRoutine={setHabitRoutine} onRenameRoutine={renameRoutine} onDeleteRoutine={setDeleteRoutineName} onBulkMark={setMarksForCells} onOpen={setOpenHabitId} />}
      {tab === 'automatic' && <AutomaticView habits={habits} automations={automations} habitLog={habitLog} habitLogAuto={habitLogAuto} onChange={persistAutomations} />}
      {tab === 'autoreview' && <AutoReviewView habits={habits} onUpdate={updateHabit} onOpen={setOpenHabitId} />}
      {tab === 'onhold' && <OnHoldView habits={habits} onUpdate={updateHabit} />}
      {tab === 'history' && <HistoryView habitLog={habitLog} habits={habits} autoTrackedIds={autoTrackedIds} autoStatusFor={autoStatusFor} onImport={mergeHabitLog} openMenu={(habitId, key, label) => setDayMenu({ habitId, key, label })} />}
      {tab === 'habits' && (
        <HabitsTable habits={habits} onUpdate={updateHabit} onDelete={deleteHabit} onOpen={setOpenHabitId} onBulkUpdate={bulkUpdate} onBulkDelete={bulkDelete} />
      )}

      {openHabit && (
        <HabitDetailModal
          habit={openHabit}
          onUpdate={updateHabit}
          onDelete={(id) => { deleteHabit(id); setOpenHabitId(null); }}
          onClose={() => setOpenHabitId(null)}
          autoSkipOn={isWorkoutAutoSkipOn(openHabit.id)}
          onToggleAutoSkip={(on) => setWorkoutAutoSkip(openHabit.id, on)}
        />
      )}

      {dayMenu && (
        <div style={overlay} onClick={() => setDayMenu(null)}>
          <div style={{ ...modal, width: 'min(92vw, 320px)', padding: '0.9rem' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.7rem', fontSize: '0.95rem' }}>{dayMenu.label}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DAY_MENU_OPTIONS.map(opt => {
                const current = (habitLog[dayMenu.key] || {})[dayMenu.habitId];
                const active = opt.mark === current || (opt.mark === null && current == null);
                return (
                  <button
                    key={opt.label}
                    onClick={() => { setMarkForKey(dayMenu.habitId, dayMenu.key, opt.mark); setDayMenu(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '0.55rem 0.7rem', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${active ? opt.color : 'var(--color-border, #e2e8f0)'}`,
                      background: active ? opt.color + '18' : 'var(--color-surface, #fff)',
                      fontSize: '0.9rem', fontWeight: 600, color: opt.color,
                    }}
                  >
                    <span style={{ fontSize: '1.05rem', width: 20, textAlign: 'center' }}>{opt.icon}</span>
                    <span style={{ color: 'var(--color-text, #1e293b)' }}>{opt.label}</span>
                    {active && <span style={{ marginLeft: 'auto', color: opt.color }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {moveHabit && (
        <MoveRoutineModal
          habit={moveHabit}
          habits={habits}
          onMove={(routine) => { updateHabit(moveHabit.id, 'routine', routine); setMoveHabitId(null); }}
          onClose={() => setMoveHabitId(null)}
        />
      )}

      {deleteRoutineName != null && (
        <DeleteRoutineModal
          name={deleteRoutineName}
          count={habits.filter(h => (h.routine || '').trim() === deleteRoutineName).length}
          onUnsort={() => { deleteRoutine(deleteRoutineName, 'unsort'); setDeleteRoutineName(null); }}
          onDeleteHabits={() => { deleteRoutine(deleteRoutineName, 'delete-habits'); setDeleteRoutineName(null); }}
          onClose={() => setDeleteRoutineName(null)}
        />
      )}

      {importOpen && (
        <div style={overlay} onClick={() => setImportOpen(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.5rem' }}>Paste from spreadsheet</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 0.6rem', lineHeight: 1.45 }}>
              Paste your rows from Google Sheets, <strong>including the header row</strong>. The first row is used to map each
              column to a habit field below — check the mapping (the <strong>Habit</strong> column is required), then Append or Replace.
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="Paste tab-separated rows here (with a header row)…"
              style={{ width: '100%', height: 120, fontFamily: 'monospace', fontSize: '0.78rem', padding: '0.5rem', borderRadius: 8, border: '1px solid #ccc', boxSizing: 'border-box' }}
            />

            {importColumns.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: '0.85rem' }}>Column mapping</strong>
                  <span style={{ fontSize: '0.76rem', color: importMapping.includes('name') ? 'var(--color-text-muted)' : '#dc2626' }}>
                    {importDataRows} row{importDataRows !== 1 ? 's' : ''} · {importMapping.includes('name') ? 'Habit column set' : 'map a Habit column'}
                  </span>
                </div>
                <div style={{ maxHeight: 230, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8, padding: 8 }}>
                  {importColumns.map((col, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: '0.82rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col}>
                        {col || <em style={{ color: '#aaa' }}>(blank)</em>}
                      </span>
                      <span style={{ color: importMapping[i] ? '#16a34a' : '#cbd5e1' }}>→</span>
                      <select
                        value={importMapping[i] || ''}
                        onChange={e => setImportMapping(m => m.map((v, idx) => (idx === i ? e.target.value : v)))}
                        style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', padding: '4px 6px', borderRadius: 6, border: `1px solid ${importMapping[i] === 'name' ? ACCENT : (importMapping[i] ? '#cbd5e1' : '#e2e8f0')}`, background: '#fff' }}
                      >
                        <option value="">— Ignore —</option>
                        {HABIT_IMPORT_TARGETS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button onClick={() => setImportOpen(false)} style={ghostBtn}>Cancel</button>
              <button onClick={() => runImport('append')} style={ghostBtn} disabled={!importMapping.includes('name') || importDataRows < 1}>Append</button>
              <button onClick={() => runImport('replace')} style={primaryBtn} disabled={!importMapping.includes('name') || importDataRows < 1}>Replace all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Daily goals pulled from sibling Claude-Code apps via shared-secret bridges:
// Rally "reach out to 2 people" (api/reachout-today.js) and Gratitude "log 3
// gratitudes" (api/gratitude-today.js).
const REACH_OUT_GOAL = 2;
const GRATITUDE_GOAL = 3;

// Presentational goal tile: a bold count/goal fraction, a progress bar, and a
// subline. Turns green with a ✓ when the goal is met.
function GoalTile({ heading, title, count, goal, noun, source }) {
  const met = count >= goal;
  const pct = Math.min(Math.round((count / goal) * 100), 100);
  return (
    <div style={{ marginBottom: heading ? '1.25rem' : 0 }}>
      {heading && <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>{title}</h3>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, maxWidth: 460, background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 12, padding: '0.85rem 1.1rem' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: met ? '#16a34a' : ACCENT, lineHeight: 1, whiteSpace: 'nowrap' }}>
          {Math.min(count, goal)}/{goal}{met ? ' ✓' : ''}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ height: 10, background: '#eef2f6', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: met ? '#16a34a' : ACCENT }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 5 }}>
            {count} {noun}{met ? ' — daily goal met' : ` — ${goal - count} to go`} · from {source}
          </div>
        </div>
      </div>
    </div>
  );
}

// Fetches on mount and renders nothing until the bridge answers (so each tile
// stays hidden if its source app is unreachable or the bridge isn't configured).
function ReachOutGoal({ heading = true }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/reachout-today?date=${dayKey(new Date())}`)
      .then(r => r.json())
      .then(d => { if (alive && d && typeof d.reachedTodayCount === 'number') setData(d); })
      .catch(() => { /* Rally unreachable — just hide the tile */ });
    return () => { alive = false; };
  }, []);
  if (!data) return null;
  return <GoalTile heading={heading} title="Reach out" count={data.reachedTodayCount} goal={REACH_OUT_GOAL} noun="reached out today" source="Rally" />;
}

function GratitudeGoal({ heading = true }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/gratitude-today?date=${dayKey(new Date())}`)
      .then(r => r.json())
      .then(d => { if (alive && d && typeof d.loggedCount === 'number') setData(d); })
      .catch(() => { /* Gratitude unreachable — just hide the tile */ });
    return () => { alive = false; };
  }, []);
  if (!data) return null;
  return <GoalTile heading={heading} title="Gratitude" count={data.loggedCount} goal={data.goal || GRATITUDE_GOAL} noun="gratitude lines logged today" source="Gratitude" />;
}

function KpiView({ habits, habitLog }) {
  const stats = useMemo(() => {
    const byStatus = {};
    const byType = { daily: 0, weekly: 0, monthly: 0, other: 0, unsorted: 0 };
    let pctSum = 0, pctCount = 0;
    for (const h of habits) {
      const st = (h.status || '—').trim() || '—';
      byStatus[st] = (byStatus[st] || 0) + 1;
      byType[routineType(h.routine)]++;
      const p = habitKpi(h, habitLog);
      if (p != null) { pctSum += p; pctCount++; }
    }
    const active = habits.filter(h => !['Abandoned', 'Not Started', 'Havent Started', 'On Hold'].includes((h.status || '').trim())).length;
    return {
      total: habits.length,
      active,
      avgPct: pctCount ? Math.round(pctSum / pctCount) : null,
      byStatus: Object.entries(byStatus).sort((a, b) => b[1] - a[1]),
      byType,
    };
  }, [habits, habitLog]);

  // Logged marks bucketed into calendar months, newest first — a time series of
  // how the log breaks down by mark (Above & Beyond / Did it / Skip / No). Any
  // period key (day/week/month/year) maps to a month via periodStart().
  const byMonth = useMemo(() => {
    const map = new Map(); // 'YYYY-MM' -> { exceeded, done, skipped, missed, total }
    for (const key in habitLog) {
      const ts = periodStart(key);
      if (!ts) continue;
      const d = new Date(ts);
      const mKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      let bucket = map.get(mKey);
      if (!bucket) { bucket = { exceeded: 0, done: 0, skipped: 0, missed: 0, total: 0 }; map.set(mKey, bucket); }
      const marks = habitLog[key];
      for (const id in marks) {
        const mk = marks[id];
        if (bucket[mk] != null) { bucket[mk]++; bucket.total++; }
      }
    }
    const rows = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const maxTotal = Math.max(1, ...rows.map(([, b]) => b.total));
    return { rows, maxTotal };
  }, [habitLog]);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total habits" value={stats.total} />
        <Kpi label="Active" value={stats.active} />
        <Kpi label="Avg completion" value={stats.avgPct == null ? '—' : `${stats.avgPct}%`} />
        <Kpi label="Daily" value={stats.byType.daily} />
        <Kpi label="Weekly" value={stats.byType.weekly} />
        <Kpi label="Monthly" value={stats.byType.monthly} />
      </div>

      <ReachOutGoal />

      <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>By status</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 460 }}>
        {stats.byStatus.map(([st, n]) => {
          const pct = Math.round((n / stats.total) * 100);
          return (
            <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 130, fontSize: '0.82rem', color: 'var(--color-text-secondary, #475569)' }}>{st}</span>
              <div style={{ flex: 1, height: 10, background: '#eef2f6', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: ACCENT }} />
              </div>
              <span style={{ width: 36, textAlign: 'right', fontSize: '0.8rem', fontWeight: 700 }}>{n}</span>
            </div>
          );
        })}
      </div>

      <h3 style={{ fontSize: '0.95rem', margin: '1.5rem 0 0.35rem' }}>Logged by month</h3>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0 0 0.6rem' }}>Every mark you logged, grouped by the month it falls in — newest first.</p>
      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', marginBottom: '0.6rem' }}>
        {MARK_ORDER.map(m => (
          <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', color: 'var(--color-text-secondary, #475569)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: MARK_META[m].color }} />
            {MARK_META[m].label}
          </span>
        ))}
      </div>
      {byMonth.rows.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>No marks logged yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560 }}>
          {byMonth.rows.map(([mKey, b]) => {
            const [y, m] = mKey.split('-').map(Number);
            const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            const barWidth = Math.round((b.total / byMonth.maxTotal) * 100);
            return (
              <div key={mKey} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 64, fontSize: '0.82rem', color: 'var(--color-text-secondary, #475569)' }}>{label}</span>
                <div style={{ flex: 1, height: 12, background: '#eef2f6', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', width: `${barWidth}%`, height: '100%' }}>
                    {MARK_ORDER.map(mk => (
                      b[mk] > 0 ? (
                        <div
                          key={mk}
                          title={`${b[mk]} ${MARK_META[mk].label} · ${label}`}
                          style={{ width: `${(b[mk] / b.total) * 100}%`, height: '100%', background: MARK_META[mk].color }}
                        />
                      ) : null
                    ))}
                  </div>
                </div>
                <span style={{ width: 36, textAlign: 'right', fontSize: '0.8rem', fontWeight: 700 }}>{b.total}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 12, padding: '0.85rem 1.1rem', minWidth: 120 }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: ACCENT, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
}

// Editable status dropdown. Includes the habit's current value even if it's a
// legacy status no longer in STATUS_OPTIONS, so editing never silently drops it.
function StatusSelect({ value, muted, onChange }) {
  const v = (value || '').trim();
  const opts = STATUS_OPTIONS.includes(v) || !v ? STATUS_OPTIONS : [v, ...STATUS_OPTIONS];
  return (
    <select
      value={v}
      onChange={e => onChange(e.target.value)}
      style={{
        fontSize: '0.78rem', fontWeight: 600, padding: '3px 6px', borderRadius: 6,
        border: '1px solid var(--color-border, #e2e8f0)',
        background: muted ? 'transparent' : 'var(--color-surface, #fff)',
        color: muted ? '#94a3b8' : 'var(--color-text, #1e293b)',
        cursor: 'pointer',
      }}
    >
      {!v && <option value="">—</option>}
      {opts.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function RoutinesView({ habits, habitLog, habitLogAuto, autoTrackedIds = new Set(), autoStatusFor = () => '', nextLogMap, onSetNextLog, onUpdate, openMenu, onMove, onReorder, onSetRoutine, onRenameRoutine, onDeleteRoutine, onBulkMark, onOpen }) {
  // All routine names the user has, in the canonical routine order, for the
  // per-habit routine dropdown.
  const routineOptions = useMemo(() => {
    const set = new Set([...DAILY_ROUTINES, ...habits.map(h => (h.routine || '').trim()).filter(Boolean)]);
    return [...set].sort((a, b) => {
      const ra = routineRank(a), rb = routineRank(b);
      return ra.typeOrder - rb.typeOrder || ra.dailyIdx - rb.dailyIdx || ra.num - rb.num || a.localeCompare(b);
    });
  }, [habits]);
  // Group by the habit's tracking FREQUENCY (cadence), so setting a habit to
  // Weekly makes it show up under the Weekly section. Sections are ordered
  // Daily → Weekly → Monthly → Annually. Within a section, habits stay clustered
  // by their named routine then daily order then name. Keep this in sync with
  // PrepDay/src/components/HabitsScreen.tsx.
  const groups = useMemo(() => {
    const map = new Map();
    for (const h of habits) {
      const st = (h.status || '').trim();
      if (PARKED_STATUSES.includes(st)) continue; // parked (On Hold tab / Habits table)
      // Not-yet-started habits don't belong in the active routines list either.
      if (st === 'Not Started' || st === 'Havent Started') continue;
      const key = cadenceCanon(h.cadence); // Daily | Weekly | Monthly | Annually
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(h);
    }
    for (const list of map.values()) list.sort(compareByRoutine);
    return [...map.entries()].sort(
      (a, b) => (CADENCE_RANK[a[0]] ?? 9) - (CADENCE_RANK[b[0]] ?? 9),
    );
  }, [habits]);

  // Quick filter: each tab maps to one cadence section; 'all' shows everything.
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const visibleGroups = useMemo(() => {
    if (view === 'all') return groups;
    return groups.filter(([cadence]) => cadence === VIEW_TO_CADENCE[view]);
  }, [groups, view]);

  // Per-cadence count of active habits still unlogged for their current period —
  // drives the red badges on the All / Daily / Weekly / Monthly / Yearly tabs.
  // Mirrors RoutineSection's `uncompleted` (skips Automatic habits + off days).
  const cadenceUnlogged = useMemo(() => {
    const counts = { Daily: 0, Weekly: 0, Monthly: 0, Annually: 0 };
    for (const [cadence, list] of groups) {
      let n = 0;
      for (const h of list) {
        if ((h.status || '').trim() === 'Automatically') continue;
        if (tracksDate(h) && (habitLog[periodKey(h.cadence)] || {})[h.id] === undefined) n++;
      }
      counts[cadence] = n;
    }
    return counts;
  }, [groups, habitLog]);
  const totalUnlogged = cadenceUnlogged.Daily + cadenceUnlogged.Weekly + cadenceUnlogged.Monthly + cadenceUnlogged.Annually;

  // Search any habit by name — including On Hold habits that don't show in the
  // routines — so you can find one and see its status anywhere.
  const searchResults = useMemo(() => {
    if (!q) return [];
    return habits
      .filter(h => (h.name || '').toLowerCase().includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [habits, q]);

  const searchBar = (
    <div style={{ position: 'relative', marginBottom: '0.85rem', maxWidth: 360 }}>
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.85rem' }}>🔍</span>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search habits…"
        style={{ width: '100%', boxSizing: 'border-box', padding: '0.45rem 1.9rem', borderRadius: 8, border: '1px solid var(--color-border, #e2e8f0)', fontSize: '0.85rem', background: 'var(--color-surface, #fff)' }}
      />
      {query && (
        <button onClick={() => setQuery('')} title="Clear" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '0.95rem' }}>×</button>
      )}
    </div>
  );

  if (q) {
    return (
      <div>
        {searchBar}
        {searchResults.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No habits match “{query.trim()}”.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchResults.map(h => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.45rem 0.6rem', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8 }}>
                <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>{h.name || <em style={{ color: '#aaa' }}>untitled</em>}{autoTrackedIds.has(h.id) && <AutoNameBadge />}</span>
                {(h.routine || '').trim() && <span style={routineTag} title="Routine">{(h.routine || '').trim()}</span>}
                {(h.cadence || '').trim() && <span style={cadenceTag}>{h.cadence}</span>}
                <StatusSelect value={h.status} onChange={v => onUpdate(h.id, 'status', v)} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div>
        {searchBar}
        <p style={{ color: 'var(--color-text-muted)' }}>No habits yet — add some on the Habits tab.</p>
      </div>
    );
  }

  return (
    <div>
      {searchBar}
      {/* Daily / Weekly / Monthly view switch */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '0.85rem', background: '#f1f5f9', borderRadius: 10, padding: 3, width: 'fit-content' }}>
        {VIEW_TABS.map(t => {
          const active = view === t.id;
          const dot = t.id === 'all' ? totalUnlogged : (cadenceUnlogged[VIEW_TO_CADENCE[t.id]] || 0);
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              style={{
                cursor: 'pointer', padding: '0.35rem 0.9rem', borderRadius: 8,
                fontSize: '0.82rem', fontWeight: 600, border: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: active ? 'var(--color-surface, #fff)' : 'transparent',
                color: active ? ACCENT : 'var(--color-text-muted, #64748b)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              }}
            >
              {t.label}
              {dot > 0 && (
                <span
                  title={`${dot} habit${dot > 1 ? 's' : ''} still unlogged`}
                  style={{ minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px', background: '#dc2626', color: '#fff', fontSize: '0.62rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                >
                  {dot}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {visibleGroups.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          No {(VIEW_TABS.find(t => t.id === view)?.label || view).toLowerCase()} habits.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
          {visibleGroups.map(([cadenceName, list]) => (
            <RoutineSection key={cadenceName} cadenceName={cadenceName} list={list} habitLog={habitLog} habitLogAuto={habitLogAuto} autoTrackedIds={autoTrackedIds} autoStatusFor={autoStatusFor} nextLogOverride={(nextLogMap || {})[cadenceName] || ''} onSetNextLog={onSetNextLog} onUpdate={onUpdate} openMenu={openMenu} routineOptions={routineOptions} onReorder={onReorder} onSetRoutine={onSetRoutine} onBulkMark={onBulkMark} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

const VIEW_TABS = [
  { id: 'all', label: 'All' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'annually', label: 'Yearly' },
];
// View-tab id → the cadence section it shows.
const VIEW_TO_CADENCE = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', annually: 'Annually' };

// 7-day strip (Mon–Sun of the current week) for a daily habit, today
// highlighted. Each day is a button — clicking it opens the day menu so any day
// (not just today) can be set to a mark or erased.
function WeekStrip({ habit, habitId, habitName, habitLog, habitLogAuto, openMenu }) {
  const today = dayKey(new Date());
  const monday = startOfISOWeek(new Date());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = dayKey(d);
    const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const mark = habitLog[key] ? habitLog[key][habitId] : undefined;
    const tracked = habit ? tracksDate(habit, d) : true;
    return { key, label, letter: WEEKDAY_ABBR[i][0], isToday: key === today, mark, tracked, auto: isAutoMark(habitLogAuto, key, habitId, mark) };
  });
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {days.map(d => (
        <button
          key={d.key}
          onClick={() => openMenu(habitId, d.key, `${habitName || 'Habit'} · ${d.label}`)}
          title={d.tracked ? d.label : `${d.label} · off day (not tracked)`}
          style={{
            flex: 1, textAlign: 'center', borderRadius: 6, padding: '3px 0', cursor: 'pointer',
            // A logged mark's colour (green for "Did it") always wins over today's
            // blue highlight, so a completed day reads as green even when it's today.
            border: `1px solid ${d.mark ? MARK_META[d.mark].color + (d.isToday ? '' : '55') : (d.isToday ? ACCENT : '#eef2f6')}`,
            background: d.mark ? MARK_META[d.mark].color + (d.isToday ? '22' : '12') : (d.isToday ? ACCENT + '0f' : 'var(--color-surface, #fff)'),
            // Off days (e.g. weekends for a weekday habit) are dimmed and, when
            // unlogged, show a dash instead of the "log me" dot — they don't
            // count toward completion. A pre-existing mark still shows.
            opacity: d.tracked || d.mark ? 1 : 0.4,
          }}
        >
          <div style={{ fontSize: '0.58rem', fontWeight: 700, color: d.mark ? MARK_META[d.mark].color : (d.isToday ? ACCENT : '#94a3b8') }}>{d.letter}</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 800, lineHeight: 1.2, color: d.mark ? MARK_META[d.mark].color : '#d1d5db' }}>
            {d.mark ? MARK_META[d.mark].icon : (d.tracked ? '·' : '–')}
            {d.auto && <span title="Automatically logged" style={{ fontSize: '0.5rem', fontWeight: 800, color: '#2563eb', verticalAlign: 'super', marginLeft: 1 }}>A</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

// The 7 weeks shown by the weekly strip/header: offsets -5..-1 = past 5 weeks,
// 0 = this week, +1 = next week upcoming. Each week's displayed date is its
// scheduled LOG day (ISO-week Monday + logOffset days, e.g. that week's Sunday),
// so labels match the day you actually log on. Storage keys stay ISO-week based.
function weeklyStripWeeks(logOffset = 0) {
  const sunday = sundayOf(new Date());   // Sunday that starts the current week
  const curKey = weekKey(sunday);
  // Show the past 3 weeks of history, plus the current week and the upcoming
  // one (offsets -3 … +1) — a tighter 5-week window.
  return Array.from({ length: 5 }, (_, i) => {
    const offset = i - 3;
    const weekSun = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + offset * 7);
    const key = weekKey(weekSun);
    // Label date = the scheduled log day within this Sun–Sat week (logOffset days
    // from Sunday; 0 = Sunday itself).
    const logDate = new Date(weekSun.getFullYear(), weekSun.getMonth(), weekSun.getDate() + logOffset);
    const weekNo = key.slice(key.indexOf('W') + 1);          // "28" from 2026-W28
    // Sunday-anchored week span, e.g. "Jul 12 – 18".
    const weekSat = new Date(weekSun.getFullYear(), weekSun.getMonth(), weekSun.getDate() + 6);
    const rangeLabel = `${weekSun.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${
      weekSun.getMonth() === weekSat.getMonth()
        ? weekSat.getDate()
        : weekSat.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }`;
    return {
      key,
      date: logDate,
      weekNo,
      primary: `W${weekNo}`,                                 // column header, e.g. "W28"
      shortLabel: rangeLabel,                                // week span, e.g. "Jul 12 – 18"
      fullLabel: logDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      isCurrent: key === curKey,
      isNext: offset === 1,
    };
  });
}

// The routine-table column strip for ANY cadence — one entry per period, same
// shape weeklyStripWeeks returns so the weekly table renders every cadence.
// Weekly keeps its schedule-aware builder. Daily shows the current ISO week
// (Mon–Sun, carrying each day's Date so off-days can dim). Monthly/Annually show
// a trailing window ending one period ahead (5 past · current · next), mirroring
// the weekly strip's shape.
function periodStripCols(canon, logOffset = 0) {
  if (canon === 'Weekly') return weeklyStripWeeks(logOffset);
  const today = new Date();
  const curKey = periodKey(canon, today);
  if (canon === 'Daily') {
    const monday = startOfISOWeek(today);
    // Start one day early (the previous Sunday) so the strip shows 8 days —
    // Sun, Mon…Sun — giving a peek at the prior week's tail end.
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1);
    return Array.from({ length: 8 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = periodKey('Daily', d);
      return {
        key,
        date: d,
        primary: d.toLocaleDateString(undefined, { weekday: 'narrow' }),   // M T W…
        shortLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        fullLabel: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        isCurrent: key === curKey,
        isNext: false,
      };
    });
  }
  // Monthly / Annually: 5 past · current · next.
  return Array.from({ length: 7 }, (_, i) => {
    const offset = i - 5;
    let d, key, primary, shortLabel, fullLabel;
    if (canon === 'Monthly') {
      d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      key = periodKey('Monthly', d);
      primary = d.toLocaleDateString(undefined, { month: 'short' });        // Jul
      shortLabel = String(d.getFullYear());
      fullLabel = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    } else { // Annually
      d = new Date(today.getFullYear() + offset, 0, 1);
      key = periodKey('Annually', d);
      primary = String(d.getFullYear());                                    // 2026
      shortLabel = '';
      fullLabel = String(d.getFullYear());
    }
    return { key, date: d, primary, shortLabel, fullLabel, isCurrent: key === curKey, isNext: offset === 1 };
  });
}

// "Move to routine" popup — double-click a habit on the Routines tab. Lists the
// existing routines (sorted in the usual order) plus a field to type a new one.
function MoveRoutineModal({ habit, habits, onMove, onClose }) {
  const [newRoutine, setNewRoutine] = useState('');
  const current = (habit.routine || '').trim();
  const options = useMemo(() => {
    const set = new Set([...DAILY_ROUTINES, ...habits.map(h => (h.routine || '').trim()).filter(Boolean)]);
    return [...set].sort((a, b) => {
      const ra = routineRank(a), rb = routineRank(b);
      return ra.typeOrder - rb.typeOrder || ra.dailyIdx - rb.dailyIdx || ra.num - rb.num || a.localeCompare(b);
    });
  }, [habits]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, width: 'min(92vw, 360px)', maxHeight: '82vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.15rem', fontSize: '1rem' }}>Move to routine</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 0.7rem' }}>{habit.name || 'Habit'}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {options.map(r => {
            const active = r === current;
            return (
              <button
                key={r}
                onClick={() => onMove(r)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left',
                  padding: '0.5rem 0.7rem', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${active ? ACCENT : 'var(--color-border, #e2e8f0)'}`,
                  background: active ? ACCENT + '14' : 'var(--color-surface, #fff)',
                  fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text, #1e293b)',
                }}
              >
                <span>{r}</span>
                {active && <span style={{ color: ACCENT, fontSize: '0.78rem' }}>current</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: '0.8rem' }}>
          <input
            value={newRoutine}
            onChange={e => setNewRoutine(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newRoutine.trim()) onMove(newRoutine.trim()); }}
            placeholder="New routine name…"
            style={fieldInput}
          />
          <button onClick={() => newRoutine.trim() && onMove(newRoutine.trim())} disabled={!newRoutine.trim()} style={primaryBtn}>Move</button>
        </div>
      </div>
    </div>
  );
}

// Confirm deleting a routine: drop its habits, or keep them by moving to
// Unsorted. (Routines only exist as the `routine` field on habits.)
function DeleteRoutineModal({ name, count, onUnsort, onDeleteHabits, onClose }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, width: 'min(92vw, 380px)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.4rem', fontSize: '1rem' }}>Delete routine “{name}”?</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1rem', lineHeight: 1.45 }}>
          {count === 0
            ? 'This routine has no habits.'
            : `It has ${count} habit${count > 1 ? 's' : ''}. Keep them by moving to Unsorted, or delete them too.`}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {count > 0 && (
            <button onClick={onUnsort} style={{ ...ghostBtn, padding: '0.6rem', textAlign: 'left' }}>
              Move {count} habit{count > 1 ? 's' : ''} to Unsorted
            </button>
          )}
          <button
            onClick={onDeleteHabits}
            style={{ border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 8, padding: '0.6rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, textAlign: 'left' }}
          >
            {count > 0 ? `Delete the routine and its ${count} habit${count > 1 ? 's' : ''}` : 'Delete routine'}
          </button>
          <button onClick={onClose} style={{ ...ghostBtn, padding: '0.6rem' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// One cadence section (Daily / Weekly / …). Inside it, habits are split into
// their named routine (or "No routine"), and can be dragged to reorder within
// a routine. Grab the ⠿ handle to drag; each row has a routine dropdown.
function RoutineSection({ cadenceName, list, habitLog, habitLogAuto, autoTrackedIds = new Set(), autoStatusFor = () => '', nextLogOverride, onSetNextLog, onUpdate, openMenu, routineOptions, onReorder, onSetRoutine, onBulkMark, onOpen }) {
  const [drag, setDrag] = useState(null); // { id, groupKey }
  const [editingNext, setEditingNext] = useState(false);
  // Weekly table bulk-edit: when on, clicking cells/headers/rows selects them
  // (instead of opening the single-cell menu); an action bar applies one mark to
  // the whole selection. Selection key is `${habitId}|${weekKey}`.
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  // Column strip for this cadence (Daily = 8 days incl. the previous Sunday,
  // Weekly = the weeks in view, Monthly/Annually = 7 periods). Computed up front
  // so the resizable columns can size to the actual count.
  //
  // Weekly strip cells are labeled by the section's scheduled log DAY (e.g.
  // Sunday), measured from the Sun–Sat week's START (Sun 0 … Sat 6); when multiple
  // days are scheduled we use the latest (the week's deadline). Falls back to
  // Sunday (0, the week start) on auto with no set schedule.
  const weeklyRec = (nextLogOverride && typeof nextLogOverride === 'object') ? nextLogOverride : null;
  const weekLogOffset = (cadenceCanon(cadenceName) === 'Weekly' && weeklyRec?.weekDays?.length)
    ? Math.max(...weeklyRec.weekDays.map(d => WD_NAMES.indexOf(d))) // WD_NAMES[0]=sunday
    : 0;
  const weekCols = periodStripCols(cadenceCanon(cadenceName), weekLogOffset);
  // Resizable columns (Habit, %, then one per period). Widths persist in
  // localStorage, keyed by column count so cadences with different strip lengths
  // don't overwrite each other's saved widths.
  // Column order: Habit, one per period, then % and the routine dropdown on the
  // far right. Storage key is bumped to v2 because that order changed.
  const colStorageKey = `habitWeeklyColWidths-v2-${3 + weekCols.length}`;
  // Weekly columns carry a full date span ("Jul 12 – 18") so they need more room
  // than a single day/month/year label.
  const periodColW = cadenceCanon(cadenceName) === 'Weekly' ? 72 : 46;
  const [colWidths, setColWidths] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(colStorageKey));
      if (Array.isArray(s) && s.length === 3 + weekCols.length && s.every(n => typeof n === 'number')) return s;
    } catch { /* ignore */ }
    return [220, ...Array(weekCols.length).fill(periodColW), 46, 130];
  });
  const isAuto = h => (h.status || '').trim() === 'Automatically';
  const activeList = list.filter(h => !isAuto(h));
  const autoList = list.filter(isAuto);
  // Red count of trackable habits whose current period is still unlogged
  // (daily habits that are off today don't count as needing a mark).
  const uncompleted = activeList.filter(h => tracksDate(h) && (habitLog[periodKey(h.cadence)] || {})[h.id] === undefined).length;

  // Sub-group active habits by routine. activeList is already sorted
  // (routine rank → manual order → name), so groups emerge in routine order and
  // rows within a group in their drag order.
  const subGroups = useMemo(() => {
    const map = new Map();
    for (const h of activeList) {
      const key = (h.routine || '').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(h);
    }
    return [...map.entries()];
  }, [activeList]);

  function handleDrop(targetId, groupKey, groupItems) {
    const d = drag;
    setDrag(null);
    if (!d || d.groupKey !== groupKey || d.id === targetId) return;
    const ids = groupItems.map(x => x.id);
    const from = ids.indexOf(d.id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
  }

  function chooseRoutine(id, val) {
    if (val === '__new__') {
      const name = window.prompt('New routine name:');
      if (name && name.trim()) onSetRoutine(id, name.trim());
      return;
    }
    onSetRoutine(id, val);
  }

  // ---- Weekly table + bulk-edit helpers ----------------------------------
  const borderCol = 'var(--color-border, #e2e8f0)';
  const thBase = { padding: '5px 6px', borderBottom: `2px solid ${borderCol}`, background: 'var(--color-background, #fff)', verticalAlign: 'bottom' };
  const cellId = (habitId, key) => `${habitId}|${key}`;
  const setCells = (ids, on) => setSelected(prev => {
    const n = new Set(prev);
    ids.forEach(id => (on ? n.add(id) : n.delete(id)));
    return n;
  });
  const toggleCell = (habitId, key) => setSelected(prev => {
    const n = new Set(prev); const id = cellId(habitId, key);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleMany = (ids) => { const allOn = ids.length > 0 && ids.every(id => selected.has(id)); setCells(ids, !allOn); };
  const toggleColumn = (key) => toggleMany(activeList.map(h => cellId(h.id, key)));
  const toggleRow = (habitId) => toggleMany(weekCols.map(w => cellId(habitId, w.key)));
  const toggleGroup = (items) => toggleMany(items.flatMap(h => weekCols.map(w => cellId(h.id, w.key))));
  const clearSel = () => setSelected(new Set());
  const applyBulk = (mark) => {
    const cells = [...selected].map(id => { const i = id.lastIndexOf('|'); return { habitId: id.slice(0, i), key: id.slice(i + 1) }; });
    onBulkMark?.(cells, mark);
    clearSel();
  };
  const totalTableWidth = colWidths.reduce((a, b) => a + b, 0);
  const startColResize = (idx, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[idx];
    const onMove = (ev) => {
      const w = Math.max(30, startW + (ev.clientX - startX));
      setColWidths(prev => { const n = [...prev]; n[idx] = w; return n; });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setColWidths(prev => { try { localStorage.setItem(colStorageKey, JSON.stringify(prev)); } catch { /* ignore */ } return prev; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // Small draggable handle on a header cell's right edge.
  const colResizeHandle = (idx) => (
    <span
      onMouseDown={(e) => startColResize(idx, e)}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize column"
      style={{ position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', userSelect: 'none', zIndex: 2 }}
    />
  );

  // Every cadence (Daily / Weekly / Monthly / Annually) now renders the shared
  // period-strip table below via weeklyRow — the old per-cadence list rows were
  // removed so the Routines subtabs share one consistent layout.
  //
  // One <tr> in the table: name (+ drag / routine), status, %, then a
  // mark cell per week. In bulk mode, cells/name toggle selection instead of
  // opening the single-cell menu. Automatic (muted) habits render read-only.
  const weeklyRow = (h, muted, groupKey, groupItems) => {
    const pct = habitKpi(h, habitLog);
    const dragging = drag?.id === h.id;
    const rowSel = !muted && weekCols.length > 0 && weekCols.every(w => selected.has(cellId(h.id, w.key)));
    const tdBase = { borderBottom: `1px solid ${borderCol}`, padding: '3px 6px' };
    return (
      <tr
        key={h.id}
        onDragOver={muted ? undefined : (e) => { if (drag && drag.groupKey === groupKey) e.preventDefault(); }}
        onDrop={muted ? undefined : (e) => { e.preventDefault(); handleDrop(h.id, groupKey, groupItems); }}
        style={{ background: dragging ? ACCENT + '0f' : undefined, opacity: dragging ? 0.5 : 1 }}
      >
        <td style={{ ...tdBase, minWidth: 150 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!muted && !bulkMode && (
              <span
                draggable
                onDragStart={(e) => { setDrag({ id: h.id, groupKey }); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => setDrag(null)}
                title="Drag to reorder within this routine"
                style={{ cursor: 'grab', color: '#cbd5e1', fontSize: '0.9rem', userSelect: 'none', lineHeight: 1 }}
              >⠿</span>
            )}
            <span
              onClick={bulkMode && !muted ? () => toggleRow(h.id) : undefined}
              onDoubleClick={() => onOpen?.(h.id)}
              title={bulkMode && !muted ? 'Click to select this habit’s whole row (double-click to open)' : 'Double-click to open habit'}
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.82rem', fontWeight: 600, color: muted ? '#94a3b8' : 'inherit', cursor: bulkMode && !muted ? 'pointer' : 'default', textDecoration: rowSel ? 'underline' : 'none' }}
            >{h.name || <em style={{ color: '#aaa' }}>untitled</em>}</span>
            {autoTrackedIds.has(h.id) && <AutoNameBadge />}
          </div>
        </td>
        {weekCols.map(w => {
          const mark = habitLog[w.key] ? habitLog[w.key][h.id] : undefined;
          const auto = isAutoMark(habitLogAuto, w.key, h.id, mark);
          const sel = selected.has(cellId(h.id, w.key));
          // A Daily habit limited to certain weekdays: dim + disable its off-days
          // (mirrors the old day-strip) so untracked days read as inactive.
          const off = !muted && w.date && cadenceCanon(h.cadence) === 'Daily' && !tracksDate(h, w.date);
          const disabled = muted || off;
          // Auto-tracked habits: explain on hover why this cell was / wasn't
          // auto-recorded, appended to the normal date/action tooltip.
          const autoTip = off ? '' : autoStatusFor(h.id, w.key, mark);
          const baseTip = off ? 'Not tracked on this day' : (muted ? '' : (bulkMode ? 'Click to select' : w.fullLabel));
          const cellTitle = [baseTip, autoTip].filter(Boolean).join(' — ') || undefined;
          return (
            <td key={w.key} title={disabled ? cellTitle : undefined} style={{ ...tdBase, padding: 2, borderLeft: `1px ${w.isNext ? 'dashed' : 'solid'} ${borderCol}`, textAlign: 'center', background: off ? '#f8fafc' : ((w.isCurrent && !mark) ? ACCENT + '08' : undefined) }}>
              <button
                disabled={disabled}
                onClick={disabled ? undefined : () => (bulkMode ? toggleCell(h.id, w.key) : openMenu(h.id, w.key, `${h.name || 'Habit'} · ${w.fullLabel}${w.isNext ? ' · upcoming' : ''}`))}
                title={cellTitle}
                style={{
                  width: '100%', minWidth: 34, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  cursor: disabled ? 'default' : 'pointer', borderRadius: 5,
                  // A logged mark's colour (green for "Did it") always wins over the
                  // current-period blue tint, so a completed cell reads as green.
                  border: sel ? `2px solid ${ACCENT}` : (mark ? `1px solid ${MARK_META[mark].color}66` : '1px solid transparent'),
                  background: sel ? ACCENT + '22' : (mark ? MARK_META[mark].color + '22' : 'transparent'),
                  color: mark ? MARK_META[mark].color : '#d1d5db', fontWeight: 800, fontSize: '0.9rem',
                  opacity: off ? 0.3 : (w.isNext && !mark && !sel ? 0.5 : 1),
                }}
              >
                {off ? '' : (mark ? MARK_META[mark].icon : '·')}
                {auto && <span title="Automatically logged" style={{ fontSize: '0.5rem', fontWeight: 800, color: '#2563eb', verticalAlign: 'super', marginLeft: 1 }}>A</span>}
              </button>
            </td>
          );
        })}
        {/* % completion + routine dropdown live on the far right. */}
        <td title={habitKpiTooltip(h, habitLog)} style={{ ...tdBase, borderLeft: `1px solid ${borderCol}`, textAlign: 'center', fontSize: '0.78rem', color: muted ? '#cbd5e1' : 'var(--color-text-muted)', cursor: 'help' }}>{pct != null ? `${pct}%` : ''}</td>
        <td style={{ ...tdBase, borderLeft: `1px solid ${borderCol}`, textAlign: 'center' }}>
          {!bulkMode && (
            <select
              value={groupKey}
              onChange={e => chooseRoutine(h.id, e.target.value)}
              title="Routine"
              style={{ fontSize: '0.7rem', padding: '2px 4px', borderRadius: 6, border: `1px solid ${borderCol}`, background: 'var(--color-surface, #fff)', color: 'var(--color-text-muted, #64748b)', maxWidth: '100%' }}
            >
              <option value="">No routine</option>
              {routineOptions.map(r => <option key={r} value={r}>{r}</option>)}
              <option value="__new__">＋ New routine…</option>
            </select>
          )}
        </td>
      </tr>
    );
  };

  const canon = cadenceCanon(cadenceName);
  const canEditNext = canon !== 'Daily'; // Weekly / Monthly / Annually can be scheduled
  // A saved recurrence object wins; otherwise fall back to the auto next-period.
  const rec = (canEditNext && nextLogOverride && typeof nextLogOverride === 'object') ? nextLogOverride : null;
  // Next date the user will need to log this cadence's habits.
  const nextLog = (() => {
    const today = new Date();
    if (rec) {
      const { date, dueNow } = nextRecurrenceDate(canon, rec, activeList, habitLog, uncompleted === 0);
      return { dueNow, date, isRecurring: true };
    }
    if (uncompleted > 0) return { dueNow: true, date: today, isRecurring: false };
    let d;
    if (canon === 'Weekly') { d = sundayOf(today); d.setDate(d.getDate() + 7); }
    else if (canon === 'Monthly') { d = new Date(today.getFullYear(), today.getMonth() + 1, 1); }
    else if (canon === 'Annually') { d = new Date(today.getFullYear() + 1, 0, 1); }
    else {
      d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      for (let i = 1; i <= 7; i++) {
        const cand = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        if (activeList.some(h => tracksDate(h, cand))) { d = cand; break; }
      }
    }
    return { dueNow: false, date: d, isRecurring: false };
  })();
  const nextLogLabel = nextLog.dueNow
    ? (nextLog.isRecurring ? 'Due now' : `Due ${periodHint(cadenceName).toLowerCase()}`)
    : `Next log: ${nextLog.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const nextLinkBtn = { border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: ACCENT, fontSize: '0.72rem', fontWeight: 700 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.5rem', position: 'sticky', top: 0, background: 'var(--color-background, #fff)', paddingBottom: 2, zIndex: 1 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: ACCENT, margin: 0 }}>{cadenceName}</h3>
        {uncompleted > 0 && (
          <span
            title={`${uncompleted} habit${uncompleted > 1 ? 's' : ''} still unlogged (${periodHint(cadenceName).toLowerCase()})`}
            style={{ minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px', background: '#dc2626', color: '#fff', fontSize: '0.72rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {uncompleted}
          </span>
        )}
      </div>
      {activeList.length > 0 && (
        <div style={{ margin: '-0.25rem 0 0.7rem 0.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: nextLog.dueNow ? '#dc2626' : 'var(--color-text-muted, #64748b)' }}>
              {nextLogLabel}
            </span>
            {rec && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>· {recurrenceSummary(canon, rec)}</span>}
            {canEditNext && !editingNext && (
              <button style={nextLinkBtn} onClick={() => { if (!rec) onSetNextLog(canon, defaultRec(canon)); setEditingNext(true); }}>
                {rec ? 'Edit schedule' : 'Set schedule'}
              </button>
            )}
            {canEditNext && rec && !editingNext && (
              <button style={{ ...nextLinkBtn, color: '#94a3b8' }} onClick={() => onSetNextLog(canon, '')}>Reset to auto</button>
            )}
          </div>
          {canEditNext && editingNext && rec && (
            <NextLogRecurrenceEditor
              canon={canon}
              rec={rec}
              onChange={patch => onSetNextLog(canon, { ...rec, ...patch })}
              onDone={() => setEditingNext(false)}
            />
          )}
        </div>
      )}
      {(
        <>
          {/* Bulk-edit toolbar: toggle select mode, then apply one mark to the
              whole selection (cells / columns / rows / groups). Every cadence
              (Daily / Weekly / Monthly / Annually) renders this same table. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setBulkMode(m => !m); clearSel(); }}
              style={{ cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700, padding: '0.3rem 0.7rem', borderRadius: 7, border: `1px solid ${bulkMode ? ACCENT : borderCol}`, background: bulkMode ? ACCENT + '14' : 'var(--color-surface, #fff)', color: bulkMode ? ACCENT : 'var(--color-text-muted, #64748b)' }}
            >
              {bulkMode ? '✓ Bulk editing' : '☰ Bulk edit'}
            </button>
            {bulkMode && (
              <>
                <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted, #64748b)' }}>{selected.size} selected</span>
                {MARK_ORDER.map(m => (
                  <button
                    key={m}
                    disabled={selected.size === 0}
                    onClick={() => applyBulk(m)}
                    title={`Set selection to “${MARK_META[m].label}”`}
                    style={{ cursor: selected.size ? 'pointer' : 'not-allowed', opacity: selected.size ? 1 : 0.4, fontSize: '0.74rem', fontWeight: 700, padding: '0.3rem 0.6rem', borderRadius: 7, border: `1px solid ${MARK_META[m].color}`, background: MARK_META[m].color + '14', color: MARK_META[m].color }}
                  >
                    {MARK_META[m].icon} {MARK_META[m].short}
                  </button>
                ))}
                <button
                  disabled={selected.size === 0}
                  onClick={() => applyBulk(null)}
                  title="Erase marks in selection"
                  style={{ cursor: selected.size ? 'pointer' : 'not-allowed', opacity: selected.size ? 1 : 0.4, fontSize: '0.74rem', fontWeight: 700, padding: '0.3rem 0.6rem', borderRadius: 7, border: `1px solid ${borderCol}`, background: 'var(--color-surface, #fff)', color: '#94a3b8' }}
                >⌫ Erase</button>
                {selected.size > 0 && <button onClick={clearSel} style={{ ...nextLinkBtn, color: '#94a3b8' }}>Clear</button>}
              </>
            )}
          </div>
          {bulkMode && (
            <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: '-0.25rem 0 0.5rem' }}>
              Tap cells to select. Click a week header for the whole column, a habit name for its row, or a routine heading for the group — then pick a mark above.
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', minWidth: totalTableWidth, fontSize: '0.8rem' }}>
              <colgroup>
                {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thBase, position: 'relative', textAlign: 'left' }}>
                    <span style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted, #64748b)' }}>Habit</span>
                    {colResizeHandle(0)}
                  </th>
                  {weekCols.map((w, wi) => (
                    <th
                      key={w.key}
                      onClick={bulkMode ? () => toggleColumn(w.key) : undefined}
                      title={`${w.fullLabel}${w.isCurrent ? ` · this ${periodNoun(canon)}` : w.isNext ? ` · next ${periodNoun(canon)} (upcoming)` : ''}${bulkMode ? ' · click to select column' : ''}`}
                      style={{ ...thBase, position: 'relative', textAlign: 'center', cursor: bulkMode ? 'pointer' : 'default', background: w.isCurrent ? ACCENT + '10' : thBase.background, borderLeft: `1px ${w.isNext ? 'dashed' : 'solid'} ${borderCol}` }}
                    >
                      <div style={{ fontSize: '0.66rem', fontWeight: 800, color: w.isCurrent ? ACCENT : (w.isNext ? '#94a3b8' : 'var(--color-text-muted, #64748b)') }}>{w.primary}</div>
                      <div style={{ fontSize: '0.62rem', fontWeight: 600, color: w.isCurrent ? ACCENT : '#a0aab8', whiteSpace: 'nowrap' }}>{w.shortLabel}</div>
                      {colResizeHandle(1 + wi)}
                    </th>
                  ))}
                  <th style={{ ...thBase, position: 'relative', textAlign: 'center', borderLeft: `1px solid ${borderCol}`, fontSize: '0.66rem', fontWeight: 700, color: 'var(--color-text-muted, #64748b)' }} title={`Completion over ${habitWindowLabel(canon)}`}>
                    %{colResizeHandle(1 + weekCols.length)}
                  </th>
                  <th style={{ ...thBase, position: 'relative', textAlign: 'center', borderLeft: `1px solid ${borderCol}`, fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted, #64748b)' }}>
                    Routine{colResizeHandle(2 + weekCols.length)}
                  </th>
                </tr>
              </thead>
              {subGroups.map(([routineKey, items]) => (
                <tbody key={routineKey || '__none__'}>
                  <tr>
                    <td
                      colSpan={3 + weekCols.length}
                      onClick={bulkMode ? () => toggleGroup(items) : undefined}
                      style={{ padding: '0.4rem 6px 0.15rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: routineKey ? ACCENT : '#94a3b8', cursor: bulkMode ? 'pointer' : 'default' }}
                    >
                      {routineKey || 'No routine'}{bulkMode && <span style={{ color: '#cbd5e1', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}> · select group</span>}
                    </td>
                  </tr>
                  {items.map(h => weeklyRow(h, false, routineKey, items))}
                </tbody>
              ))}
              {autoList.length > 0 && (
                <tbody>
                  <tr>
                    <td colSpan={3 + weekCols.length} style={{ padding: '0.55rem 6px 0.15rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8' }}>Automatic</td>
                  </tr>
                  {autoList.map(h => weeklyRow(h, true, (h.routine || '').trim(), autoList))}
                </tbody>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// On Hold tab: paused habits, kept off the Routines/Daily lists. "Resume"
// returns a habit to Not Started; the status dropdown can set any other status.
function OnHoldView({ habits, onUpdate }) {
  const onHold = useMemo(
    () => habits
      .filter(h => (h.status || '').trim() === ON_HOLD_STATUS)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [habits],
  );
  if (onHold.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>No habits on hold. Set a habit’s status to “On Hold” to park it here.</p>;
  }
  return (
    <div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginBottom: '0.8rem' }}>
        Habits set to On Hold are paused and hidden from your routines. Resume to bring one back (returns as “Not Started”).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {onHold.map(h => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.45rem 0.6rem', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8 }}>
            <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>{h.name || <em style={{ color: '#aaa' }}>untitled</em>}</span>
            {(h.routine || '').trim() && <span style={routineTag} title="Routine">{(h.routine || '').trim()}</span>}
            {(h.cadence || '').trim() && <span style={cadenceTag}>{h.cadence}</span>}
            <StatusSelect value={h.status} onChange={v => onUpdate(h.id, 'status', v)} />
            <button onClick={() => onUpdate(h.id, 'status', 'Not Started')} style={primaryBtn}>Resume</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Monthly "still automatic?" review — the habits you've marked "Automatically"
// run on autopilot, so they aren't logged day-to-day. This tab prompts you once
// a month to confirm each is still genuinely automatic, grouped by routine.
// Confirmation is stored per-habit as `autoConfirmedMonth` = 'YYYY-MM'; when it
// no longer matches the current month the box shows unchecked (needs a re-check),
// so every box naturally resets at the start of each month.
function AutoReviewView({ habits, onUpdate, onOpen }) {
  const currentMonth = periodKey('Monthly'); // 'YYYY-MM' in local time
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Automatic habits grouped by routine, routines in the canonical routine order.
  const groups = useMemo(() => {
    const auto = habits.filter(h => (h.status || '').trim() === 'Automatically');
    const map = new Map();
    for (const h of auto) {
      const key = (h.routine || '').trim() || 'Unsorted';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(h);
    }
    for (const list of map.values()) list.sort(compareByRoutine);
    return [...map.entries()].sort((a, b) => {
      const ra = routineRank(a[0]), rb = routineRank(b[0]);
      return ra.typeOrder - rb.typeOrder || ra.dailyIdx - rb.dailyIdx || ra.num - rb.num || a[0].localeCompare(b[0]);
    });
  }, [habits]);

  const autoCount = groups.reduce((n, [, list]) => n + list.length, 0);
  const pending = groups.reduce((n, [, list]) => n + list.filter(h => (h.autoConfirmedMonth || '') !== currentMonth).length, 0);

  if (autoCount === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>No automatic habits yet. Set a habit’s status to “Automatically” and it will show up here for a monthly check-in.</p>;
  }

  function toggle(h) {
    const confirmed = (h.autoConfirmedMonth || '') === currentMonth;
    onUpdate(h.id, 'autoConfirmedMonth', confirmed ? '' : currentMonth);
  }

  return (
    <div>
      {/* Prompt banner */}
      <div style={{ background: ACCENT + '0d', border: `1px solid ${ACCENT}33`, borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.05rem' }}>🔁</span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Monthly automatic check-in · {monthLabel}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
            Once a month, confirm each habit is still running on autopilot by checking its box. The boxes reset at the start of every month.
          </div>
        </div>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: pending === 0 ? '#166534' : '#b45309', background: pending === 0 ? '#dcfce7' : '#fef3c7', border: `1px solid ${pending === 0 ? '#bbf7d0' : '#fde68a'}`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
          {pending === 0 ? 'All confirmed ✓' : `${pending} to confirm`}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        {groups.map(([routine, list]) => (
          <div key={routine}>
            <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', margin: '0 0 0.4rem' }}>{routine}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map(h => {
                const confirmed = (h.autoConfirmedMonth || '') === currentMonth;
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.7rem', background: 'var(--color-surface, #fff)', border: `1px solid ${confirmed ? '#bbf7d0' : 'var(--color-border, #e2e8f0)'}`, borderRadius: 8 }}>
                    <input type="checkbox" checked={confirmed} onChange={() => toggle(h)} title="Confirm still automatic" style={{ width: 17, height: 17, cursor: 'pointer', accentColor: ACCENT, flexShrink: 0 }} />
                    <button
                      type="button"
                      onClick={() => onOpen(h.id)}
                      title="Edit habit"
                      style={{ flex: 1, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: 'inherit', fontFamily: 'inherit' }}
                    >
                      {h.name || <em style={{ color: '#aaa' }}>untitled</em>}
                    </button>
                    {(h.cadence || '').trim() && <span style={cadenceTag}>{h.cadence}</span>}
                    {confirmed
                      ? <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#16a34a', whiteSpace: 'nowrap' }}>Confirmed</span>
                      : <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#b45309', whiteSpace: 'nowrap' }}>Needs check</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Automatic habit tracking — the control panel where auto-logging rules are
// authored and external tools are connected. Rules persist to the user doc
// (`habitAutomations`); the engine that fires them is wired up separately, so
// this tab is intentionally a config + reference hub.
function AutomaticView({ habits, automations, habitLog = {}, habitLogAuto = {}, onChange }) {
  const [copied, setCopied] = useState(false);
  const sortedHabits = useMemo(
    () => [...habits].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [habits],
  );
  const rules = automations || [];
  const habitById = useMemo(() => new Map(habits.map(h => [h.id, h])), [habits]);

  function addRule() {
    const first = AUTO_TRIGGERS.prepday[0];
    onChange([...rules, {
      id: makeHabitId(), habitId: '', source: 'prepday', trigger: first.id,
      threshold: '', mark: 'done', enabled: true, logic: '',
    }]);
  }
  function updateRule(id, patch) {
    onChange(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRule(id) {
    onChange(rules.filter(r => r.id !== id));
  }
  // Switching source resets the trigger to that source's first option.
  function changeSource(id, source) {
    const first = (AUTO_TRIGGERS[source] || [])[0];
    updateRule(id, { source, trigger: first ? first.id : 'custom', threshold: '' });
  }
  function copyWebhook() {
    try {
      navigator.clipboard?.writeText(AUTO_WEBHOOK_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  const selectStyle = { ...fieldInput, width: 'auto', padding: '4px 6px', fontSize: '0.82rem' };
  const codeBox = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.76rem', background: 'var(--color-surface-alt, #f1f5f9)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 6, padding: '3px 7px', wordBreak: 'break-all' };
  const markChip = (m) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, color: MARK_META[m].color, background: MARK_META[m].color + '14', border: `1px solid ${MARK_META[m].color}55`, borderRadius: 999, padding: '2px 9px' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 920 }}>
      {/* Today's daily goals pulled from sibling apps (Rally + Gratitude). */}
      <ReachOutGoal heading />
      <GratitudeGoal heading />

      {/* How it works + status banner */}
      <div style={{ background: ACCENT + '0d', border: `1px solid ${ACCENT}33`, borderRadius: 10, padding: '0.85rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.05rem' }}>⚙️</span>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Automatic habit tracking</h3>
          <span style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#166534', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 999, padding: '2px 8px' }}>
            Prep Day rules live · hourly
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Define rules that mark a habit for you when something happens elsewhere. <strong>Prep Day-source rules
          run automatically every hour</strong> — e.g. log a workout and your “Exercise” habit gets marked for
          that day. The engine only fills an <em>empty</em> mark for the current period, so it never overwrites
          one you set by hand. Rules save to your account and sync to mobile.
          {' '}<strong>Apple Health</strong> and <strong>External/webhook</strong> rules are authored here but
          don’t fire yet (they need the Health bridge / webhook receiver). Tip: set a rule’s habit to the
          <strong> “Automatically” </strong> status so it reads as auto-managed in the routines.
        </p>
      </div>

      {/* Connections */}
      <div>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>Connections</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {AUTO_SOURCES.map(src => {
            const used = rules.filter(r => r.source === src.id).length;
            const status = (src.id === 'prepday' || src.id === 'rally' || src.id === 'gratitude')
              ? { label: 'Live · hourly', color: '#16a34a' }
              : src.id === 'healthkit'
                ? { label: 'Bridge pending', color: '#b45309' }
                : { label: 'Receiver pending', color: '#b45309' };
            return (
              <div key={src.id} style={{ border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 10, padding: '0.7rem 0.8rem', background: 'var(--color-surface, #fff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: '1.05rem' }}>{src.icon}</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>{src.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.66rem', fontWeight: 700, color: status.color, background: status.color + '18', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{status.label}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.45 }}>{src.blurb}</p>
                {src.id === 'external' && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={codeBox}>POST {AUTO_WEBHOOK_URL}</div>
                    <button onClick={copyWebhook} style={{ ...ghostBtn, alignSelf: 'flex-start', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>
                      {copied ? 'Copied ✓' : 'Copy endpoint'}
                    </button>
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{used} rule{used === 1 ? '' : 's'}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rules */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.6rem' }}>
          <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted)' }}>Rules</h4>
          <button onClick={addRule} style={{ ...primaryBtn, marginLeft: 'auto', padding: '0.4rem 0.8rem' }}>+ Add rule</button>
        </div>

        {rules.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            No automatic rules yet. Add one to describe when a habit should be marked for you.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rules.map(r => {
              const tdef = triggerDef(r.source, r.trigger);
              const isWebhook = r.source === 'external' && r.trigger === 'webhook';
              // Live status: this rule's habit and its mark for the current
              // reporting cycle (today / this week / month / year, per cadence).
              const habit = habitById.get(r.habitId);
              const curKey = habit ? periodKey(habit.cadence) : null;
              const curMark = curKey ? (habitLog[curKey] || {})[habit.id] : undefined;
              const cycleLabel = habit ? periodHint(habit.cadence) : ''; // Today / This week / ...
              const notYetLabel = cycleLabel === 'Today' ? 'today' : cycleLabel.toLowerCase();
              const autoSet = curKey ? isAutoMark(habitLogAuto, curKey, habit.id, curMark) : false;
              // Previous period alongside the current one (yesterday / last week / ...).
              const prevKey = habit ? prevPeriodKey(habit.cadence) : null;
              const prevMark = prevKey ? (habitLog[prevKey] || {})[habit.id] : undefined;
              const prevLabel = habit ? prevPeriodHint(habit.cadence) : '';
              const prevAutoSet = prevKey ? isAutoMark(habitLogAuto, prevKey, habit.id, prevMark) : false;
              return (
                <div key={r.id} style={{ border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 10, padding: '0.7rem 0.8rem', background: r.enabled ? 'var(--color-surface, #fff)' : 'var(--color-surface-alt, #f8fafc)', opacity: r.enabled ? 1 : 0.75 }}>
                  {/* Row 1: enable + habit + delete */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!r.enabled} onChange={e => updateRule(r.id, { enabled: e.target.checked })} />
                      {r.enabled ? 'On' : 'Off'}
                    </label>
                    <select value={r.habitId || ''} onChange={e => updateRule(r.id, { habitId: e.target.value })} style={{ ...selectStyle, fontWeight: 600, minWidth: 160 }}>
                      <option value="">— pick a habit —</option>
                      {sortedHabits.map(h => <option key={h.id} value={h.id}>{h.name || 'untitled'}</option>)}
                    </select>
                    <button onClick={() => removeRule(r.id)} title="Delete rule" style={{ marginLeft: 'auto', border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 8, padding: '0.25rem 0.6rem', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>Delete</button>
                  </div>

                  {/* Row 2: when <source> <trigger> [threshold] → mark <mark> */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>When</span>
                    <select value={r.source} onChange={e => changeSource(r.id, e.target.value)} style={selectStyle}>
                      {AUTO_SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    <select value={r.trigger} onChange={e => updateRule(r.id, { trigger: e.target.value, threshold: '' })} style={selectStyle}>
                      {(AUTO_TRIGGERS[r.source] || []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    {tdef?.numeric && (
                      <>
                        <input
                          type="number"
                          value={r.threshold ?? ''}
                          onChange={e => updateRule(r.id, { threshold: e.target.value })}
                          placeholder="0"
                          style={{ ...fieldInput, width: 80, padding: '4px 6px', fontSize: '0.82rem' }}
                        />
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{tdef.unit}</span>
                      </>
                    )}
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>→ mark</span>
                    <select value={r.mark} onChange={e => updateRule(r.id, { mark: e.target.value })} style={{ ...selectStyle, color: MARK_META[r.mark]?.color, fontWeight: 700 }}>
                      {MARK_ORDER.map(m => <option key={m} value={m}>{MARK_META[m].icon} {MARK_META[m].label}</option>)}
                    </select>
                    {/* Daily habits: what to mark when the trigger DIDN'T fire on a
                        day that's already over — e.g. a rest day (no workout) → Skip.
                        Never touches today; ignored for non-daily cadences. */}
                    {habit && cadenceCanon(habit.cadence) === 'Daily' && (
                      <>
                        <span
                          style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}
                          title="Applied to a past day when the trigger didn't fire — e.g. a rest day with no workout. Never marks today."
                        >· else →</span>
                        <select
                          value={r.elseMark || ''}
                          onChange={e => updateRule(r.id, { elseMark: e.target.value })}
                          style={{ ...selectStyle, color: r.elseMark ? MARK_META[r.elseMark]?.color : undefined, fontWeight: r.elseMark ? 700 : 400 }}
                        >
                          <option value="">— nothing</option>
                          {MARK_ORDER.map(m => <option key={m} value={m}>{MARK_META[m].icon} {MARK_META[m].label}</option>)}
                        </select>
                      </>
                    )}
                  </div>

                  {/* Row 2.5: live status — the habit's mark this cycle and the one before */}
                  {habit ? (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: '0.78rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>{cycleLabel}:</span>
                        {curMark ? (
                          <span style={markChip(curMark)}>
                            {MARK_META[curMark].icon} {MARK_META[curMark].label}
                            {autoSet && <AutoBadge title="Auto-logged by this rule" />}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>not yet marked {notYetLabel}</span>
                        )}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>{prevLabel}:</span>
                        {prevMark ? (
                          <span style={markChip(prevMark)}>
                            {MARK_META[prevMark].icon} {MARK_META[prevMark].label}
                            {prevAutoSet && <AutoBadge title="Auto-logged by this rule" />}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic' }}>Pick a habit to see its current status.</div>
                  )}

                  {/* Row 3: logic reference */}
                  <div style={{ marginTop: 8 }}>
                    <input
                      value={r.logic || ''}
                      onChange={e => updateRule(r.id, { logic: e.target.value })}
                      placeholder="Logic / notes — e.g. how the source maps to this mark, edge cases, which app sends it…"
                      style={{ ...fieldInput, fontSize: '0.8rem' }}
                    />
                  </div>

                  {isWebhook && (
                    <div style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                      External tools POST to <span style={codeBox}>{AUTO_WEBHOOK_URL}</span> with this rule key:{' '}
                      <span style={codeBox}>{r.id}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DailyView({ habits, habitLogAuto, markOf, onMark, onReorder }) {
  const [drag, setDrag] = useState(null); // { id, blockKey }
  const todayKey = dayKey(new Date());
  // Today's checklist — exclude daily habits that aren't tracked today (e.g. a
  // weekday-only habit on a Saturday).
  const daily = useMemo(() => habits
    .filter(h => routineType(h.routine) === 'daily' && !PARKED_STATUSES.includes((h.status || '').trim()) && tracksDate(h))
    .sort(compareByRoutine), [habits]);

  // Group into routine blocks (Morning / Lunch / …). Drag reorders within one.
  const blocks = useMemo(() => {
    const map = new Map();
    for (const h of daily) {
      const key = (h.routine || '').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(h);
    }
    return [...map.entries()];
  }, [daily]);

  const doneCount = daily.filter(h => markOf(h) === 'done').length;

  function handleDrop(targetId, blockKey, items) {
    const d = drag;
    setDrag(null);
    if (!d || d.blockKey !== blockKey || d.id === targetId) return;
    const ids = items.map(x => x.id);
    const from = ids.indexOf(d.id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
  }

  if (daily.length === 0) return <p style={{ color: 'var(--color-text-muted)' }}>No daily-routine habits yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>{doneCount}/{daily.length} done</span>
      </div>
      {blocks.map(([blockKey, items]) => (
        <div key={blockKey || '__none__'}>
          <h3 style={{ fontSize: '0.9rem', margin: '0.6rem 0 0.3rem', color: ACCENT }}>{blockKey || 'No routine'}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map(h => {
              const dragging = drag?.id === h.id;
              return (
                <div
                  key={h.id}
                  onDragOver={(e) => { if (drag && drag.blockKey === blockKey) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(h.id, blockKey, items); }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0.5rem 0.7rem', background: 'var(--color-surface, #fff)', border: `1px solid ${dragging ? ACCENT : 'var(--color-border, #e2e8f0)'}`, borderRadius: 8, opacity: dragging ? 0.45 : 1 }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span
                      draggable
                      onDragStart={(e) => { setDrag({ id: h.id, blockKey }); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => setDrag(null)}
                      title="Drag to reorder within this routine"
                      style={{ cursor: 'grab', color: '#cbd5e1', fontSize: '0.95rem', userSelect: 'none', paddingTop: 2 }}
                    >⠿</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                        {h.name}
                        {isAutoMark(habitLogAuto, todayKey, h.id, markOf(h)) && <AutoBadge />}
                      </div>
                      {(h.cue || h.response || h.reward) && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                          {h.cue && <><strong>Cue:</strong> {h.cue}. </>}
                          {h.response && <><strong>Do:</strong> {h.response}. </>}
                          {h.reward && <><strong>Reward:</strong> {h.reward}.</>}
                        </div>
                      )}
                    </div>
                    <StatusChip status={h.status} />
                  </div>
                  <DayTracker value={markOf(h)} onSet={m => onMark(h, m)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Yes / Skip / No tracker. Tapping the active mark again clears it.
function DayTracker({ value, onSet }) {
  const btn = (m) => {
    const meta = MARK_META[m];
    const active = value === m;
    return (
      <button
        key={m}
        type="button"
        onClick={() => onSet(m)}
        style={{
          flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          padding: '6px 8px', borderRadius: 7, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700,
          border: `1px solid ${active ? meta.color : 'var(--color-border, #e2e8f0)'}`,
          background: active ? meta.color : 'var(--color-surface, #fff)',
          color: active ? '#fff' : meta.color,
        }}
      >
        <span aria-hidden>{meta.icon}</span>{meta.short}
      </button>
    );
  };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {btn('exceeded')}
      {btn('done')}
      {btn('skipped')}
      {btn('missed')}
    </div>
  );
}

// Monday of the ISO week containing d (local date, time stripped).
function startOfISOWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay() || 7; // Sun=7
  date.setDate(date.getDate() - (day - 1));
  return date;
}
function daysInMonth(y, m /* 0-based */) { return new Date(y, m + 1, 0).getDate(); }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Columns for the History grid: Daily→7 days of a week, Weekly→ISO weeks of a
// month, Monthly→12 months of a year, Annually→a 6-year window. Each column key
// is the same period key habitLog is stored under, so cells are a direct lookup.
function historyColumns(sel, anchor, weeks = 1) {
  if (sel === 'Daily') {
    const n = Math.max(1, weeks || 1);
    const total = 7 * n + 1; // +1 leading day = the previous Sunday (8-day view)
    const start = startOfISOWeek(anchor);
    start.setDate(start.getDate() - 1); // back up to the previous Sunday
    const cols = [];
    for (let i = 0; i < total; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      // Weekday label from the actual date (WEEKDAY_ABBR is Mon-indexed) since
      // the strip now starts on Sunday, not Monday.
      cols.push({ key: dayKey(d), label: WEEKDAY_ABBR[(d.getDay() + 6) % 7], sub: String(d.getDate()) });
    }
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + total - 1);
    const label = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    return { cols, label };
  }
  if (sel === 'Weekly') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const seen = new Map();
    for (let day = 1; day <= daysInMonth(y, m); day++) {
      const d = new Date(y, m, day);
      const key = weekKey(d);
      if (!seen.has(key)) {
        const sun = sundayOf(d); // Sun–Sat weeks: label by the week's Sunday
        seen.set(key, { key, label: `W${key.slice(6)}`, sub: `${sun.getMonth() + 1}/${sun.getDate()}` });
      }
    }
    return { cols: [...seen.values()], label: anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  }
  if (sel === 'Monthly') {
    const y = anchor.getFullYear();
    const cols = MONTH_ABBR.map((label, i) => ({ key: `${y}-${pad2(i + 1)}`, label }));
    return { cols, label: String(y) };
  }
  // Annually: a 6-year window ending at the anchor year.
  const y = anchor.getFullYear();
  const N = 6;
  const cols = Array.from({ length: N }, (_, i) => { const yr = y - (N - 1) + i; return { key: String(yr), label: String(yr) }; });
  return { cols, label: `${y - (N - 1)} – ${y}` };
}

function shiftHistoryAnchor(sel, anchor, dir, weeks = 1) {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (sel === 'Daily') d.setDate(d.getDate() + 7 * Math.max(1, weeks) * dir);
  else if (sel === 'Weekly') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir); // Monthly + Annually step by year
  return d;
}

const HISTORY_CADENCES = [
  { id: 'Daily', label: 'Daily', view: 'weekly view' },
  { id: 'Weekly', label: 'Weekly', view: 'monthly view' },
  { id: 'Monthly', label: 'Monthly', view: 'yearly view' },
  { id: 'Annually', label: 'Annual', view: 'yearly view' },
];

// Map a cell value (yes/no/skip/gold or ✓/✕/⏭/★ and common synonyms) to a mark.
function parseMarkValue(v) {
  const x = (v || '').trim().toLowerCase();
  if (!x) return undefined;
  if (['gold', '★', 'star', 'above', 'exceeded', 'above & beyond', 'a&b', '++', 'great'].includes(x)) return 'exceeded';
  if (['yes', 'y', 'done', 'did', 'true', '1', '✓', '✔', 'x'].includes(x)) return 'done';
  if (['skip', 'skipped', 's', '⏭', '-', '–'].includes(x)) return 'skipped';
  if (['no', 'n', 'missed', 'miss', 'false', '0', '✕', '✗'].includes(x)) return 'missed';
  return undefined;
}

// Parse a date cell into a YYYY-MM-DD key (handles ISO, M/D/YY, M/D/YYYY, etc.).
function parseDateKey(s) {
  const t = (s || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const mo = +m[1], da = +m[2];
    const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${yr}-${pad2(mo)}-${pad2(da)}`;
  }
  const d = new Date(t);
  if (!isNaN(d.getTime())) return dayKey(d);
  return null;
}

// Parse pasted Excel history (dates down the first column, habit names across
// the header row) into a habitLog patch keyed by each habit's period. Returns
// the patch plus a small summary for user feedback.
// Inspect the pasted text: the habit-column headers (after the date column)
// and how many valid date rows follow. Used to render the column-mapping UI.
function parseHistoryHeader(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: 0 };
  const columns = lines[0].split('\t').slice(1).map(h => (h || '').trim());
  let rows = 0;
  for (let i = 1; i < lines.length; i++) { if (parseDateKey(lines[i].split('\t')[0])) rows++; }
  return { columns, rows };
}

// Auto-match each column header to a habit id by (normalized) name.
function autoMapColumns(columns, habits) {
  const nameToId = new Map();
  for (const h of habits) { const n = (h.name || '').trim().toLowerCase(); if (n) nameToId.set(n, h.id); }
  return columns.map(c => nameToId.get((c || '').trim().toLowerCase()) || '');
}

// Build the habitLog patch using an explicit column→habitId mapping (''=ignore).
function buildHistoryIncoming(text, habits, mapping) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
  const habitById = new Map(habits.map(h => [h.id, h]));
  const incoming = {};
  let marks = 0;
  const dateSet = new Set();
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split('\t');
    const dk = parseDateKey(cells[0]);
    if (!dk) continue;
    const [y, mo, da] = dk.split('-').map(Number);
    const dateObj = new Date(y, mo - 1, da);
    for (let c = 0; c < mapping.length; c++) {
      const habit = habitById.get(mapping[c]);
      if (!habit) continue;
      const mark = parseMarkValue(cells[c + 1]);
      if (!mark) continue;
      const key = periodKey(habit.cadence, dateObj);
      if (!incoming[key]) incoming[key] = {};
      incoming[key][habit.id] = mark;
      marks++;
      dateSet.add(dk);
    }
  }
  return { incoming, marks, dates: dateSet.size };
}

// One habit row in the History grid. `isAuto` habits ("Automatically" status)
// get a greyed background and, for any period they weren't explicitly logged,
// a faint assumed-done checkmark (up to the current period — future cells stay
// blank). Cells remain clickable to override the assumption.
function renderHistoryRow(h, isAuto, cols, currentKey, habitLog, openMenu, autoTracked = false, autoStatusFor = () => '') {
  const rowBg = isAuto ? '#f8fafc' : undefined;
  return (
    <tr key={h.id} style={{ borderTop: '1px solid #eef2f6', background: rowBg }}>
      <td style={{ ...histNameTd, background: isAuto ? '#f1f5f9' : '#fff', color: isAuto ? 'var(--color-text-muted)' : undefined }} title={h.name}>
        {h.name || <em style={{ color: '#aaa' }}>untitled</em>}
        {autoTracked && <AutoNameBadge />}
      </td>
      {cols.map(c => {
        const mk = habitLog[c.key] ? habitLog[c.key][h.id] : undefined;
        const assumeDone = isAuto && !mk && c.key <= currentKey;
        // For auto-tracked habits, hover shows why the cell was / wasn't recorded.
        const autoTip = autoStatusFor(h.id, c.key, mk);
        return (
          <td
            key={c.key}
            onClick={() => openMenu(h.id, c.key, `${h.name || 'Habit'} · ${periodLabel(c.key)}`)}
            title={autoTip || 'Edit'}
            style={{ ...histCellTd, cursor: 'pointer', background: c.key === currentKey ? ACCENT + '0a' : rowBg }}
          >
            {mk
              ? <span title={MARK_META[mk].label} style={{ color: MARK_META[mk].color, fontWeight: 800, fontSize: '0.9rem' }}>{MARK_META[mk].icon}</span>
              : assumeDone
                ? <span title="Automatic — assumed done" style={{ color: MARK_META.done.color, opacity: 0.4, fontWeight: 800, fontSize: '0.9rem' }}>{MARK_META.done.icon}</span>
                : <span style={{ color: '#d1d5db' }}>·</span>}
          </td>
        );
      })}
    </tr>
  );
}

// History tab: all-time totals on top, then a per-cadence calendar grid
// (habits × sub-periods) you can page back through. Daily habits show a week of
// days, weekly habits a month of weeks, monthly habits a year of months, annual
// habits a span of years. Cells are clickable (open the day menu); historical
// data can be imported from Excel.
function HistoryView({ habitLog, habits, onImport, openMenu, autoTrackedIds = new Set(), autoStatusFor = () => '' }) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);
  // Column → habit-id mapping ('' = ignore). Auto-filled by name, editable.
  const [mapping, setMapping] = useState([]);

  const { columns, rows: dateRows } = useMemo(() => parseHistoryHeader(importText), [importText]);
  const colSig = columns.join('');
  // Re-auto-match whenever the header line changes (keystrokes that don't touch
  // the header keep the user's manual mapping edits).
  useEffect(() => {
    setMapping(autoMapColumns(colSig ? colSig.split('') : [], habits));
    setImportResult(null);
  }, [colSig, habits]);

  // Habit options for the mapping dropdowns, by name.
  const habitOptions = useMemo(
    () => habits.filter(h => (h.name || '').trim()).sort((a, b) => a.name.localeCompare(b.name)),
    [habits],
  );

  function runImport() {
    const res = buildHistoryIncoming(importText, habits, mapping);
    if (res.marks > 0) onImport(res.incoming);
    setImportResult(res);
  }
  const totals = useMemo(() => {
    const t = { exceeded: 0, done: 0, skipped: 0, missed: 0 };
    for (const k in habitLog) for (const id in habitLog[k]) { const mk = habitLog[k][id]; if (t[mk] != null) t[mk]++; }
    return t;
  }, [habitLog]);
  const loggedIds = useMemo(() => {
    const s = new Set();
    for (const k in habitLog) for (const id in habitLog[k]) s.add(id);
    return s;
  }, [habitLog]);

  const [sel, setSel] = useState('Daily');
  const [anchor, setAnchor] = useState(() => new Date());
  // How many weeks the Daily grid shows at once (1 / 2 / 4). Only applies to
  // the Daily cadence; other cadences ignore it.
  const [weeksN, setWeeksN] = useState(1);
  const dailyWeeks = sel === 'Daily' ? weeksN : 1;

  const { cols, label } = useMemo(() => historyColumns(sel, anchor, dailyWeeks), [sel, anchor, dailyWeeks]);
  const currentKey = periodKey(sel); // highlight the in-progress period

  // Rows = habits tracked at the selected cadence. For Daily that means an
  // explicit Daily cadence OR any logged daily entry (so we don't dump every
  // un-cadenced habit into the grid); weekly/monthly/annual are explicit.
  const rows = useMemo(
    () => habits
      .filter(h => !PARKED_STATUSES.includes((h.status || '').trim())) // hide parked (On Hold + Abandoned) from History
      .filter(h => cadenceCanon(h.cadence) === sel && ((h.cadence || '').trim() || loggedIds.has(h.id)))
      .sort(compareByRoutine),
    [habits, sel, loggedIds],
  );
  // "Automatically" habits are established — they run on autopilot and aren't
  // logged, so we assume a checkmark for each period and park them in a greyed
  // group below the actively-tracked habits.
  const manualRows = useMemo(() => rows.filter(h => h.status !== 'Automatically'), [rows]);
  const autoRows = useMemo(() => rows.filter(h => h.status === 'Automatically'), [rows]);

  if (loggedIds.size === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>No habit logs yet. Mark habits as Did it / Skip / No on the Routines or Daily Routine tab and they'll show up here.</p>;
  }

  const viewName = HISTORY_CADENCES.find(c => c.id === sel)?.view;

  return (
    <div>
      {/* All-time totals + import */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.1rem', alignItems: 'center' }}>
        {MARK_ORDER.map(m => (
          <div key={m} style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 12, padding: '0.85rem 1.1rem', minWidth: 100 }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: MARK_META[m].color, lineHeight: 1 }}>{totals[m]}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{MARK_META[m].label}</div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => { setImportResult(null); setImportOpen(true); }} style={ghostBtn}>Import from Excel</button>
      </div>

      {/* Cadence selector — picks which habits + which calendar window. */}
      <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 10, padding: 3, width: 'fit-content', marginBottom: '0.4rem' }}>
        {HISTORY_CADENCES.map(c => {
          const active = sel === c.id;
          return (
            <button
              key={c.id}
              onClick={() => { setSel(c.id); setAnchor(new Date()); }}
              style={{
                cursor: 'pointer', padding: '0.35rem 0.9rem', borderRadius: 8,
                fontSize: '0.82rem', fontWeight: 600, border: 'none',
                background: active ? 'var(--color-surface, #fff)' : 'transparent',
                color: active ? ACCENT : 'var(--color-text-muted, #64748b)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>{sel} tracking · {viewName}</p>

      {/* Window navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.6rem' }}>
        <button onClick={() => setAnchor(a => shiftHistoryAnchor(sel, a, -1, dailyWeeks))} style={navBtn} title="Previous">‹</button>
        <strong style={{ fontSize: '0.95rem', minWidth: 150, textAlign: 'center' }}>{label}</strong>
        <button onClick={() => setAnchor(a => shiftHistoryAnchor(sel, a, 1, dailyWeeks))} style={navBtn} title="Next">›</button>
        <button onClick={() => setAnchor(new Date())} style={{ ...ghostBtn, padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}>Today</button>
        {sel === 'Daily' && (
          <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: 3, marginLeft: 'auto' }}>
            {[1, 2, 4].map(n => {
              const active = weeksN === n;
              return (
                <button
                  key={n}
                  onClick={() => setWeeksN(n)}
                  title={`Show ${n} week${n > 1 ? 's' : ''}`}
                  style={{
                    cursor: 'pointer', padding: '0.25rem 0.6rem', borderRadius: 6,
                    fontSize: '0.76rem', fontWeight: 700, border: 'none',
                    background: active ? 'var(--color-surface, #fff)' : 'transparent',
                    color: active ? ACCENT : 'var(--color-text-muted, #64748b)',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  {n}w
                </button>
              );
            })}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No {sel.toLowerCase()} habits tracked yet. Set a habit's cadence to {sel} in its popup, or log it on the Routines tab.</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={histNameTh}>Habit</th>
                {cols.map(c => (
                  <th key={c.key} style={{ ...histColTh, background: c.key === currentKey ? ACCENT + '14' : '#f8fafc' }}>
                    <div>{c.label}</div>
                    {c.sub && <div style={{ fontSize: '0.62rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>{c.sub}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {manualRows.map(h => renderHistoryRow(h, false, cols, currentKey, habitLog, openMenu, autoTrackedIds.has(h.id), autoStatusFor))}
              {autoRows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={cols.length + 1} style={{ ...histNameTd, position: 'static', background: '#f1f5f9', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', padding: '0.35rem 0.6rem', maxWidth: 'none', whiteSpace: 'nowrap' }}>
                      Automatic · assumed done
                    </td>
                  </tr>
                  {autoRows.map(h => renderHistoryRow(h, true, cols, currentKey, habitLog, openMenu, autoTrackedIds.has(h.id), autoStatusFor))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && (
        <div style={overlay} onClick={() => setImportOpen(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.5rem' }}>Import history from Excel</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 0.6rem', lineHeight: 1.45 }}>
              Paste cells with <strong>dates down the first column</strong> and <strong>habit names across the top row</strong>.
              Cell values: <code>yes</code> / <code>no</code> / <code>skip</code> / <code>gold</code> (or ✓ / ✕ / ⏭ / ★); blanks are ignored.
              Then check the column mapping below before importing. Imported values merge into your log (overwriting only the same habit+date).
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={'Date\tMeditation\tFlossing\n2026-06-01\tyes\tno\n2026-06-02\tgold\tyes'}
              style={{ width: '100%', height: 120, fontFamily: 'monospace', fontSize: '0.78rem', padding: '0.5rem', borderRadius: 8, border: '1px solid #ccc', boxSizing: 'border-box' }}
            />

            {columns.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: '0.85rem' }}>Column mapping</strong>
                  <span style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                    {dateRows} date row{dateRows !== 1 ? 's' : ''} · {mapping.filter(Boolean).length}/{columns.length} mapped
                  </span>
                </div>
                <div style={{ maxHeight: 230, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8, padding: 8 }}>
                  {columns.map((col, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: '0.82rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col}>
                        {col || <em style={{ color: '#aaa' }}>(blank)</em>}
                      </span>
                      <span style={{ color: mapping[i] ? '#16a34a' : '#cbd5e1' }}>→</span>
                      <select
                        value={mapping[i] || ''}
                        onChange={e => setMapping(m => m.map((v, idx) => (idx === i ? e.target.value : v)))}
                        style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', padding: '4px 6px', borderRadius: 6, border: `1px solid ${mapping[i] ? '#cbd5e1' : '#fca5a5'}`, background: '#fff' }}
                      >
                        <option value="">— Ignore —</option>
                        {habitOptions.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importResult && (
              <p style={{ fontSize: '0.82rem', margin: '0.6rem 0 0', color: importResult.marks > 0 ? '#16a34a' : '#dc2626' }}>
                {importResult.marks > 0
                  ? `Imported ${importResult.marks} mark${importResult.marks > 1 ? 's' : ''} across ${importResult.dates} date${importResult.dates > 1 ? 's' : ''}.`
                  : 'Nothing imported — check the date column and that at least one column is mapped.'}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button onClick={() => setImportOpen(false)} style={ghostBtn}>Close</button>
              <button onClick={runImport} style={primaryBtn} disabled={!dateRows || mapping.every(v => !v)}>Import</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }) {
  const s = (status || '').trim();
  const color = s === 'Automatically' ? '#16a34a'
    : s === 'Most Days' ? '#65a30d'
    : s === 'Some Days' ? '#ca8a04'
    : s === 'Rarely' ? '#ea580c'
    : s === 'Abandoned' ? '#dc2626'
    : '#64748b';
  if (!s) return null;
  return (
    <span style={{ fontSize: '0.72rem', fontWeight: 700, color, background: color + '18', border: `1px solid ${color}40`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{s}</span>
  );
}

const SELECT_FILTER_COLS = ['routine', 'status', 'age'];

// Fields that make sense to set across many habits at once. Deliberately
// excludes name + the long Atomic-Habits text fields (bulk-setting those would
// just clobber per-habit content).
const BULK_FIELDS = [
  { key: 'status', label: 'Status' },
  { key: 'routine', label: 'Routine' },
  { key: 'cadence', label: 'Cadence' },
  { key: 'dailyOrder', label: 'Daily Routine #' },
  { key: 'age', label: 'Age' },
  { key: 'startDate', label: 'Start Date' },
  { key: 'kpi', label: 'KPI' },
];

function HabitsTable({ habits, onUpdate, onDelete, onOpen, onBulkUpdate, onBulkDelete }) {
  const [visibleCols, setVisibleCols] = useState(() => {
    try { const raw = localStorage.getItem('sunday-habits-cols'); if (raw) return new Set(JSON.parse(raw)); } catch { /* default below */ }
    return new Set(HABIT_FIELDS.map(f => f.key));
  });
  const [colsOpen, setColsOpen] = useState(false);
  // Filter row is shown by default; remembers the user's last choice.
  const [showFilters, setShowFilters] = useState(() => {
    try { const v = localStorage.getItem('sunday-habits-showfilters'); return v == null ? true : v === '1'; } catch { return true; }
  });
  const [filters, setFilters] = useState({});
  // Click-to-sort, persisted across visits. key=null → default routine
  // grouping. Clicking a header cycles asc → desc → back to default.
  const [sort, setSort] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem('sunday-habits-sort'));
      if (p && (p.key === null || typeof p.key === 'string') && (p.dir === 'asc' || p.dir === 'desc')) return p;
    } catch { /* default below */ }
    return { key: null, dir: 'asc' };
  });
  // Bulk edit: a Set of selected habit ids + the field/value to apply.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkField, setBulkField] = useState('status');
  const [bulkValue, setBulkValue] = useState('');
  // Per-column widths (px), drag-resized from the header. Overrides COL_WIDTH.
  const [colWidths, setColWidths] = useState(() => {
    try { const raw = localStorage.getItem('sunday-habits-colwidths'); if (raw) return JSON.parse(raw) || {}; } catch { /* default below */ }
    return {};
  });
  useEffect(() => {
    try { localStorage.setItem('sunday-habits-colwidths', JSON.stringify(colWidths)); } catch { /* ignore */ }
  }, [colWidths]);
  const widthOf = (key) => colWidths[key] || COL_WIDTH[key] || 120;
  // Drag a header's right edge to resize its column; persists via the effect above.
  function startResize(e, key) {
    e.preventDefault();
    e.stopPropagation(); // don't trigger the header's sort click
    const startX = e.clientX;
    const startW = widthOf(key);
    const onMove = (ev) => setColWidths(prev => ({ ...prev, [key]: Math.max(50, startW + (ev.clientX - startX)) }));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function toggleCol(key) {
    const wasVisible = visibleCols.has(key);
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem('sunday-habits-cols', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    if (wasVisible) setFilters(prev => { if (!(key in prev)) return prev; const n = { ...prev }; delete n[key]; return n; });
  }
  function setFilter(key, value) {
    setFilters(prev => { const n = { ...prev }; if (value) n[key] = value; else delete n[key]; return n; });
  }
  function toggleSort(key) {
    setSort(prev => {
      let next;
      if (prev.key !== key) next = { key, dir: 'asc' };
      else if (prev.dir === 'asc') next = { key, dir: 'desc' };
      else next = { key: null, dir: 'asc' }; // third click → back to default routine order
      try { localStorage.setItem('sunday-habits-sort', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function toggleShowFilters() {
    setShowFilters(s => {
      const next = !s;
      try { localStorage.setItem('sunday-habits-showfilters', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  const cols = HABIT_FIELDS.filter(f => visibleCols.has(f.key));
  // Checkbox col (34) + each field's width + delete col (40). Drives fixed layout.
  const totalWidth = 34 + cols.reduce((s, f) => s + widthOf(f.key), 0) + 40;

  const distinct = useMemo(() => {
    const d = {};
    for (const key of SELECT_FILTER_COLS) {
      d[key] = Array.from(new Set(habits.map(h => (h[key] || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    }
    return d;
  }, [habits]);

  const routineOptions = useMemo(
    () => Array.from(new Set([...DAILY_ROUTINES, ...habits.map(h => (h.routine || '').trim()).filter(Boolean)])),
    [habits],
  );

  const sorted = useMemo(() => {
    const base = [...habits];
    if (!sort.key) return base.sort(compareByRoutine);
    const { key, dir } = sort;
    const mul = dir === 'desc' ? -1 : 1;
    return base.sort((a, b) => {
      const av = (a[key] ?? '').toString().trim();
      const bv = (b[key] ?? '').toString().trim();
      // Blank cells always sink to the bottom, regardless of sort direction.
      if (av === '' && bv === '') return 0;
      if (av === '') return 1;
      if (bv === '') return -1;
      const an = parseFloat(av), bn = parseFloat(bv);
      const bothNum = !isNaN(an) && !isNaN(bn) && /^-?[\d.]/.test(av) && /^-?[\d.]/.test(bv);
      if (bothNum) return (an - bn) * mul;
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * mul;
    });
  }, [habits, sort]);
  const filtered = useMemo(() => sorted.filter(h => {
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      const cell = (h[k] || '').toString().toLowerCase();
      if (SELECT_FILTER_COLS.includes(k)) { if (cell !== v.toLowerCase()) return false; }
      else if (!cell.includes(v.toLowerCase())) return false;
    }
    return true;
  }), [sorted, filters]);

  // --- Selection helpers (operate on the currently filtered rows) ---
  const allSelected = filtered.length > 0 && filtered.every(h => selectedIds.has(h.id));
  const someSelected = filtered.some(h => selectedIds.has(h.id));
  function toggleOne(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach(h => next.delete(h.id));
      else filtered.forEach(h => next.add(h.id));
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }
  function applyBulk() {
    if (selectedIds.size === 0) return;
    onBulkUpdate(selectedIds, bulkField, bulkValue);
  }
  function deleteBulk() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} habit${selectedIds.size > 1 ? 's' : ''}? This can't be undone.`)) return;
    onBulkDelete(selectedIds);
    clearSelection();
  }

  // Value control for the bulk bar — a dropdown for status/cadence, a
  // datalist-backed input for routine, a plain input otherwise.
  const bulkValueControl = () => {
    if (bulkField === 'status') {
      return (
        <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} style={bulkCtrl}>
          <option value="">— (clear)</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      );
    }
    if (bulkField === 'cadence') {
      return (
        <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} style={bulkCtrl}>
          <option value="">— (clear)</option>
          {CADENCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      );
    }
    return (
      <input
        value={bulkValue}
        onChange={e => setBulkValue(e.target.value)}
        list={bulkField === 'routine' ? 'habit-routine-options' : undefined}
        placeholder="new value…"
        style={bulkCtrl}
      />
    );
  };

  const cellInput = (h, f) => {
    const listId = f.key === 'status' ? 'habit-status-options' : f.key === 'routine' ? 'habit-routine-options' : undefined;
    return (
      <input
        value={h[f.key] || ''}
        onChange={e => onUpdate(h.id, f.key, e.target.value)}
        list={listId}
        style={{ width: '100%', minWidth: 0, border: '1px solid transparent', background: 'transparent', borderRadius: 4, padding: '4px 5px', fontSize: '0.8rem', boxSizing: 'border-box' }}
        onFocus={e => { e.target.style.border = '1px solid #cbd5e1'; e.target.style.background = '#fff'; }}
        onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
      />
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setColsOpen(o => !o)} style={ghostBtn}>Columns ▾</button>
          {colsOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 8, minWidth: 190 }}>
              {HABIT_FIELDS.map(f => (
                <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleCols.has(f.key)} onChange={() => toggleCol(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button onClick={toggleShowFilters} style={showFilters ? primaryBtn : ghostBtn}>Filter</button>
        {Object.keys(filters).length > 0 && <button onClick={() => setFilters({})} style={ghostBtn}>Clear filters</button>}
        {Object.keys(colWidths).length > 0 && <button onClick={() => setColWidths({})} style={ghostBtn} title="Reset all column widths to default">Reset widths</button>}
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{filtered.length} of {habits.length}</span>
      </div>

      {/* Status color legend — matches the row tint / left edge. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.9rem', marginBottom: 8 }}>
        {Object.entries(STATUS_COLOR).map(([label, color]) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* Bulk-edit bar — appears once any rows are selected. */}
      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap', background: ACCENT + '12', border: `1px solid ${ACCENT}40`, borderRadius: 8, padding: '0.5rem 0.7rem' }}>
          <strong style={{ fontSize: '0.85rem', color: ACCENT }}>{selectedIds.size} selected</strong>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Set</span>
          <select
            value={bulkField}
            onChange={e => { setBulkField(e.target.value); setBulkValue(''); }}
            style={bulkCtrl}
          >
            {BULK_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>to</span>
          {bulkValueControl()}
          <button onClick={applyBulk} style={primaryBtn}>Apply</button>
          <span style={{ width: 1, height: 22, background: ACCENT + '40' }} />
          <button onClick={deleteBulk} style={{ ...ghostBtn, color: '#dc2626', borderColor: '#fca5a5' }}>Delete</button>
          <button onClick={clearSelection} style={ghostBtn}>Clear selection</button>
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 10 }}>
        <datalist id="habit-status-options">{STATUS_OPTIONS.map(s => <option key={s} value={s} />)}</datalist>
        <datalist id="habit-routine-options">{routineOptions.map(s => <option key={s} value={s} />)}</datalist>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: totalWidth, minWidth: totalWidth }}>
          <colgroup>
            <col style={{ width: 34 }} />
            {cols.map(f => <col key={f.key} style={{ width: widthOf(f.key) }} />)}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...th, width: 34, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll}
                  title="Select all (filtered)"
                />
              </th>
              {cols.map(f => {
                const active = sort.key === f.key;
                return (
                  <th
                    key={f.key}
                    style={{ ...th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    onClick={() => toggleSort(f.key)}
                    title="Click to sort — click again to reverse, once more to clear"
                  >
                    {f.label}
                    <span style={{ color: active ? ACCENT : '#cbd5e1', marginLeft: 4 }}>
                      {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                    <span
                      onMouseDown={e => startResize(e, f.key)}
                      onClick={e => e.stopPropagation()}
                      title="Drag to resize this column"
                      style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 8, cursor: 'col-resize' }}
                    />
                  </th>
                );
              })}
              <th style={th} />
            </tr>
            {showFilters && (
              <tr>
                <th style={{ ...th, background: '#fff', position: 'static' }} />
                {cols.map(f => (
                  <th key={f.key} style={{ ...th, background: '#fff', position: 'static', padding: '2px 4px' }}>
                    {SELECT_FILTER_COLS.includes(f.key) ? (
                      <select value={filters[f.key] || ''} onChange={e => setFilter(f.key, e.target.value)} style={filterCtrl}>
                        <option value="">All</option>
                        {distinct[f.key].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : (
                      <input value={filters[f.key] || ''} onChange={e => setFilter(f.key, e.target.value)} placeholder="filter…" style={filterCtrl} />
                    )}
                  </th>
                ))}
                <th style={{ ...th, background: '#fff', position: 'static' }} />
              </tr>
            )}
          </thead>
          <tbody>
            {filtered.map(h => {
              const isSel = selectedIds.has(h.id);
              const sc = statusColor(h.status);
              return (
              <tr key={h.id} style={{ borderTop: '1px solid #eef2f6', background: isSel ? ACCENT + '0d' : (sc ? sc + '12' : undefined) }}>
                <td style={{ ...td, textAlign: 'center', borderLeft: `3px solid ${sc || 'transparent'}` }}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleOne(h.id)} />
                </td>
                {cols.map(f => (
                  <td key={f.key} style={td}>
                    {f.key === 'name' ? (
                      <button onClick={() => onOpen(h.id)} title="Open habit" style={nameBtn}>
                        <span>{h.name || <em style={{ color: '#aaa' }}>untitled</em>}</span>
                        {(h.cadence || '').trim() && <span style={cadenceTag}>{h.cadence}</span>}
                      </button>
                    ) : cellInput(h, f)}
                  </td>
                ))}
                <td style={td}>
                  <button onClick={() => onDelete(h.id)} title="Delete" style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1rem', padding: '0 6px' }}>×</button>
                </td>
              </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={cols.length + 2} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>{habits.length === 0 ? 'No habits yet — add one or paste from your sheet.' : 'No habits match the filters.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Full habit editor popup. Opened by clicking a habit's name on the Habits
// tab. Every edit persists immediately via onUpdate (which saves to Firestore).
// The headline control is the tracking-cadence selector.
function HabitDetailModal({ habit, onUpdate, onDelete, onClose, autoSkipOn = false, onToggleAutoSkip }) {
  const h = habit;
  const cadence = (h.cadence || '').trim();
  const field = (key, label, opts = {}) => (
    <label style={fieldWrap}>
      <span style={fieldLabel}>{label}</span>
      {opts.textarea ? (
        <textarea
          value={h[key] || ''}
          onChange={e => onUpdate(h.id, key, e.target.value)}
          rows={opts.rows || 2}
          style={fieldTextarea}
        />
      ) : (
        <input value={h[key] || ''} onChange={e => onUpdate(h.id, key, e.target.value)} style={fieldInput} />
      )}
    </label>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
          <input
            value={h.name || ''}
            onChange={e => onUpdate(h.id, 'name', e.target.value)}
            placeholder="Habit name"
            style={{ flex: 1, fontSize: '1.15rem', fontWeight: 700, border: 'none', borderBottom: '2px solid var(--color-border, #e2e8f0)', padding: '4px 2px', outline: 'none', background: 'transparent' }}
          />
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: '1.5rem', lineHeight: 1, cursor: 'pointer', color: 'var(--color-text-muted)' }}>×</button>
        </div>

        {/* Tracking cadence — the core of this popup */}
        <div style={{ marginBottom: '1.1rem' }}>
          <div style={{ ...fieldLabel, marginBottom: 6 }}>Tracking cadence</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CADENCE_OPTIONS.map(opt => {
              const selected = cadence.toLowerCase() === opt.toLowerCase();
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onUpdate(h.id, 'cadence', selected ? '' : opt)}
                  style={{
                    padding: '0.5rem 1rem', borderRadius: 999, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                    border: `1px solid ${selected ? ACCENT : 'var(--color-border, #e2e8f0)'}`,
                    background: selected ? ACCENT : 'var(--color-surface, #fff)',
                    color: selected ? '#fff' : 'var(--color-text-muted, #64748b)',
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        {/* Days tracked — only for Daily habits (unset cadence counts as daily).
            Lets you limit a habit to certain weekdays, e.g. not on weekends. */}
        {cadenceCanon(cadence) === 'Daily' && (
          <div style={{ marginBottom: '1.1rem' }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>Days tracked</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[{ wd: 1, l: 'Mon' }, { wd: 2, l: 'Tue' }, { wd: 3, l: 'Wed' }, { wd: 4, l: 'Thu' }, { wd: 5, l: 'Fri' }, { wd: 6, l: 'Sat' }, { wd: 0, l: 'Sun' }].map(({ wd, l }) => {
                const on = habitTrackDays(h).includes(wd);
                return (
                  <button
                    key={wd}
                    type="button"
                    onClick={() => {
                      const set = new Set(habitTrackDays(h));
                      if (set.has(wd)) { if (set.size <= 1) return; set.delete(wd); } else set.add(wd);
                      const arr = [...set].sort((a, b) => a - b);
                      // Store [] (the "all days" default) when every day is on, so
                      // the field only persists a real restriction.
                      onUpdate(h.id, 'trackDays', arr.length === 7 ? [] : arr);
                    }}
                    style={{
                      minWidth: 46, padding: '0.45rem 0.6rem', borderRadius: 999, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                      border: `1px solid ${on ? ACCENT : 'var(--color-border, #e2e8f0)'}`,
                      background: on ? ACCENT : 'var(--color-surface, #fff)',
                      color: on ? '#fff' : 'var(--color-text-muted, #64748b)',
                    }}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              Untracked days (e.g. weekends) don't count toward completion and don't show a reminder.
            </div>
          </div>
        )}

        {/* Auto-skip rest days — one-tap wrapper over the Automatic engine's
            workout rule. Daily habits only (the rest-day skip is per-day). */}
        {cadenceCanon(cadence) === 'Daily' && onToggleAutoSkip && (
          <div style={{ marginBottom: '1.1rem' }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>Workout tracking</div>
            <button
              type="button"
              onClick={() => onToggleAutoSkip(!autoSkipOn)}
              aria-pressed={autoSkipOn}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                width: '100%', padding: '0.6rem 0.8rem', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${autoSkipOn ? '#16a34a' : 'var(--color-border, #e2e8f0)'}`,
                background: autoSkipOn ? '#16a34a14' : 'var(--color-surface, #fff)',
                fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text)', textAlign: 'left',
              }}
            >
              <span>🏋️ Auto-skip rest days</span>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                color: autoSkipOn ? '#fff' : 'var(--color-text-muted)',
                background: autoSkipOn ? '#16a34a' : 'var(--color-surface-alt, #f1f5f9)',
                border: `1px solid ${autoSkipOn ? '#16a34a' : 'var(--color-border, #e2e8f0)'}`,
                borderRadius: 999, padding: '2px 10px',
              }}>{autoSkipOn ? 'On' : 'Off'}</span>
            </button>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              Marks this habit <strong>Skip</strong> on a finished day with no workout logged, and <strong>Did it</strong> on days you work out. Runs hourly, never changes today. Adds a rule you can fine-tune on the Automatic tab.
            </div>
          </div>
        )}

        {/* Status + meta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.4rem' }}>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Status</span>
            <StatusSelect value={h.status} onChange={v => onUpdate(h.id, 'status', v)} />
          </label>
          {field('routine', 'Routine')}
          {field('dailyOrder', 'Daily Routine #')}
          {field('startDate', 'Start Date')}
          {field('age', 'Age')}
          {field('kpi', 'KPI')}
        </div>

        {/* Atomic Habits breakdown */}
        {field('cue', 'Cue / Trigger', { textarea: true })}
        {field('cue2', '2nd Cue', { textarea: true })}
        {field('craving', 'Craving', { textarea: true })}
        {field('response', 'Response', { textarea: true })}
        {field('reward', 'Reward', { textarea: true })}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.1rem' }}>
          <button
            onClick={() => { if (window.confirm('Delete this habit?')) onDelete(h.id); }}
            style={{ border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 8, padding: '0.45rem 0.85rem', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Delete
          </button>
          <button onClick={onClose} style={primaryBtn}>Done</button>
        </div>
      </div>
    </div>
  );
}

const COL_WIDTH = {
  kpi: 56, routine: 90, dailyOrder: 70, name: 160, cue: 220, cue2: 160,
  craving: 240, response: 220, reward: 200, age: 80, status: 120, startDate: 96,
};

// Row color-coding for the Habits table, by status — most-active (green) down
// to retired (red). Legacy/unknown statuses get no tint.
const STATUS_COLOR = {
  'Automatically': '#16a34a',
  'Most Days': '#65a30d',
  'Some Days': '#d97706',
  'Rarely': '#ea580c',
  'On Hold': '#64748b',
  'Not Started': '#94a3b8',
  'Abandoned': '#dc2626',
};
const statusColor = (status) => STATUS_COLOR[(status || '').trim()] || null;

const th = { textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted, #64748b)', padding: '0.5rem 0.5rem', background: '#f8fafc', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const td = { padding: '1px 2px', verticalAlign: 'top', overflow: 'hidden' };
const filterCtrl = { width: '100%', minWidth: 70, fontSize: '0.72rem', padding: '3px 4px', border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box', fontWeight: 400, textTransform: 'none', letterSpacing: 0 };
const bulkCtrl = { fontSize: '0.82rem', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', minWidth: 130 };
const routineIconBtn = { border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9rem', padding: '2px 4px', lineHeight: 1, opacity: 0.7 };
const navBtn = { border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, color: ACCENT, fontWeight: 700 };
const histNameTh = { ...th, position: 'sticky', left: 0, zIndex: 2, minWidth: 150, background: '#f8fafc' };
const histColTh = { textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-secondary, #475569)', padding: '0.4rem 0.3rem', minWidth: 40, whiteSpace: 'nowrap' };
const histNameTd = { position: 'sticky', left: 0, zIndex: 1, background: '#fff', fontSize: '0.82rem', fontWeight: 600, padding: '0.45rem 0.6rem', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 150 };
const histCellTd = { textAlign: 'center', padding: '0.4rem 0.3rem', borderLeft: '1px solid #f1f5f9' };
const backBtn = { border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.85rem' };
const ghostBtn = { border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.45rem 0.85rem', cursor: 'pointer', fontSize: '0.85rem' };
const primaryBtn = { border: 'none', background: '#111', color: '#fff', borderRadius: 8, padding: '0.45rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 };
const modal = { background: '#fff', borderRadius: 12, padding: '1.1rem 1.25rem', width: 'min(94vw, 560px)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' };
const nameBtn = { width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid transparent', background: 'transparent', borderRadius: 4, padding: '4px 5px', fontSize: '0.8rem', fontWeight: 600, color: ACCENT, cursor: 'pointer' };
const cadenceTag = { fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: ACCENT, background: ACCENT + '14', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap' };
// Subtle label showing a habit's named routine (the Routines tab now groups by
// cadence, so the routine name is shown per-row instead of as a section header).
const routineTag = { fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-muted, #64748b)', background: 'var(--color-surface-alt, #f1f5f9)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' };
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: '0.6rem' };
const fieldLabel = { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted, #64748b)' };
const fieldInput = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 6, padding: '5px 7px', fontSize: '0.85rem' };
const fieldTextarea = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 6, padding: '5px 7px', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' };
