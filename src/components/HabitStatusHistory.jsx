/**
 * Habits → KPI: how many habits sat at each status, week by week, as stacked
 * bars. The weekly reading is taken in App.jsx on every visit (see
 * utils/habitStatusHistory.js); this draws it, with the current week always
 * shown live from the habits on screen.
 *
 * Legend and tooltip are hand-rolled: Recharts sorts its own alphabetically,
 * which would disagree with the stack.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { auth } from '../firebase';
import { loadField, listFullBackups, readBackupValue } from '../utils/firestoreSync';
import {
  STATUS_HISTORY_FIELD, statusSnapshot, upsertWeek, orderedStatuses, statusHistoryColor,
  formatWeekLabel, backupsToBackfill, backfilledRow, mergeMissingWeeks, recordHabitStatusSnapshot,
  habitsWithStatus, backupForWeek,
  STATUS_CHART_PREFS_FIELD, normalizeChartPrefs, loadChartPrefsLocal, saveChartPrefs,
} from '../utils/habitStatusHistory';
import { HabitStatusList } from './HabitStatusList';

const RANGES = [{ key: 12, label: '12 weeks' }, { key: 26, label: '26 weeks' }, { key: 0, label: 'All' }];

function StatusTooltip({ active, payload, statuses, colors, hiddenCount }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.78rem', boxShadow: '0 4px 12px rgba(15,23,42,0.08)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        Week of {formatWeekLabel(row.week, { year: true })}{row.live ? ' · this week' : row.source === 'backup' ? ' · from backup' : ''}
      </div>
      {/* Top of the stack first, so the list reads in the same order as the bar. */}
      {[...statuses].reverse().filter(s => row[s] > 0).map(s => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: statusHistoryColor(s, colors) }} />
          <span style={{ flex: 1 }}>{s}</span>
          <strong>{row[s]}</strong>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 4, paddingTop: 4, display: 'flex' }}>
        <span style={{ flex: 1 }}>{hiddenCount ? 'Shown' : 'Total'}</span><strong>{row.shownTotal}</strong>
      </div>
      {hiddenCount > 0 && row.shownTotal !== row.total && (
        <div style={{ display: 'flex', color: '#94a3b8' }}>
          <span style={{ flex: 1 }}>All statuses</span><span>{row.total}</span>
        </div>
      )}
    </div>
  );
}

