/**
 * Habits → KPI: how many habits sat at each status, week by week, as stacked
 * bars. The weekly reading is taken in App.jsx on every visit (see
 * utils/habitStatusHistory.js); this draws it, with the current week always
 * shown live from the habits on screen.
 *
 * Legend and tooltip are hand-rolled: Recharts sorts its own alphabetically,
 * which would disagree with the stack.
 */
import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { auth } from '../firebase';
import { loadField, listFullBackups, readBackupValue } from '../utils/firestoreSync';
import {
  STATUS_HISTORY_FIELD, statusSnapshot, upsertWeek, orderedStatuses, statusHistoryColor,
  formatWeekLabel, backupsToBackfill, backfilledRow, mergeMissingWeeks, recordHabitStatusSnapshot,
} from '../utils/habitStatusHistory';

const RANGES = [{ key: 12, label: '12 weeks' }, { key: 26, label: '26 weeks' }, { key: 0, label: 'All' }];

function StatusTooltip({ active, payload, statuses }) {
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
          <span style={{ width: 9, height: 9, borderRadius: 2, background: statusHistoryColor(s) }} />
          <span style={{ flex: 1 }}>{s}</span>
          <strong>{row[s]}</strong>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 4, paddingTop: 4, display: 'flex' }}>
        <span style={{ flex: 1 }}>Total</span><strong>{row.total}</strong>
      </div>
    </div>
  );
}

export function HabitStatusHistory({ habits }) {
  const uid = auth.currentUser?.uid;
  const [history, setHistory] = useState([]);
  const [range, setRange] = useState(12);
  const [backfill, setBackfill] = useState(null); // null | { busy, message }

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
  const data = useMemo(
    () => series.map(r => ({ ...r, ...r.counts, label: formatWeekLabel(r.week) })),
    [series],
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 0.9rem', margin: '0.4rem 0 0.6rem' }}>
        {[...statuses].reverse().map(s => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', color: 'var(--color-text-secondary, #475569)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: statusHistoryColor(s) }} />{s}
          </span>
        ))}
      </div>
      {data.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>No habits yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 16, right: 12, left: -12, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip content={<StatusTooltip statuses={statuses} />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
            {statuses.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="status" fill={statusHistoryColor(s)} stroke="#ffffff" strokeWidth={1}
                radius={i === statuses.length - 1 ? [4, 4, 0, 0] : undefined} isAnimationActive={false} maxBarSize={56}>
                {i === statuses.length - 1 && <LabelList dataKey="total" position="top" fontSize={11} fontWeight={600} fill="#4b5563" />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
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
