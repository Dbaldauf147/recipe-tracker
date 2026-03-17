import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import styles from './AccountSettings.module.css';

export function AccountSettings({ user, onClose }) {
  const { deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

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