export function HabitStatusHistory({ habits, onOpen }) {
  const uid = auth.currentUser?.uid;
  const [history, setHistory] = useState([]);
  const [range, setRange] = useState(12);
  const [backfill, setBackfill] = useState(null); // null | { busy, message }
  // A clicked segment: { week, status, live }. Past weeks only stored counts, so
  // the habits behind one are read from that week's newest backup.
  const [sel, setSel] = useState(null);
  const [selPast, setSelPast] = useState(null); // { key, loading, error, habits, date }
  const currentById = useMemo(() => new Map(habits.map(h => [h.id, h])), [habits]);
  // Which statuses are drawn, and in what colour — saved as the default.
  const [prefs, setPrefs] = useState(loadChartPrefsLocal);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadField(uid, STATUS_CHART_PREFS_FIELD)
      .then(v => { if (!cancelled && v) setPrefs(normalizeChartPrefs(v)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uid]);
  // A colour picker fires on every drag step, so the save waits for it to settle.
  // Leaving the page flushes a save still waiting rather than dropping it.
  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  const flushSave = () => {
    clearTimeout(saveTimer.current);
    if (pendingSave.current) { saveChartPrefs(pendingSave.current.prefs, pendingSave.current.uid); pendingSave.current = null; }
  };
  const updatePrefs = next => {
    const clean = normalizeChartPrefs(next);
    setPrefs(clean);
    pendingSave.current = { prefs: clean, uid };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 500);
  };
  useEffect(() => flushSave, []);
  const hiddenSet = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);
  const toggleStatus = s => {
    const hidden = hiddenSet.has(s) ? prefs.hidden.filter(x => x !== s) : [...prefs.hidden, s];
    if (sel?.status === s) setSel(null);
    updatePrefs({ ...prefs, hidden });
  };
  const setColor = (s, hex) => updatePrefs({ ...prefs, colors: { ...prefs.colors, [s]: hex } });

  useEffect(() => {
    if (!sel || sel.live || !uid) { setSelPast(null); return; }
    const key = sel.week;
    let cancelled = false;
    setSelPast(p => (p?.key === key && !p.error ? p : { key, loading: true }));
    (async () => {
      try {
        const backup = backupForWeek(await listFullBackups(uid), key);
        if (!backup) throw new Error('No backup was taken that week, so its habits can’t be listed.');
        const snap = await readBackupValue(uid, backup.id, ['habits']);
        if (!Array.isArray(snap)) throw new Error('That week’s backup has no habits in it.');
        if (!cancelled) setSelPast({ key, habits: snap, date: backup.date });
      } catch (err) {
        if (!cancelled) setSelPast({ key, error: err?.message || String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [sel?.week, sel?.live, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadField(uid, STATUS_HISTORY_FIELD)
      .then(v => { if (!cancelled && Array.isArray(v)) setHistory(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uid]);

  // Keep the stored row in step with edits made on this page, too.
  useEffect(() => {
    if (!uid || !habits.length) return;
    recordHabitStatusSnapshot(habits, uid)
      .then(h => { if (h) setHistory(h); })
      .catch(() => {});
  }, [uid, habits]);

  // This week is always drawn from the habits on screen, not the last write.
  const series = useMemo(() => {
    const live = habits.length ? { ...statusSnapshot(habits), live: true } : null;
    const rows = live ? upsertWeek(history, live) : history;
    return range ? rows.slice(-range) : rows;
  }, [history, habits, range]);

  const statuses = useMemo(
    () => orderedStatuses(series.flatMap(r => Object.keys(r.counts || {}))),
    [series],
  );
  const shown = useMemo(() => statuses.filter(s => !hiddenSet.has(s)), [statuses, hiddenSet]);
  const data = useMemo(
    () => series.map(r => ({
      ...r, ...r.counts, label: formatWeekLabel(r.week),
      // The label on top of a bar counts only what's drawn, so it matches its height.
      shownTotal: shown.reduce((n, s) => n + ((r.counts || {})[s] || 0), 0),
    })),
    [series, shown],
  );

  async function runBackfill() {
    if (!uid) return;
    if (!window.confirm('Rebuild the weeks before tracking started?\n\nThis reads your daily backups — one per week — and counts the statuses each snapshot held. Weeks already recorded are left alone. It can take a minute.')) return;
    setBackfill({ busy: true, message: 'Looking for backups…' });
    try {
      const stored = await loadField(uid, STATUS_HISTORY_FIELD);
      const base = Array.isArray(stored) ? stored : [];
      const todo = backupsToBackfill(await listFullBackups(uid), base);
      const rows = [];
      for (let i = 0; i < todo.length; i++) {
        const { week, backup } = todo[i];
        setBackfill({ busy: true, message: `Reading ${formatWeekLabel(week, { year: true })}… (${i}/${todo.length})` });
        try {
          const snap = await readBackupValue(uid, backup.id, ['habits']);
          // A backup without habits says nothing about that week — no zero row.
          if (Array.isArray(snap) && snap.length > 0) rows.push(backfilledRow(week, snap, backup));
        } catch (err) {
          console.warn(`Backfill skipped ${backup.id}:`, err);
        }
      }
      const { history: merged, added } = mergeMissingWeeks(base, rows);
      if (added > 0) {
        const { saveField } = await import('../utils/firestoreSync');
        await saveField(uid, STATUS_HISTORY_FIELD, merged);
        setHistory(merged);
      }
      setBackfill({ busy: false, message: added > 0 ? `Rebuilt ${added} earlier week${added === 1 ? '' : 's'} from your backups.` : 'No backup held habits for a week that’s missing.' });
    } catch (err) {
      setBackfill({ busy: false, message: `Couldn’t read your backups: ${err?.message || err}` });
    }
  }

  const pill = on => ({
    border: `1px solid ${on ? '#3B6B9C' : '#e2e8f0'}`, background: on ? '#3B6B9C' : '#fff', color: on ? '#fff' : '#475569',
    borderRadius: 999, padding: '2px 10px', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
  });

  return (
    <section style={{ margin: '1.5rem 0 0.5rem', maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <h3 style={{ fontSize: '0.95rem', margin: 0 }}>By status over time</h3>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>One bar per week (Sun–Sat); this week updates live.</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          {RANGES.map(r => <button key={r.key} type="button" style={pill(range === r.key)} onClick={() => setRange(r.key)}>{r.label}</button>)}
        </span>
      </div>
      {/* The legend is the control: a name shows/hides its series, a swatch
          picks its colour. Both are saved as the default for next time. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem 0.9rem', margin: '0.4rem 0 0.2rem' }}>
        {[...statuses].reverse().map(s => {
          const off = hiddenSet.has(s);
          const color = statusHistoryColor(s, prefs.colors);
          return (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', color: 'var(--color-text-secondary, #475569)' }}>
              <label title={`Change the ${s} color`} style={{ position: 'relative', display: 'inline-flex', cursor: 'pointer' }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: off ? 'transparent' : color, border: `2px solid ${color}`, boxSizing: 'border-box' }} />
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(s, e.target.value)}
                  aria-label={`${s} color`}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
                />
              </label>
              <button
                type="button"
                onClick={() => toggleStatus(s)}
                aria-pressed={!off}
                title={off ? `Show ${s}` : `Hide ${s}`}
                style={{
                  border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
                  color: off ? '#94a3b8' : 'inherit', textDecoration: off ? 'line-through' : 'none',
                }}
              >
                {s}
              </button>
            </span>
          );
        })}
        {prefs.hidden.some(s => statuses.includes(s)) && (
          <button type="button" style={pill(false)} onClick={() => updatePrefs({ ...prefs, hidden: [] })}>Show all</button>
        )}
        {Object.keys(prefs.colors).length > 0 && (
          <button type="button" style={pill(false)} onClick={() => updatePrefs({ ...prefs, colors: {} })}>Reset colors</button>
        )}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '0 0 0.6rem' }}>
        Click a status to show or hide it, or its swatch to change its color — saved as your default.
      </div>
      {data.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>No habits yet.</p>
      ) : shown.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>Every status is hidden — click one above to show it.</p>
      ) : (
        <div className="habit-status-chart">
        {/* Clicking a segment focuses the SVG, and the browser's focus ring
            would otherwise box the whole chart. */}
        <style>{'.habit-status-chart *:focus, .habit-status-chart *:focus-visible { outline: none; }'}</style>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 16, right: 12, left: -12, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip content={<StatusTooltip statuses={shown} colors={prefs.colors} hiddenCount={statuses.length - shown.length} />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
            {shown.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="status" fill={statusHistoryColor(s, prefs.colors)} stroke="#ffffff" strokeWidth={1}
                radius={i === shown.length - 1 ? [4, 4, 0, 0] : undefined} isAnimationActive={false} maxBarSize={56}
                cursor="pointer"
                onClick={d => {
                  const row = d?.payload || d;
                  if (!row?.week) return;
                  setSel(cur => (cur && cur.week === row.week && cur.status === s ? null : { week: row.week, status: s, live: !!row.live }));
                }}>
                {data.map(row => (
                  <Cell key={row.week} fillOpacity={!sel || (sel.week === row.week && sel.status === s) ? 1 : 0.3} />
                ))}
                {i === shown.length - 1 && <LabelList dataKey="shownTotal" position="top" fontSize={11} fontWeight={600} fill="#4b5563" />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}
      {data.length > 0 && !sel && (
        <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>Click a segment to see which habits it counts.</div>
      )}
      {sel && (
        <HabitStatusList
          status={sel.status}
          title={`${sel.status} · week of ${formatWeekLabel(sel.week, { year: true })}${sel.live ? ' (this week)' : ''}`}
          note={sel.live ? null : selPast?.date ? `As of the backup from ${formatWeekLabel(selPast.date, { year: true })}.` : null}
          habits={sel.live ? habitsWithStatus(habits, sel.status) : habitsWithStatus(selPast?.habits || [], sel.status)}
          currentById={currentById}
          colors={prefs.colors}
          loading={!sel.live && (!selPast || selPast.loading)}
          error={sel.live ? null : selPast?.error}
          onOpen={onOpen}
          onClear={() => setSel(null)}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: '0.4rem' }}>
        <button type="button" onClick={runBackfill} disabled={backfill?.busy} style={{ ...pill(false), padding: '4px 12px' }}>
          {backfill?.busy ? 'Rebuilding…' : 'Rebuild earlier weeks from backups'}
        </button>
        {backfill && <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{backfill.message}</span>}
      </div>
    </section>
  );
}
