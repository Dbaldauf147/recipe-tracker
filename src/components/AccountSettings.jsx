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
  const [foodLogReminder, setFoodLogReminder] = useState(false);
  const [foodLogTime, setFoodLogTime] = useState('20:00');
  const [weightReminder, setWeightReminder] = useState(false);
  const [weightTime, setWeightTime] = useState('08:00');
  const [reminderSaved, setReminderSaved] = useState(false);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    const s = loadReminderSettings();
    if (s.phone) setPhone(s.phone);
    if (s.foodLogReminder) setFoodLogReminder(s.foodLogReminder);
    if (s.foodLogTime) setFoodLogTime(s.foodLogTime);
    if (s.weightReminder) setWeightReminder(s.weightReminder);
    if (s.weightTime) setWeightTime(s.weightTime);
  }, []);

  function saveReminders() {
    const settings = { phone, foodLogReminder, foodLogTime, weightReminder, weightTime };
    localStorage.setItem(REMINDER_KEY, JSON.stringify(settings));
    if (user) saveField(user.uid, 'reminderSettings', settings);
    setReminderSaved(true);
    setTimeout(() => setReminderSaved(false), 2000);
  }

  async function sendTestReminder() {
    if (!phone && !user?.email) { alert('Enter a phone number or have an email on file.'); return; }
    setTestSending(true);
    try {
      const res = await fetch('/api/notify-friend-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'sms-reminder',
          toPhone: phone || '',
          toEmail: user?.email || '',
          smsBody: 'This is a test reminder from Prep Day! Your notifications are working.',
        }),
      });
      alert(res.ok ? 'Test reminder sent!' : 'Failed to send. Check your phone number.');
    } catch {
      alert('Failed to send test reminder.');
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
        <h3 className={styles.sectionTitle}>Reminders</h3>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Phone number:</span>
          <input
            type="tel"
            className={styles.reminderInput}
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+1 (555) 123-4567"
          />
        </div>
        <p className={styles.reminderHint}>
          {phone ? 'SMS reminders will be sent to this number.' : 'Add your phone number for SMS reminders, or leave blank for email reminders.'}
        </p>

        <div className={styles.reminderRow}>
          <label className={styles.reminderToggle}>
            <input type="checkbox" checked={foodLogReminder} onChange={e => setFoodLogReminder(e.target.checked)} />
            Food Log Reminder
          </label>
          {foodLogReminder && (
            <input type="time" className={styles.reminderTimeInput} value={foodLogTime} onChange={e => setFoodLogTime(e.target.value)} />
          )}
        </div>
        {foodLogReminder && (
          <p className={styles.reminderHint}>
            You'll get a reminder if your food log is incomplete by {foodLogTime}.
          </p>
        )}

        <div className={styles.reminderRow}>
          <label className={styles.reminderToggle}>
            <input type="checkbox" checked={weightReminder} onChange={e => setWeightReminder(e.target.checked)} />
            Weight Tracking Reminder
          </label>
          {weightReminder && (
            <input type="time" className={styles.reminderTimeInput} value={weightTime} onChange={e => setWeightTime(e.target.value)} />
          )}
        </div>
        {weightReminder && (
          <p className={styles.reminderHint}>
            You'll get a reminder if you haven't logged your weight by {weightTime}.
          </p>
        )}

        <div className={styles.reminderActions}>
          <button className={styles.reminderSaveBtn} onClick={saveReminders}>
            {reminderSaved ? 'Saved!' : 'Save Reminder Settings'}
          </button>
          <button className={styles.reminderTestBtn} onClick={sendTestReminder} disabled={testSending}>
            {testSending ? 'Sending...' : 'Send Test'}
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
