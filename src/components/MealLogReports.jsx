import { useState, useEffect, useMemo } from 'react';
import { auth } from '../firebase';
import { loadField, saveField } from '../utils/firestoreSync';
import styles from './AdminDashboard.module.css';

// Admin Dashboard → "Email a User's Meal Log". Sends one user's logged meals
// (with macros per meal and a daily total) to any address, now or weekly.
// Server side: api/send-meal-log-summary.js, which re-checks the owner.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REPORTS_FIELD = 'mealLogReports';

function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return localKey(d); }
// Last complete Sun–Sat week.
function lastWeek() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() - 1); // last Saturday
  const end = localKey(d);
  d.setDate(d.getDate() - 6);
  return { start: localKey(d), end };
}
function parseEmails(text) {
  return String(text || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}
function userLabel(u) {
  if (!u) return 'Unknown user';
  const name = (u.displayName || '').trim();
  const email = (u.email || '').trim();
  return name && email ? `${name} (${email})` : name || email || u.uid;
}
function newId() { return Math.random().toString(36).slice(2, 10); }

export function MealLogReports({ users }) {
  const [targetUid, setTargetUid] = useState('');
  const [start, setStart] = useState(daysAgo(7));
  const [end, setEnd] = useState(daysAgo(1));
  const [emailsText, setEmailsText] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [reports, setReports] = useState([]);
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [weeklyTime, setWeeklyTime] = useState('08:00');

  const sortedUsers = useMemo(
    () => [...(users || [])].sort((a, b) => userLabel(a).localeCompare(userLabel(b))),
    [users],
  );
  const byUid = useMemo(() => Object.fromEntries((users || []).map(u => [u.uid, u])), [users]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    let alive = true;
    loadField(uid, REPORTS_FIELD)
      .then(v => { if (alive && Array.isArray(v)) setReports(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  function persist(next) {
    setReports(next);
    const uid = auth.currentUser?.uid;
    if (uid) saveField(uid, REPORTS_FIELD, next).catch(err => setMsg(`Couldn't save schedule: ${err.message}`));
  }

  const emails = parseEmails(emailsText);
  const ready = targetUid && emails.length > 0 && start && end && start <= end;

  async function sendNow() {
    if (!ready) return;
    setSending(true);
    setMsg('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/send-meal-log-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid, start, end, emails }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(`✓ Sent "${data.subject}" to ${data.sentTo.join(', ')}`);
    } catch (err) {
      setMsg(`Send failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  function addWeekly() {
    if (!targetUid || emails.length === 0) return;
    persist([...reports, { id: newId(), targetUid, emails, weekly: true, day: Number(weeklyDay), time: weeklyTime }]);
    setMsg('✓ Weekly email scheduled');
  }

  const rangeBtn = (label, s, e) => (
    <button type="button" className={styles.setupBtn} style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}
      onClick={() => { setStart(s); setEnd(e); }}>{label}</button>
  );
  const lw = lastWeek();

  return (
    <div className={styles.sourceSection}>
      <h3 className={styles.sourceHeading}>Email a User&apos;s Meal Log</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
        Sends what the user logged each day — every meal with its calories, protein, carbs and fat, a daily total
        against their goals, and the average across the range (up to 31 days).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 560 }}>
        <select className={styles.setupInput} value={targetUid} onChange={e => setTargetUid(e.target.value)} aria-label="User whose meals to send">
          <option value="">Choose a user…</option>
          {sortedUsers.map(u => <option key={u.uid} value={u.uid}>{userLabel(u)}</option>)}
        </select>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input className={styles.setupInput} type="date" value={start} onChange={e => setStart(e.target.value)} aria-label="Start date" style={{ width: 'auto' }} />
          <span>to</span>
          <input className={styles.setupInput} type="date" value={end} onChange={e => setEnd(e.target.value)} aria-label="End date" style={{ width: 'auto' }} />
          {rangeBtn('Yesterday', daysAgo(1), daysAgo(1))}
          {rangeBtn('Last 7 days', daysAgo(7), daysAgo(1))}
          {rangeBtn('Last week (Sun–Sat)', lw.start, lw.end)}
        </div>
        <input className={styles.setupInput} type="text" placeholder="Send to (comma-separated emails)"
          value={emailsText} onChange={e => setEmailsText(e.target.value)} aria-label="Recipient emails" />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={styles.setupBtn} disabled={!ready || sending} onClick={sendNow} style={{ opacity: ready ? 1 : 0.5 }}>
            {sending ? 'Sending…' : 'Send now →'}
          </button>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>or every</span>
          <select className={styles.setupInput} value={weeklyDay} onChange={e => setWeeklyDay(e.target.value)} style={{ width: 'auto' }} aria-label="Weekly send day">
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <input className={styles.setupInput} type="time" step="3600" value={weeklyTime} onChange={e => setWeeklyTime(e.target.value)} style={{ width: 'auto' }} aria-label="Weekly send time (Eastern)" />
          <button className={styles.setupBtn} disabled={!targetUid || emails.length === 0} onClick={addWeekly}
            style={{ opacity: targetUid && emails.length ? 1 : 0.5 }}>
            Schedule weekly
          </button>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          Weekly emails cover the last full Sun–Sat week and go out at that hour, Eastern time.
        </div>
        {msg && (
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: msg.startsWith('✓') ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #c0392b)' }}>
            {msg}
          </div>
        )}
        {reports.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.3rem' }}>Scheduled weekly</div>
            {reports.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.82rem', padding: '0.25rem 0', flexWrap: 'wrap' }}>
                <span><strong>{userLabel(byUid[r.targetUid])}</strong> → {(r.emails || []).join(', ')} · {DAYS[r.day] || 'Mon'} {r.time || '08:00'} ET</span>
                <button type="button" onClick={() => persist(reports.filter(x => x.id !== r.id))}
                  style={{ border: 'none', background: 'none', color: 'var(--color-danger, #c0392b)', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
