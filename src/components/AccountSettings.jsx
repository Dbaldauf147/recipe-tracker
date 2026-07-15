import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { saveField, loadUserData, saveDailyLogToFirestore, saveRecipesToFirestore, listDailyLogRecoveryPoints, previewDailyLogMerge, mergeRestoreDailyLog, normalizeDailyLog, previewDailyLogMergeMap, mergeRestoreDailyLogMap } from '../utils/firestoreSync';
import styles from './AccountSettings.module.css';

// User-doc fields included in a full backup / restore (the big blobs —
// dailyLog, recipes, workoutLog — are handled separately below).
const BACKUP_FIELDS = [
  'weightLog', 'weeklyPlan', 'weeklyServings', 'planHistory', 'habits',
  // Habit tracking: the marks (habitLog) + rules/derived state, so a restore
  // brings back the whole tracker, not just the habit definitions.
  'habitLog', 'habitAutomations', 'habitLogAuto', 'habitNextLog',
  'bodyStats', 'nutritionGoals', 'reminderSettings', 'groceryCategories',
  'groceryItemSections', 'shopLinks', 'restaurants', 'eatingOutVotes',
  'eatingOutOrder', 'keyIngredients', 'userDiet', 'userLocation',
  'customGridWidgets', 'catLayout', 'hiddenCategories',
];

const REMINDER_KEY = 'sunday-reminder-settings';
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadReminderSettings() {
  try { return JSON.parse(localStorage.getItem(REMINDER_KEY) || '{}'); } catch { return {}; }
}

