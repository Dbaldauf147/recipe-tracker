import { useEffect, useMemo, useState } from 'react';
import { saveField, loadField } from '../utils/firestoreSync';
import { HABIT_FIELDS, seedHabits, makeHabitId } from '../data/habitsSeed';

// Personal habit tracker (Atomic Habits: Cue → Craving → Response → Reward).
// Gated to baldaufdan@gmail.com in App.jsx. Data lives on the user doc under
// `habits`. Four sub-tabs: KPI (stats), Routines (grouped), Daily Routine
// (ordered daily checklist), Habits (the full editable table + paste import).

const SUB_TABS = [
  { id: 'kpi', label: 'KPI' },
  { id: 'routines', label: 'Routines' },
  { id: 'daily', label: 'Daily Routine' },
  { id: 'history', label: 'History' },
  { id: 'habits', label: 'Habits' },
];

const DAILY_ROUTINES = ['Morning', 'Lunch', 'Afternoon', 'After Work', 'Bedtime'];
const STATUS_OPTIONS = ['Automatically', 'Most Days', 'Some Days', 'Rarely', 'On Hold', 'Not Started', 'Abandoned'];
// Tracking cadence chosen per-habit in the habit popup. Stored on the habit as
// `cadence` (NOT part of HABIT_FIELDS, so the paste-from-sheet column mapping
// stays aligned to the spreadsheet).
const CADENCE_OPTIONS = ['Daily', 'Weekly', 'Monthly', 'Annually'];
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
function compareByRoutine(a, b) {
  const ra = routineRank(a.routine), rb = routineRank(b.routine);
  if (ra.typeOrder !== rb.typeOrder) return ra.typeOrder - rb.typeOrder;
  if (ra.dailyIdx !== rb.dailyIdx) return ra.dailyIdx - rb.dailyIdx;
  if (ra.num !== rb.num) return ra.num - rb.num;
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

function cadenceCanon(c) {
  const x = (c || '').trim().toLowerCase();
  if (x === 'weekly') return 'Weekly';
  if (x === 'monthly') return 'Monthly';
  if (x === 'annually') return 'Annually';
  return 'Daily';
}

function periodKey(cadence, date = new Date()) {
  switch (cadenceCanon(cadence)) {
    case 'Weekly': return isoWeekKey(date);
    case 'Monthly': return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    case 'Annually': return String(date.getFullYear());
    default: return dayKey(date);
  }
}

function periodHint(cadence) {
  switch (cadenceCanon(cadence)) {
    case 'Weekly': return 'This week';
    case 'Monthly': return 'This month';
    case 'Annually': return 'This year';
    default: return 'Today';
  }
}

function periodStart(key) {
  if (/^\d{4}-W\d{2}$/.test(key)) {
    const y = +key.slice(0, 4), w = +key.slice(6);
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week1Mon = jan4.getTime() - (jan4Day - 1) * 86400000;
    return week1Mon + (w - 1) * 7 * 86400000;
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

const MARK_META = {
  done: { label: 'Did it', color: '#16a34a', icon: '✓' },
  skipped: { label: 'Skip', color: '#64748b', icon: '⏭' },
  missed: { label: 'No', color: '#dc2626', icon: '✕' },
};

export function HabitsPage({ onBack, user }) {
  const [habits, setHabits] = useState([]);
  const [habitLog, setHabitLog] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('routines');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  // Which habit's detail popup is open (by id). Derived from habits each render
  // so edits/deletes keep the popup in sync.
  const [openHabitId, setOpenHabitId] = useState(null);
  const openHabit = openHabitId ? habits.find(h => h.id === openHabitId) || null : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [remote, remoteLog] = await Promise.all([
          user?.uid ? loadField(user.uid, 'habits') : null,
          user?.uid ? loadField(user.uid, 'habitLog') : null,
        ]);
        if (cancelled) return;
        if (Array.isArray(remote) && remote.length > 0) setHabits(remote);
        else setHabits(seedHabits());
        if (remoteLog && typeof remoteLog === 'object') setHabitLog(remoteLog);
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
  function updateHabit(id, key, value) {
    persist(habits.map(h => (h.id === id ? { ...h, [key]: value } : h)));
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

  // Bulk import: paste straight from Google Sheets (tab-separated). A first
  // row that looks like the header (starts with "KPI") is skipped.
  function runImport(mode) {
    const lines = importText.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i].split('\t');
      if (i === 0 && /^kpi$/i.test((cells[0] || '').trim())) continue; // header
      // Need at least a habit name (4th column) to be a real row.
      if (!(cells[3] || '').trim() && !(cells[0] || '').trim()) continue;
      const o = { id: makeHabitId() };
      HABIT_FIELDS.forEach((f, idx) => { o[f.key] = (cells[idx] || '').trim(); });
      rows.push(o);
    }
    if (rows.length === 0) { setImportOpen(false); return; }
    persist(mode === 'replace' ? rows : [...habits, ...rows]);
    setImportText('');
    setImportOpen(false);
    setTab('habits');
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading habits…</div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 0.5rem 3rem' }}>
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
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '0.55rem 1rem', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: '0.9rem', fontWeight: 600,
              color: tab === t.id ? ACCENT : 'var(--color-text-muted, #64748b)',
              borderBottom: tab === t.id ? `2px solid ${ACCENT}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'kpi' && <KpiView habits={habits} />}
      {tab === 'routines' && <RoutinesView habits={habits} onUpdate={updateHabit} markOf={markOf} onMark={onMark} />}
      {tab === 'daily' && <DailyView habits={habits} markOf={markOf} onMark={onMark} />}
      {tab === 'history' && <HistoryView habitLog={habitLog} habits={habits} />}
      {tab === 'habits' && (
        <HabitsTable habits={habits} onUpdate={updateHabit} onDelete={deleteHabit} onOpen={setOpenHabitId} />
      )}

      {openHabit && (
        <HabitDetailModal
          habit={openHabit}
          onUpdate={updateHabit}
          onDelete={(id) => { deleteHabit(id); setOpenHabitId(null); }}
          onClose={() => setOpenHabitId(null)}
        />
      )}

      {importOpen && (
        <div style={overlay} onClick={() => setImportOpen(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.5rem' }}>Paste from spreadsheet</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 0.6rem' }}>
              Select the rows in Google Sheets (columns in this order: KPI, Routine, Daily Routine, Habit, Cue, 2nd Cue, Craving, Response, Reward, Age, Status, Start Date) and paste. A header row is skipped automatically.
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="Paste tab-separated rows here…"
              style={{ width: '100%', height: 200, fontFamily: 'monospace', fontSize: '0.78rem', padding: '0.5rem', borderRadius: 8, border: '1px solid #ccc', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button onClick={() => setImportOpen(false)} style={ghostBtn}>Cancel</button>
              <button onClick={() => runImport('append')} style={ghostBtn} disabled={!importText.trim()}>Append</button>
              <button onClick={() => runImport('replace')} style={primaryBtn} disabled={!importText.trim()}>Replace all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiView({ habits }) {
  const stats = useMemo(() => {
    const byStatus = {};
    const byType = { daily: 0, weekly: 0, monthly: 0, other: 0, unsorted: 0 };
    let pctSum = 0, pctCount = 0;
    for (const h of habits) {
      const st = (h.status || '—').trim() || '—';
      byStatus[st] = (byStatus[st] || 0) + 1;
      byType[routineType(h.routine)]++;
      const p = pctOf(h.kpi);
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
  }, [habits]);

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

function RoutinesView({ habits, onUpdate, markOf, onMark }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const h of habits) {
      const key = (h.routine || '').trim() || '— Unsorted';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(h);
    }
    const order = (name) => {
      const t = routineType(name === '— Unsorted' ? '' : name);
      const base = { daily: 0, weekly: 1, monthly: 2, other: 3, unsorted: 4 }[t];
      const di = DAILY_ROUTINES.indexOf(name);
      return [base, di < 0 ? 50 : di, name];
    };
    return [...map.entries()].sort((a, b) => {
      const oa = order(a[0]), ob = order(b[0]);
      return oa[0] - ob[0] || oa[1] - ob[1] || String(oa[2]).localeCompare(String(ob[2]));
    });
  }, [habits]);

  // One sub-tab per routine. Track the selection by routine name; derive the
  // active group each render so a routine vanishing (after an edit/import)
  // gracefully falls back to the first one instead of showing nothing.
  const [activeRoutine, setActiveRoutine] = useState(null);
  const selected = groups.find(g => g[0] === activeRoutine) || groups[0];

  if (groups.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>No habits yet — add some on the Habits tab.</p>;
  }

  const [routineName, list] = selected;

  return (
    <div>
      {/* Per-routine sub-tabs (horizontally scrollable when there are many). */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: '0.85rem' }}>
        {groups.map(([routine]) => {
          const active = routine === routineName;
          return (
            <button
              key={routine}
              onClick={() => setActiveRoutine(routine)}
              style={{
                flex: '0 0 auto', whiteSpace: 'nowrap', cursor: 'pointer',
                padding: '0.4rem 0.8rem', borderRadius: 999,
                fontSize: '0.85rem', fontWeight: 600,
                border: `1px solid ${active ? ACCENT : 'var(--color-border, #e2e8f0)'}`,
                background: active ? ACCENT : 'var(--color-surface, #fff)',
                color: active ? '#fff' : 'var(--color-text-muted, #64748b)',
              }}
            >
              {routine}
            </button>
          );
        })}
      </div>

      {(() => {
        const isAuto = h => (h.status || '').trim() === 'Automatically';
        const activeList = list.filter(h => !isAuto(h));
        const autoList = list.filter(isAuto);

        const row = (h, muted) => (
          <div key={h.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0.4rem 0.6rem', background: muted ? 'transparent' : 'var(--color-surface, #fff)', border: `1px solid ${muted ? '#eef2f6' : 'var(--color-border, #e2e8f0)'}`, borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600, color: muted ? '#94a3b8' : 'inherit' }}>{h.name || <em style={{ color: '#aaa' }}>untitled</em>}</span>
              {(h.cadence || '').trim() && <span style={cadenceTag}>{h.cadence}</span>}
              <StatusSelect value={h.status} muted={muted} onChange={v => onUpdate(h.id, 'status', v)} />
              <span style={{ width: 42, textAlign: 'right', fontSize: '0.8rem', color: muted ? '#cbd5e1' : 'var(--color-text-muted)' }}>{pctOf(h.kpi) != null ? `${pctOf(h.kpi)}%` : ''}</span>
            </div>
            {/* Automatic (greyed) habits are established — no need to log them. */}
            {!muted && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 70, fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted, #64748b)' }}>{periodHint(h.cadence)}</span>
                <DayTracker value={markOf(h)} onSet={m => onMark(h, m)} />
              </div>
            )}
          </div>
        );

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {activeList.map(h => row(h, false))}
            {autoList.length > 0 && (
              <>
                <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', margin: '0.9rem 0 0.1rem' }}>Automatic</h4>
                {autoList.map(h => row(h, true))}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function DailyView({ habits, markOf, onMark }) {
  const daily = useMemo(() => {
    return habits
      .filter(h => routineType(h.routine) === 'daily')
      .sort((a, b) => {
        const ka = dailyOrderKey(a), kb = dailyOrderKey(b);
        return ka[0] - kb[0] || ka[1] - kb[1];
      });
  }, [habits]);

  const rows = useMemo(() => daily.map((h, i) => {
    const block = (h.routine || '').trim();
    const prevBlock = i > 0 ? (daily[i - 1].routine || '').trim() : null;
    return { h, block, showHeader: block !== prevBlock };
  }), [daily]);

  const doneCount = daily.filter(h => markOf(h) === 'done').length;

  if (daily.length === 0) return <p style={{ color: 'var(--color-text-muted)' }}>No daily-routine habits yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>{doneCount}/{daily.length} done</span>
      </div>
      {rows.map(({ h, block, showHeader }) => {
        return (
          <div key={h.id}>
            {showHeader && <h3 style={{ fontSize: '0.9rem', margin: '0.6rem 0 0.3rem', color: ACCENT }}>{block}</h3>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0.5rem 0.7rem', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ width: 26, fontWeight: 800, color: ACCENT, fontSize: '0.85rem' }}>{h.dailyOrder || '·'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{h.name}</div>
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
          </div>
        );
      })}
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
        <span aria-hidden>{meta.icon}</span>{meta.label}
      </button>
    );
  };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {btn('done')}
      {btn('skipped')}
      {btn('missed')}
    </div>
  );
}

// Logged history grouped by period, most recent first.
function HistoryView({ habitLog, habits }) {
  const nameById = useMemo(() => {
    const m = new Map();
    habits.forEach(h => m.set(h.id, h));
    return m;
  }, [habits]);

  const { periods, totals } = useMemo(() => {
    const keys = Object.keys(habitLog).filter(k => habitLog[k] && Object.keys(habitLog[k]).length > 0);
    keys.sort((a, b) => periodStart(b) - periodStart(a));
    const t = { done: 0, skipped: 0, missed: 0 };
    for (const k of keys) for (const mark of Object.values(habitLog[k])) t[mark] = (t[mark] || 0) + 1;
    return { periods: keys, totals: t };
  }, [habitLog]);

  if (periods.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>No habit logs yet. Mark habits as Did it / Skip / No on the Routines or Daily Routine tab and they'll show up here.</p>;
  }

  const ORDER = ['done', 'skipped', 'missed'];

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {ORDER.map(m => (
          <div key={m} style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 12, padding: '0.85rem 1.1rem', minWidth: 110 }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: MARK_META[m].color, lineHeight: 1 }}>{totals[m]}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{MARK_META[m].label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {periods.map(key => {
          const entries = Object.entries(habitLog[key]).sort((a, b) => {
            const oa = ORDER.indexOf(a[1]), ob = ORDER.indexOf(b[1]);
            if (oa !== ob) return oa - ob;
            return (nameById.get(a[0])?.name || '').localeCompare(nameById.get(b[0])?.name || '');
          });
          return (
            <div key={key}>
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.4rem', color: ACCENT }}>{periodLabel(key)}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {entries.map(([hid, mark]) => {
                  const meta = MARK_META[mark];
                  return (
                    <div key={hid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.4rem 0.6rem', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 8 }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: meta.color, background: meta.color + '18', border: `1px solid ${meta.color}40`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{meta.icon} {meta.label}</span>
                      <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>{nameById.get(hid)?.name || <em style={{ color: '#aaa' }}>(deleted habit)</em>}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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

function HabitsTable({ habits, onUpdate, onDelete, onOpen }) {
  const [visibleCols, setVisibleCols] = useState(() => {
    try { const raw = localStorage.getItem('sunday-habits-cols'); if (raw) return new Set(JSON.parse(raw)); } catch { /* default below */ }
    return new Set(HABIT_FIELDS.map(f => f.key));
  });
  const [colsOpen, setColsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({});

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

  const cols = HABIT_FIELDS.filter(f => visibleCols.has(f.key));

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

  const sorted = useMemo(() => [...habits].sort(compareByRoutine), [habits]);
  const filtered = useMemo(() => sorted.filter(h => {
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      const cell = (h[k] || '').toString().toLowerCase();
      if (SELECT_FILTER_COLS.includes(k)) { if (cell !== v.toLowerCase()) return false; }
      else if (!cell.includes(v.toLowerCase())) return false;
    }
    return true;
  }), [sorted, filters]);

  const cellInput = (h, f) => {
    const listId = f.key === 'status' ? 'habit-status-options' : f.key === 'routine' ? 'habit-routine-options' : undefined;
    return (
      <input
        value={h[f.key] || ''}
        onChange={e => onUpdate(h.id, f.key, e.target.value)}
        list={listId}
        style={{ width: '100%', minWidth: COL_WIDTH[f.key] || 120, border: '1px solid transparent', background: 'transparent', borderRadius: 4, padding: '4px 5px', fontSize: '0.8rem', boxSizing: 'border-box' }}
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
        <button onClick={() => setShowFilters(s => !s)} style={showFilters ? primaryBtn : ghostBtn}>Filter</button>
        {Object.keys(filters).length > 0 && <button onClick={() => setFilters({})} style={ghostBtn}>Clear filters</button>}
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{filtered.length} of {habits.length}</span>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 10 }}>
        <datalist id="habit-status-options">{STATUS_OPTIONS.map(s => <option key={s} value={s} />)}</datalist>
        <datalist id="habit-routine-options">{routineOptions.map(s => <option key={s} value={s} />)}</datalist>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: cols.length * 130 + 40 }}>
          <thead>
            <tr>
              {cols.map(f => <th key={f.key} style={th}>{f.label}</th>)}
              <th style={th} />
            </tr>
            {showFilters && (
              <tr>
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
            {filtered.map(h => (
              <tr key={h.id} style={{ borderTop: '1px solid #eef2f6' }}>
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
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={cols.length + 1} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>{habits.length === 0 ? 'No habits yet — add one or paste from your sheet.' : 'No habits match the filters.'}</td></tr>
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
function HabitDetailModal({ habit, onUpdate, onDelete, onClose }) {
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

const th = { textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted, #64748b)', padding: '0.5rem 0.5rem', background: '#f8fafc', whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const td = { padding: '1px 2px', verticalAlign: 'top' };
const filterCtrl = { width: '100%', minWidth: 70, fontSize: '0.72rem', padding: '3px 4px', border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box', fontWeight: 400, textTransform: 'none', letterSpacing: 0 };
const backBtn = { border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.85rem' };
const ghostBtn = { border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.45rem 0.85rem', cursor: 'pointer', fontSize: '0.85rem' };
const primaryBtn = { border: 'none', background: '#111', color: '#fff', borderRadius: 8, padding: '0.45rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 };
const modal = { background: '#fff', borderRadius: 12, padding: '1.1rem 1.25rem', width: 'min(94vw, 560px)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' };
const nameBtn = { width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid transparent', background: 'transparent', borderRadius: 4, padding: '4px 5px', fontSize: '0.8rem', fontWeight: 600, color: ACCENT, cursor: 'pointer' };
const cadenceTag = { fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: ACCENT, background: ACCENT + '14', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap' };
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: '0.6rem' };
const fieldLabel = { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-muted, #64748b)' };
const fieldInput = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 6, padding: '5px 7px', fontSize: '0.85rem' };
const fieldTextarea = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 6, padding: '5px 7px', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' };
