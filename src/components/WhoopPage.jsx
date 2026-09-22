import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { db } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import { whoopHistorySummary, mergeWhoopDailyCache } from '../utils/whoopDaily';
import { loadWhoopHistory, runWhoopBackfill } from '../utils/whoopHistory';
import styles from './WhoopPage.module.css';

function fmtDuration(min) {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// YYYY-MM-DD → "May 19, 2026". Parsed at noon so the local timezone can't
// shift it onto the previous day.
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function recoveryColor(score) {
  if (score == null) return 'var(--color-text-muted)';
  if (score >= 67) return '#16a34a';
  if (score >= 34) return '#f59e0b';
  return '#dc2626';
}

// Pick the most recent record (by date string) from a normalized array.
function latest(arr) {
  if (!arr || arr.length === 0) return null;
  return [...arr].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
}

export function WhoopPage({ user, onClose }) {
  const [status, setStatus] = useState('loading'); // loading | disconnected | connected | error
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [budgetOn, setBudgetOn] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sunday-whoop-budget') || 'false') === true; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);

  // How much history is actually stored, and the state of a backfill run.
  const [history, setHistory] = useState(null);   // summary, or null until loaded
  const [backfill, setBackfill] = useState(null); // { status, reachedBack? } | null
  const [backfillError, setBackfillError] = useState('');

  const refreshHistory = useCallback(async (uid) => {
    const daily = await loadWhoopHistory(uid);
    setHistory(whoopHistorySummary(daily));
    mergeWhoopDailyCache(daily);
  }, []);

  const loadData = useCallback(async () => {
    if (!user?.uid) return;
    setStatus('loading');
    setError('');
    try {
      // Quick connection check from the user doc first.
      const snap = await getDoc(doc(db, 'users', user.uid));
      const connected = snap.exists() && snap.data().whoopConnected === true;
      if (!connected) { setStatus('disconnected'); return; }

      const t = await user.getIdToken();
      const res = await fetch(`/api/whoop/data?uid=${encodeURIComponent(user.uid)}&t=${encodeURIComponent(t)}&days=21`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (!json.connected) { setStatus('disconnected'); return; }
      setData(json);
      setStatus('connected');
      // After the fetch, not before: it merges the last 21 days into the
      // history doc on its way through.
      await refreshHistory(user.uid);
    } catch (err) {
      setError(err?.message || 'Failed to load Whoop data');
      setStatus('error');
    }
  }, [user, refreshHistory]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleConnect() {
    if (!user?.uid) return;
    const t = await user.getIdToken();
    window.location.href = `/api/whoop/start?uid=${encodeURIComponent(user.uid)}&t=${encodeURIComponent(t)}`;
  }

  async function handleDisconnect() {
    if (!user?.uid) return;
    if (!window.confirm('Disconnect Whoop? Your stored Whoop data and tokens will be removed.')) return;
    setBusy(true);
    try {
      const t = await user.getIdToken();
      await fetch(`/api/whoop/disconnect?uid=${encodeURIComponent(user.uid)}&t=${encodeURIComponent(t)}`, { method: 'POST' });
      setData(null);
      setStatus('disconnected');
    } catch {
      /* ignore — re-check on next load */
    } finally {
      setBusy(false);
    }
  }

  // Walk the whole account backwards. Takes a while on a long-standing Whoop
  // account — several round trips of 240 days each — so it reports how far
  // back it has reached rather than just spinning.
  async function handleBackfill() {
    if (!user?.uid || backfill?.status === 'running') return;
    setBackfillError('');
    setBackfill({ status: 'running' });
    try {
      const last = await runWhoopBackfill(user, (p) => {
        setBackfill({
          status: 'running',
          reachedBack: p.nextBefore ? p.nextBefore.slice(0, 10) : p.earliest,
          totalDays: p.totalDays,
        });
      });
      await refreshHistory(user.uid);
      setBackfill({ status: 'done', full: !!last?.full, totalDays: last?.totalDays });
    } catch (err) {
      setBackfillError(err?.message || 'Backfill failed');
      setBackfill(null);
    }
  }

  function toggleBudget() {
    const next = !budgetOn;
    setBudgetOn(next);
    localStorage.setItem('sunday-whoop-budget', JSON.stringify(next));
    if (user?.uid) saveField(user.uid, 'whoopAddCaloriesToBudget', next);
  }

  const rec = latest(data?.recovery);
  const slp = latest(data?.sleep);
  const cyc = latest(data?.cycles);
  const recoveryTrend = (data?.recovery || [])
    .filter(r => r.recoveryScore != null)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(r => ({ date: (r.date || '').slice(5), score: r.recoveryScore }));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        {onClose && <button className={styles.backBtn} onClick={onClose}>← Back</button>}
        <h2 className={styles.title}>Whoop</h2>
        {status === 'connected' && (
          <button className={styles.refreshBtn} onClick={loadData}>Refresh</button>
        )}
      </div>

      {status === 'loading' && <div className={styles.muted}>Loading…</div>}

      {status === 'error' && (
        <div className={styles.errorBox}>
          {error}
          <button className={styles.retryBtn} onClick={loadData}>Retry</button>
        </div>
      )}

      {status === 'disconnected' && (
        <div className={styles.connectCard}>
          <p className={styles.connectLead}>
            Connect your Whoop account to see recovery, sleep, strain, and daily
            calories — and optionally add the calories you burn to your daily
            calorie budget.
          </p>
          <button className={styles.connectBtn} onClick={handleConnect}>Connect Whoop</button>
        </div>
      )}

      {status === 'connected' && (
        <>
          <div className={styles.cardGrid}>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Recovery</div>
              <div className={styles.cardValue} style={{ color: recoveryColor(rec?.recoveryScore) }}>
                {rec?.recoveryScore != null ? `${rec.recoveryScore}%` : '—'}
              </div>
              <div className={styles.cardSub}>
                {rec?.restingHeartRate != null ? `RHR ${rec.restingHeartRate} bpm` : ''}
                {rec?.hrv != null ? ` · HRV ${rec.hrv} ms` : ''}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>Sleep</div>
              <div className={styles.cardValue}>{fmtDuration(slp?.durationMin)}</div>
              <div className={styles.cardSub}>
                {slp?.performance != null ? `${slp.performance}% performance` : ''}
                {slp?.remMin ? ` · REM ${fmtDuration(slp.remMin)}` : ''}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>Day Strain</div>
              <div className={styles.cardValue}>{cyc?.strain != null ? cyc.strain.toFixed(1) : '—'}</div>
              <div className={styles.cardSub}>
                {cyc?.avgHeartRate != null ? `Avg HR ${cyc.avgHeartRate} bpm` : ''}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>Calories Burned</div>
              <div className={styles.cardValue}>{cyc?.calories ? cyc.calories.toLocaleString() : '—'}</div>
              <div className={styles.cardSub}>today’s cycle</div>
            </div>
          </div>

          {recoveryTrend.length > 1 && (
            <div className={styles.chartCard}>
              <div className={styles.cardLabel}>Recovery — last {recoveryTrend.length} days</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={recoveryTrend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {data?.workouts?.length > 0 && (
            <div className={styles.workoutsCard}>
              <div className={styles.cardLabel}>Recent workouts</div>
              <ul className={styles.workoutList}>
                {[...data.workouts]
                  .sort((a, b) => (b.start || '').localeCompare(a.start || ''))
                  .slice(0, 6)
                  .map(w => (
                    <li key={w.id} className={styles.workoutRow}>
                      <span className={styles.workoutName}>{w.sportName}</span>
                      <span className={styles.workoutMeta}>
                        {w.date} · strain {w.strain != null ? w.strain.toFixed(1) : '—'} · {w.calories ? `${w.calories} cal` : '—'}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className={styles.historyCard}>
            <div className={styles.cardLabel}>Stored history</div>
            <p className={styles.historyRange}>
              {history
                ? history.days > 0
                  ? `${history.nights} night${history.nights === 1 ? '' : 's'} of sleep · ${fmtDate(history.earliest)} → ${fmtDate(history.latest)}`
                  : 'Nothing stored yet.'
                : 'Checking…'}
            </p>
            <p className={styles.historyHelp}>
              Prep Day only asks Whoop for the last few weeks each time it
              refreshes, so the charts start from the day you connected rather
              than the day you started wearing the band. This pulls the rest of
              your account in — sleep, recovery, strain and calories, as far
              back as Whoop has them.
            </p>
            <button
              className={styles.historyBtn}
              onClick={handleBackfill}
              disabled={backfill?.status === 'running'}
            >
              {backfill?.status === 'running' ? 'Loading history…' : 'Load full history'}
            </button>
            {backfill?.status === 'running' && (
              <p className={styles.historyStatus}>
                {backfill.reachedBack
                  ? `Reached ${fmtDate(backfill.reachedBack)}…`
                  : 'Starting…'}
              </p>
            )}
            {backfill?.status === 'done' && (
              <p className={styles.historyStatus}>
                {backfill.full
                  ? 'Done — stopped at the storage limit, so the oldest nights were left out.'
                  : 'Done — that’s everything Whoop has.'}
              </p>
            )}
            {backfillError && <p className={styles.historyError}>{backfillError}</p>}
          </div>

          <div className={styles.budgetCard}>
            <label className={styles.budgetToggle}>
              <input type="checkbox" checked={budgetOn} onChange={toggleBudget} />
              <span>Add Whoop calories burned to my daily calorie budget</span>
            </label>
            <p className={styles.budgetHelp}>
              When on, each day’s calorie goal on the meal tracker increases by the
              calories Whoop measured you burning that day. Macro targets (protein,
              carbs, fat) are unchanged.
            </p>
          </div>

          <div className={styles.footer}>
            <button className={styles.disconnectBtn} onClick={handleDisconnect} disabled={busy}>
              {busy ? 'Disconnecting…' : 'Disconnect Whoop'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