export function AccountSettings({ user, onClose }) {
  const { deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [backupBusy, setBackupBusy] = useState('');
  const [backupMsg, setBackupMsg] = useState('');

  // Merge-restore of lost meal days (adds missing/empty days only; never
  // overwrites a day that already has meals).
  const [recoverBusy, setRecoverBusy] = useState('');
  const [recoverMsg, setRecoverMsg] = useState('');
  const [recoverPoints, setRecoverPoints] = useState(null); // null = not loaded
  const [selectedPointId, setSelectedPointId] = useState('');
  const [mergePreview, setMergePreview] = useState(null);

  function fmtPoint(p) {
    const when = p.date || (p.savedAt || '').slice(0, 10) || 'unknown date';
    const src = p.source === 'backup' ? 'daily backup' : 'snapshot';
    return `${when} — ${p.count} meal${p.count === 1 ? '' : 's'} (${src})`;
  }

  async function findMealBackups() {
    if (!user?.uid) return;
    setRecoverBusy('list'); setRecoverMsg(''); setMergePreview(null);
    try {
      const points = await listDailyLogRecoveryPoints(user.uid);
      setRecoverPoints(points);
      if (points.length === 0) {
        setRecoverMsg('No meal backups found for this account.');
      } else {
        setSelectedPointId(points[0].id);
        setRecoverMsg(`Found ${points.length} recovery point${points.length === 1 ? '' : 's'}. Pick one and preview.`);
      }
    } catch (err) {
      setRecoverMsg(`Couldn’t load backups: ${err.message}`);
    } finally {
      setRecoverBusy('');
    }
  }

  async function previewMerge() {
    if (!user?.uid || !selectedPointId || !recoverPoints) return;
    const point = recoverPoints.find(p => p.id === selectedPointId);
    if (!point) return;
    setRecoverBusy('preview'); setRecoverMsg(''); setMergePreview(null);
    try {
      const pv = await previewDailyLogMerge(user.uid, point);
      setMergePreview(pv);
      if (pv.addedDates.length === 0) {
        setRecoverMsg('This backup adds nothing new — every day it contains is already filled in your current log.');
      } else {
        setRecoverMsg('');
      }
    } catch (err) {
      setRecoverMsg(`Preview failed: ${err.message}`);
    } finally {
      setRecoverBusy('');
    }
  }

  async function applyMerge() {
    if (!user?.uid || !selectedPointId || !recoverPoints || !mergePreview) return;
    const point = recoverPoints.find(p => p.id === selectedPointId);
    if (!point) return;
    if (!window.confirm(`Restore ${mergePreview.addedDates.length} missing day(s) — ${mergePreview.addedEntries} meals — from this backup? Days that already have meals will not be touched.`)) return;
    setRecoverBusy('apply'); setRecoverMsg('');
    try {
      const res = await mergeRestoreDailyLog(user.uid, point);
      setMergePreview(null);
      setRecoverMsg(`Restored ${res.addedDays} day(s), ${res.addedEntries} meals. Reloading…`);
      // Reload immediately so the tracker re-reads the full log from Firestore
      // (and the stale in-memory log can't save back over the restore).
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setRecoverMsg(`Restore failed: ${err.message}`);
      setRecoverBusy('');
    }
  }

  // Import history from a backup JSON file, merging in only the missing days.
  const [fileLog, setFileLog] = useState(null);
  const [filePreview, setFilePreview] = useState(null);

  async function onHistoryFile(file) {
    if (!file || !user?.uid) return;
    setRecoverBusy('filePreview'); setRecoverMsg(''); setFilePreview(null); setFileLog(null);
    try {
      const parsed = JSON.parse(await file.text());
      const log = normalizeDailyLog(parsed);
      if (Object.keys(log).length === 0) throw new Error('No daily-log data found in that file.');
      const pv = await previewDailyLogMergeMap(user.uid, log);
      setFileLog(log);
      setFilePreview(pv);
      if (pv.addedDates.length === 0) {
        setRecoverMsg('This file adds nothing new — every day it contains is already filled in your current log.');
      }
    } catch (err) {
      setRecoverMsg(`Couldn’t read file: ${err.message}`);
    } finally {
      setRecoverBusy('');
    }
  }

  async function applyFileMerge() {
    if (!user?.uid || !fileLog || !filePreview) return;
    if (!window.confirm(`Import ${filePreview.addedDates.length} missing day(s) — ${filePreview.addedEntries} meals — from this file? Days that already have meals will not be touched.`)) return;
    setRecoverBusy('fileApply'); setRecoverMsg('');
    try {
      const res = await mergeRestoreDailyLogMap(user.uid, fileLog);
      setFilePreview(null); setFileLog(null);
      setRecoverMsg(`Imported ${res.addedDays} day(s), ${res.addedEntries} meals. Reloading…`);
      // Reload immediately so the tracker re-reads the full log from Firestore
      // (and the stale in-memory log can't save back over the import).
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setRecoverMsg(`Import failed: ${err.message}`);
      setRecoverBusy('');
    }
  }

  function describeAdded(pv) {
    const dates = pv.addedDates;
    if (dates.length <= 8) return dates.join(', ');
    return `${dates[0]} … ${dates[dates.length - 1]} (${dates.length} days)`;
  }

  async function downloadBackup() {
    if (!user?.uid) return;
    setBackupBusy('export'); setBackupMsg('');
    try {
      const data = await loadUserData(user.uid);
      if (!data) throw new Error('Could not read your data.');
      const payload = { app: 'prep-day', exportedAt: new Date().toISOString(), uid: user.uid, data };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prepday-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg('Backup downloaded.');
    } catch (err) {
      setBackupMsg(`Export failed: ${err.message}`);
    } finally {
      setBackupBusy('');
    }
  }

  async function restoreBackup(file) {
    if (!file || !user?.uid) return;
    if (!window.confirm('Restore this backup? It will merge the file’s data back into your account (the safety guards still protect against accidental wipes).')) return;
    setBackupBusy('restore'); setBackupMsg('');
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed?.data || parsed;
      if (!data || typeof data !== 'object') throw new Error('Not a valid backup file.');
      let n = 0;
      if (data.dailyLog && typeof data.dailyLog === 'object') { await saveDailyLogToFirestore(user.uid, data.dailyLog); n++; }
      if (Array.isArray(data.recipes)) { await saveRecipesToFirestore(user.uid, data.recipes); n++; }
      if (Array.isArray(data.workoutLog)) { await saveField(user.uid, 'workoutLog', data.workoutLog); n++; }
      for (const f of BACKUP_FIELDS) {
        if (data[f] !== undefined) { try { await saveField(user.uid, f, data[f]); n++; } catch (e) { /* guard may block a shrink; skip */ } }
      }
      setBackupMsg(`Restore complete (${n} sections). Reload the page to see your data.`);
    } catch (err) {
      setBackupMsg(`Restore failed: ${err.message}`);
    } finally {
      setBackupBusy('');
    }
  }
  const [phone, setPhone] = useState('');
  // Per-email day routing: each row is { email, days[] }. A reminder due on a
  // given weekday is sent to every row whose `days` includes that weekday.
  const [emailSchedules, setEmailSchedules] = useState([{ email: '', days: [...ALL_DAYS], cadence: 'weekly', week: 'A' }]);
  const [foodLogReminder, setFoodLogReminder] = useState(false);
  const [foodLogTime, setFoodLogTime] = useState('17:00');
  const [foodLogDays, setFoodLogDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [weightReminder, setWeightReminder] = useState(false);
  const [weightTime, setWeightTime] = useState('08:00');
  const [weightDays, setWeightDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  // Auto-log: on its scheduled days, a daily cron records every recipe in the
  // weekly plan (the shopping-list recipes) into meal history. Default Sun+Wed.
  const [autoLogMeals, setAutoLogMeals] = useState(false);
  const [autoLogDays, setAutoLogDays] = useState([0, 3]);
  const [reminderSaved, setReminderSaved] = useState(false);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    const s = loadReminderSettings();
    if (s.phone) setPhone(s.phone);
    // Hydrate per-email schedules, migrating from the legacy flat emails list
    // (every address → all days) so existing setups keep working unchanged.
    if (Array.isArray(s.emailSchedules) && s.emailSchedules.length > 0) {
      setEmailSchedules(s.emailSchedules.map(r => ({
        email: r?.email || '',
        days: Array.isArray(r?.days) && r.days.length ? [...r.days].sort((a, b) => a - b) : [...ALL_DAYS],
        cadence: r?.cadence === 'biweekly' ? 'biweekly' : 'weekly',
        week: r?.week === 'B' ? 'B' : 'A',
      })));
    } else if (Array.isArray(s.emails) && s.emails.length > 0) {
      setEmailSchedules(s.emails.map(e => ({ email: e, days: [...ALL_DAYS], cadence: 'weekly', week: 'A' })));
    } else if (s.email) {
      setEmailSchedules([{ email: s.email, days: [...ALL_DAYS], cadence: 'weekly', week: 'A' }]);
    } else if (user?.email) {
      setEmailSchedules([{ email: user.email.toLowerCase(), days: [...ALL_DAYS], cadence: 'weekly', week: 'A' }]);
    }
    if (s.foodLogReminder) setFoodLogReminder(s.foodLogReminder);
    if (s.foodLogTime) setFoodLogTime(s.foodLogTime);
    if (Array.isArray(s.foodLogDays)) setFoodLogDays(s.foodLogDays);
    if (s.weightReminder) setWeightReminder(s.weightReminder);
    if (s.weightTime) setWeightTime(s.weightTime);
    if (Array.isArray(s.weightDays)) setWeightDays(s.weightDays);
    if (s.autoLogMeals) setAutoLogMeals(s.autoLogMeals);
    if (Array.isArray(s.autoLogDays)) setAutoLogDays(s.autoLogDays);
  }, []);

  function toggleDay(d) {
    setFoodLogDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }
  function toggleWeightDay(d) {
    setWeightDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }
  function toggleAutoLogDay(d) {
    setAutoLogDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  function updateScheduleEmail(i, email) {
    setEmailSchedules(prev => prev.map((r, j) => (j === i ? { ...r, email } : r)));
  }
  function toggleScheduleDay(i, d) {
    setEmailSchedules(prev => prev.map((r, j) => {
      if (j !== i) return r;
      const has = r.days.includes(d);
      return { ...r, days: has ? r.days.filter(x => x !== d) : [...r.days, d].sort((a, b) => a - b) };
    }));
  }
  function updateScheduleCadence(i, cadence) {
    setEmailSchedules(prev => prev.map((r, j) => (j === i ? { ...r, cadence } : r)));
  }
  function updateScheduleWeek(i, week) {
    setEmailSchedules(prev => prev.map((r, j) => (j === i ? { ...r, week } : r)));
  }
  function addScheduleRow() {
    setEmailSchedules(prev => [...prev, { email: '', days: [...ALL_DAYS], cadence: 'weekly', week: 'A' }]);
  }
  function removeScheduleRow(i) {
    setEmailSchedules(prev => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  // Validated, deduped schedules (lowercased email + sorted days). Rows with an
  // invalid/blank email or no days selected are dropped.
  function buildSchedules() {
    const out = [];
    const seen = new Set();
    for (const r of emailSchedules) {
      const email = (r.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || seen.has(email)) continue;
      const days = Array.isArray(r.days) && r.days.length ? [...r.days].sort((a, b) => a - b) : [];
      if (days.length === 0) continue;
      seen.add(email);
      const cadence = r.cadence === 'biweekly' ? 'biweekly' : 'weekly';
      const entry = { email, days, cadence };
      // `week` only matters for biweekly (which alternating week to fire on).
      if (cadence === 'biweekly') entry.week = r.week === 'B' ? 'B' : 'A';
      out.push(entry);
    }
    return out;
  }

  // Flat recipient list (for the test email + legacy `emails` field).
  function effectiveEmails() {
    const sched = buildSchedules();
    if (sched.length > 0) return sched.map(r => r.email);
    if (user?.email) return [user.email.toLowerCase()];
    return [];
  }

  function saveReminders() {
    const schedules = buildSchedules();
    const emails = schedules.length > 0 ? schedules.map(r => r.email) : effectiveEmails();
    const settings = {
      phone,
      // `emailSchedules` is the authoritative per-day routing. `emails`/`email`
      // are derived (flat list) so the test endpoint and any older readers
      // still see valid recipients.
      emailSchedules: schedules,
      emails,
      email: emails[0] || '',
      foodLogReminder, foodLogTime, foodLogDays, weightReminder, weightTime, weightDays,
      autoLogMeals, autoLogDays,
    };
    localStorage.setItem(REMINDER_KEY, JSON.stringify(settings));
    if (user) saveField(user.uid, 'reminderSettings', settings);
    setReminderSaved(true);
    setTimeout(() => setReminderSaved(false), 2000);
  }

  async function sendTestReminder() {
    const emails = effectiveEmails();
    if (emails.length === 0) { alert('No email on file — type a destination email above first.'); return; }
    setTestSending(true);
    try {
      const res = await fetch('/api/send-test-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });
      if (res.ok) {
        alert('Test email sent! Check your inbox.');
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`Failed to send: ${data.error || res.status}`);
      }
    } catch (err) {
      alert(`Failed to send: ${err.message || err}`);
    } finally {
      setTestSending(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete your account? This will permanently delete all your data and cannot be undone.')) return;
    if (!confirm('This is permanent. All recipes, meal logs, weight data, and settings will be lost. Continue?')) return;
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err) {
      alert(err.message || 'Failed to delete account. Try signing out and back in first.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
        <h2 className={styles.title}>Account Settings</h2>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Profile</h3>
        <div className={styles.infoRow}>
          {user?.photoURL && (
            <img className={styles.avatar} src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          )}
          <div className={styles.infoDetails}>
            <span className={styles.infoName}>{user?.displayName || 'Guest'}</span>
            <span className={styles.infoEmail}>{user?.email || 'No email'}</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Account</h3>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Sign-in method:</span>
          <span className={styles.infoValue}>
            {user?.providerData?.[0]?.providerId === 'google.com' ? 'Google' :
             user?.providerData?.[0]?.providerId === 'apple.com' ? 'Apple' :
             user?.providerData?.[0]?.providerId === 'facebook.com' ? 'Facebook' :
             user?.providerData?.[0]?.providerId === 'password' ? 'Email/Password' : 'Unknown'}
          </span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Member since:</span>
          <span className={styles.infoValue}>
            {user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown'}
          </span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Last sign-in:</span>
          <span className={styles.infoValue}>
            {user?.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown'}
          </span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Email Reminders</h3>
        <p className={styles.reminderHint} style={{ marginBottom: '0.75rem' }}>
          Get email reminders when you forget to log meals or weigh yourself.
        </p>

        <div className={styles.reminderRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.6rem' }}>
          <label className={styles.reminderToggle} style={{ cursor: 'default' }}>
            Send reminders to
          </label>
          {emailSchedules.map((row, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input
                  type="email"
                  className={styles.reminderTimeInput}
                  style={{ flex: 1, minWidth: 0, maxWidth: 360 }}
                  value={row.email}
                  onChange={e => updateScheduleEmail(i, e.target.value)}
                  placeholder={i === 0 ? (user?.email || 'you@example.com') : 'partner@example.com'}
                  autoComplete="email"
                />
                {emailSchedules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeScheduleRow(i)}
                    aria-label="Remove this email"
                    style={{
                      border: '1px solid #ccc', background: '#fff', color: '#888',
                      borderRadius: 6, width: 30, height: 30, cursor: 'pointer', fontSize: '1rem', lineHeight: 1,
                    }}
                  >×</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {DAY_LABELS.map((label, idx) => {
                  const on = row.days.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleScheduleDay(i, idx)}
                      style={{
                        padding: '0.3rem 0.5rem',
                        borderRadius: 6,
                        border: '1px solid ' + (on ? '#111' : '#ccc'),
                        background: on ? '#111' : '#fff',
                        color: on ? '#fff' : '#666',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        minWidth: 38,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', color: '#666' }}>Frequency</span>
                <select
                  value={row.cadence || 'weekly'}
                  onChange={e => updateScheduleCadence(i, e.target.value)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid #ccc' }}
                >
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every other week</option>
                </select>
                {row.cadence === 'biweekly' && (
                  <select
                    value={row.week || 'A'}
                    onChange={e => updateScheduleWeek(i, e.target.value)}
                    title="Which alternating week this address fires on"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid #ccc' }}
                  >
                    <option value="A">Week A</option>
                    <option value="B">Week B (opposite)</option>
                  </select>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addScheduleRow}
            className={styles.reminderTestBtn}
            style={{ alignSelf: 'flex-start' }}
          >
            + Add another email
          </button>
          <p className={styles.reminderHint} style={{ marginTop: 0 }}>
            Each address only gets reminders on the days you highlight — e.g. send weekday reminders to one inbox and weekend ones to another. Set an address to <strong>every other week</strong> for a biweekly cadence; Week A and Week B fall on opposite weeks, so you can alternate two inboxes. Applies to both meal and weight reminders. Save after changing.
          </p>
        </div>

        <div className={styles.reminderRow}>
          <label className={styles.reminderToggle}>
            <input type="checkbox" checked={foodLogReminder} onChange={e => { setFoodLogReminder(e.target.checked); }} />
            Meal Tracking Reminder
          </label>
          {foodLogReminder && (
            <input type="time" className={styles.reminderTimeInput} value={foodLogTime} onChange={e => setFoodLogTime(e.target.value)} />
          )}
        </div>
        {foodLogReminder && (
          <>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.5rem 0 0.25rem' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, idx) => {
                const on = foodLogDays.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    style={{
                      padding: '0.35rem 0.6rem',
                      borderRadius: 6,
                      border: '1px solid ' + (on ? '#111' : '#ccc'),
                      background: on ? '#111' : '#fff',
                      color: on ? '#fff' : '#666',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      minWidth: 42,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className={styles.reminderHint}>
              If you have fewer than 3 meals logged by {new Date(`2000-01-01T${foodLogTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (Eastern Time, rounded to the hour) on a selected day, you'll get a reminder email.
            </p>
          </>
        )}

        <div className={styles.reminderRow}>
          <label className={styles.reminderToggle}>
            <input type="checkbox" checked={weightReminder} onChange={e => { setWeightReminder(e.target.checked); }} />
            Weight Tracking Reminder
          </label>
          {weightReminder && (
            <input type="time" className={styles.reminderTimeInput} value={weightTime} onChange={e => setWeightTime(e.target.value)} />
          )}
        </div>
        {weightReminder && (
          <>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.5rem 0 0.25rem' }}>
              {DAY_LABELS.map((label, idx) => {
                const on = weightDays.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleWeightDay(idx)}
                    style={{
                      padding: '0.35rem 0.6rem',
                      borderRadius: 6,
                      border: '1px solid ' + (on ? '#111' : '#ccc'),
                      background: on ? '#111' : '#fff',
                      color: on ? '#fff' : '#666',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      minWidth: 42,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className={styles.reminderHint}>
              Only checked on these days, and only when you're due per your weigh-in schedule. If you haven't logged your weight by {new Date(`2000-01-01T${weightTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (Eastern Time) on a selected day, you'll get a reminder.
            </p>
          </>
        )}

        <div className={styles.reminderRow}>
          <label className={styles.reminderToggle}>
            <input type="checkbox" checked={autoLogMeals} onChange={e => { setAutoLogMeals(e.target.checked); }} />
            Auto-log weekly meals
          </label>
        </div>
        {autoLogMeals && (
          <>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.5rem 0 0.25rem' }}>
              {DAY_LABELS.map((label, idx) => {
                const on = autoLogDays.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleAutoLogDay(idx)}
                    style={{
                      padding: '0.35rem 0.6rem',
                      borderRadius: 6,
                      border: '1px solid ' + (on ? '#111' : '#ccc'),
                      background: on ? '#111' : '#fff',
                      color: on ? '#fff' : '#666',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      minWidth: 42,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className={styles.reminderHint}>
              On each highlighted day, every recipe in your weekly plan (your shopping-list recipes) is recorded in your meal history automatically. Pick two days for "twice a week."
            </p>
          </>
        )}

        <div className={styles.reminderActions}>
          <button className={styles.reminderSaveBtn} onClick={saveReminders}>
            {reminderSaved ? 'Saved!' : 'Save Settings'}
          </button>
          <button className={styles.reminderTestBtn} onClick={sendTestReminder} disabled={testSending}>
            {testSending ? 'Sending...' : 'Send Test Email'}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Backup &amp; Restore</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 0.6rem', lineHeight: 1.45 }}>
          Download a full copy of your data (meals, recipes, workouts, weight, habits, settings) as a JSON file, or restore from one. Your data is also auto-snapshotted and backed up daily on the server.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={downloadBackup}
            disabled={!!backupBusy}
            style={{ border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
          >
            {backupBusy === 'export' ? 'Preparing…' : 'Download my data'}
          </button>
          <label style={{ border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
            {backupBusy === 'restore' ? 'Restoring…' : 'Restore from file'}
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              disabled={!!backupBusy}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restoreBackup(f); }}
            />
          </label>
        </div>
        {backupMsg && <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary, #475569)', marginTop: '0.5rem' }}>{backupMsg}</p>}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Recover lost meal days</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 0.6rem', lineHeight: 1.45 }}>
          Missing some past days from your meal log? Pick a backup and this will add back only the days that are currently empty — anything you’ve logged since stays exactly as it is.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={findMealBackups}
            disabled={!!recoverBusy}
            style={{ border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
          >
            {recoverBusy === 'list' ? 'Loading…' : 'Find meal backups'}
          </button>
          {recoverPoints && recoverPoints.length > 0 && (
            <>
              <select
                value={selectedPointId}
                onChange={e => { setSelectedPointId(e.target.value); setMergePreview(null); }}
                disabled={!!recoverBusy}
                style={{ border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.5rem 0.6rem', fontSize: '0.82rem', maxWidth: '100%' }}
              >
                {recoverPoints.map(p => (
                  <option key={p.id} value={p.id}>{fmtPoint(p)}</option>
                ))}
              </select>
              <button
                onClick={previewMerge}
                disabled={!!recoverBusy}
                style={{ border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
              >
                {recoverBusy === 'preview' ? 'Checking…' : 'Preview'}
              </button>
            </>
          )}
        </div>
        {mergePreview && mergePreview.addedDates.length > 0 && (
          <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: 'var(--color-text-secondary, #475569)' }}>
            <p style={{ margin: '0 0 0.35rem' }}>
              Will add <strong>{mergePreview.addedDates.length} day(s)</strong> ({mergePreview.addedEntries} meals) that are missing now:
            </p>
            <p style={{ margin: '0 0 0.5rem', wordBreak: 'break-word' }}>{describeAdded(mergePreview)}</p>
            <button
              onClick={applyMerge}
              disabled={!!recoverBusy}
              style={{ border: 'none', background: 'var(--color-accent, #2563eb)', color: '#fff', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
            >
              {recoverBusy === 'apply' ? 'Restoring…' : `Restore ${mergePreview.addedDates.length} day(s)`}
            </button>
          </div>
        )}

        <div style={{ marginTop: '0.9rem', paddingTop: '0.8rem', borderTop: '1px solid var(--color-border, #e2e8f0)' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 0.5rem', lineHeight: 1.45 }}>
            Have an older backup file? Upload it and it’ll import only the days you’re currently missing.
          </p>
          <label style={{ border: '1px solid var(--color-border, #e2e8f0)', background: '#fff', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'inline-block' }}>
            {recoverBusy === 'filePreview' ? 'Reading…' : 'Import history from file'}
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              disabled={!!recoverBusy}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; setFilePreview(null); setFileLog(null); if (f) onHistoryFile(f); }}
            />
          </label>
          {filePreview && filePreview.addedDates.length > 0 && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: 'var(--color-text-secondary, #475569)' }}>
              <p style={{ margin: '0 0 0.35rem' }}>
                This file will add <strong>{filePreview.addedDates.length} day(s)</strong> ({filePreview.addedEntries} meals) that are missing now:
              </p>
              <p style={{ margin: '0 0 0.5rem', wordBreak: 'break-word' }}>{describeAdded(filePreview)}</p>
              <button
                onClick={applyFileMerge}
                disabled={!!recoverBusy}
                style={{ border: 'none', background: 'var(--color-accent, #2563eb)', color: '#fff', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
              >
                {recoverBusy === 'fileApply' ? 'Importing…' : `Import ${filePreview.addedDates.length} day(s)`}
              </button>
            </div>
          )}
        </div>

        {recoverMsg && <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary, #475569)', marginTop: '0.5rem' }}>{recoverMsg}</p>}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Privacy</h3>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className={styles.link}>
          Privacy Policy
        </a>
      </div>

      <div className={styles.dangerSection}>
        <h3 className={styles.dangerTitle}>Danger Zone</h3>
        {!showDelete ? (
          <button className={styles.dangerBtn} onClick={() => setShowDelete(true)}>
            Delete My Account
          </button>
        ) : (
          <div className={styles.deleteConfirm}>
            <p className={styles.deleteWarning}>
              This will permanently delete your account and all associated data including recipes, meal logs, weight history, and settings. This action cannot be undone.
            </p>
            <div className={styles.deleteActions}>
              <button className={styles.deleteCancelBtn} onClick={() => setShowDelete(false)}>Cancel</button>
              <button className={styles.deleteConfirmBtn} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Yes, Delete My Account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
