import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { saveField } from '../utils/firestoreSync';
import styles from './AccountSettings.module.css';

const REMINDER_KEY = 'sunday-reminder-settings';

function loadReminderSettings() {
  try { return JSON.parse(localStorage.getItem(REMINDER_KEY) || '{}'); } catch { return {}; }
}

export function AccountSettings({ user, onClose }) {
  const { deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [phone, setPhone] = useState('');
  // Comma-separated emails in a single input. Parsed into an array on save.
  const [reminderEmails, setReminderEmails] = useState('');
  const [foodLogReminder, setFoodLogReminder] = useState(false);
  const [foodLogTime, setFoodLogTime] = useState('17:00');
  const [foodLogDays, setFoodLogDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [weightReminder, setWeightReminder] = useState(false);
  const [weightTime, setWeightTime] = useState('08:00');
  const [reminderSaved, setReminderSaved] = useState(false);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    const s = loadReminderSettings();
    if (s.phone) setPhone(s.phone);
    if (Array.isArray(s.emails) && s.emails.length > 0) {
      setReminderEmails(s.emails.join(', '));
    } else if (s.email) {
      setReminderEmails(s.email);
    }
    if (s.foodLogReminder) setFoodLogReminder(s.foodLogReminder);
    if (s.foodLogTime) setFoodLogTime(s.foodLogTime);
    if (Array.isArray(s.foodLogDays)) setFoodLogDays(s.foodLogDays);
    if (s.weightReminder) setWeightReminder(s.weightReminder);
    if (s.weightTime) setWeightTime(s.weightTime);
  }, []);

  function toggleDay(d) {
    setFoodLogDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  // Accept comma / semicolon / whitespace separators so paste-from-anywhere
  // works, lowercase + dedupe, and drop anything that doesn't look like an
  // address so a stray comma or trailing space doesn't get sent to Resend.
  function parseEmails(raw) {
    return Array.from(new Set(
      String(raw || '')
        .split(/[,;\s]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    ));
  }

  function effectiveEmails() {
    const parsed = parseEmails(reminderEmails);
    if (parsed.length > 0) return parsed;
    if (user?.email) return [user.email.toLowerCase()];
    return [];
  }

  function saveReminders() {
    const emails = effectiveEmails();
    const settings = {
      phone,
      // `emails` is the new authoritative field; `email` kept as the first
      // address so older readers / debug tools that only know about the
      // singular field still see a valid recipient.
      emails,
      email: emails[0] || '',
      foodLogReminder, foodLogTime, foodLogDays, weightReminder, weightTime,
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

        <div className={styles.reminderRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
          <label className={styles.reminderToggle} style={{ cursor: 'default' }}>
            Send reminders to
          </label>
          <input
            type="text"
            className={styles.reminderTimeInput}
            style={{ width: '100%', maxWidth: 360 }}
            value={reminderEmails}
            onChange={e => setReminderEmails(e.target.value)}
            placeholder={user?.email ? `${user.email}, partner@example.com` : 'you@example.com, partner@example.com'}
            autoComplete="email"
          />
          <p className={styles.reminderHint} style={{ marginTop: 0 }}>
            Separate multiple addresses with commas. Leave blank to use your account email ({user?.email || 'unset'}). Save after changing.
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
          <p className={styles.reminderHint}>
            If you haven't logged your weight on a scheduled weigh-in day by {new Date(`2000-01-01T${weightTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}, you'll get a reminder.
          </p>
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
