import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { saveField } from '../utils/firestoreSync';
import styles from './AccountSettings.module.css';

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
  const [phone, setPhone] = useState('');
  // Per-email day routing: each row is { email, days[] }. A reminder due on a
  // given weekday is sent to every row whose `days` includes that weekday.
  const [emailSchedules, setEmailSchedules] = useState([{ email: '', days: [...ALL_DAYS] }]);
  const [foodLogReminder, setFoodLogReminder] = useState(false);
  const [foodLogTime, setFoodLogTime] = useState('17:00');
  const [foodLogDays, setFoodLogDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [weightReminder, setWeightReminder] = useState(false);
  const [weightTime, setWeightTime] = useState('08:00');
  const [weightDays, setWeightDays] = useState([0, 1, 2, 3, 4, 5, 6]);
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
      })));
    } else if (Array.isArray(s.emails) && s.emails.length > 0) {
      setEmailSchedules(s.emails.map(e => ({ email: e, days: [...ALL_DAYS] })));
    } else if (s.email) {
      setEmailSchedules([{ email: s.email, days: [...ALL_DAYS] }]);
    } else if (user?.email) {
      setEmailSchedules([{ email: user.email.toLowerCase(), days: [...ALL_DAYS] }]);
    }
    if (s.foodLogReminder) setFoodLogReminder(s.foodLogReminder);
    if (s.foodLogTime) setFoodLogTime(s.foodLogTime);
    if (Array.isArray(s.foodLogDays)) setFoodLogDays(s.foodLogDays);
    if (s.weightReminder) setWeightReminder(s.weightReminder);
    if (s.weightTime) setWeightTime(s.weightTime);
    if (Array.isArray(s.weightDays)) setWeightDays(s.weightDays);
  }, []);

  function toggleDay(d) {
    setFoodLogDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }
  function toggleWeightDay(d) {
    setWeightDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
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
  function addScheduleRow() {
    setEmailSchedules(prev => [...prev, { email: '', days: [...ALL_DAYS] }]);
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
      out.push({ email, days });
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
            Each address only gets reminders on the days you highlight — e.g. send weekday reminders to one inbox and weekend ones to another. Applies to both meal and weight reminders. Save after changing.
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
