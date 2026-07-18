import { useState, useEffect, useCallback } from 'react';
import {
  getUsername,
  setUsername,
  searchByUsername,
  searchByEmail,
  searchByName,
  sendFriendRequest,
  getPendingRequests,
  getSentRequests,
  cancelFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  loadFriends,
  loadUserData,
  toggleEatingOutShare,
} from '../utils/firestoreSync';
import styles from './EatingOutPage.module.css';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Friend management scoped to the Eating Out page. Reuses the app-wide friends
 * backend (usernames, friendRequests, users/{uid}.friends) but wires in
 * automatic TWO-WAY eating-out sharing so that once a request is accepted both
 * people can see — and rank — each other's spots without touching a toggle:
 *   - on SEND we pre-share our list with the target (arms the outbound
 *     direction the moment they accept),
 *   - on ACCEPT we share our list back with the sender, plus a best-effort
 *     write to flip their share on too (covers requests sent from the plain
 *     Friends page that never pre-shared).
 * After any mutation we call onFriendsChanged so the parent re-loads the merged
 * restaurant view — the accepted friend's spots then appear live, no reload.
 */
export function EatingOutFriendsPanel({ user, onClose, onFriendsChanged }) {
  const uid = user?.uid;

  const [myUsername, setMyUsername] = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState(null); // result obj | 'none'
  const [searchStatus, setSearchStatus] = useState(null);

  const [requests, setRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    try {
      const [name, reqs, sent, frs] = await Promise.all([
        getUsername(uid),
        getPendingRequests(uid),
        getSentRequests(uid),
        loadFriends(uid),
      ]);
      setMyUsername(name);
      setRequests(reqs);
      setSentRequests(sent);
      setFriends(frs);
    } catch (err) {
      console.error('EatingOutFriendsPanel load error:', err);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSetUsername() {
    const val = usernameInput.trim();
    if (!USERNAME_RE.test(val)) {
      setUsernameStatus({ type: 'error', msg: '3–20 chars: letters, numbers, underscores.' });
      return;
    }
    try {
      await setUsername(uid, val);
      setMyUsername(val.toLowerCase());
      setUsernameInput('');
      setUsernameStatus({ type: 'success', msg: 'Username saved!' });
    } catch (err) {
      setUsernameStatus({ type: 'error', msg: err.message || 'Failed to set username.' });
    }
  }

  async function handleSearch() {
    const val = searchInput.trim().toLowerCase();
    if (!val) return;
    setSearchStatus(null);
    setSearchResult(null);
    try {
      let result = await searchByUsername(val);
      if (!result && val.includes('@')) result = await searchByEmail(val);
      if (!result) result = await searchByName(val);
      if (!result) {
        setSearchResult('none');
        setSearchStatus({ type: 'error', msg: 'No user found. Try their username, email, or full name.' });
      } else if (result.uid === uid) {
        setSearchResult('none');
        setSearchStatus({ type: 'error', msg: "That's you!" });
      } else {
        setSearchResult(result);
      }
    } catch {
      setSearchStatus({ type: 'error', msg: 'Search failed.' });
    }
  }

  async function handleSendRequest(target) {
    if (!myUsername) {
      setSearchStatus({ type: 'error', msg: 'Set a username first so your friend knows who the request is from.' });
      return;
    }
    setBusy(true);
    try {
      const created = await sendFriendRequest(uid, target.uid, myUsername);
      // Pre-share my eating-out list outbound so it's already two-way the
      // instant they accept. Writes only my own doc, so it always succeeds.
      try { await toggleEatingOutShare(uid, target.uid, true); } catch { /* non-fatal */ }

      if (!created) {
        setSearchStatus({ type: 'success', msg: 'You already have a pending request to this person.' });
        setSearchResult(null);
        setBusy(false);
        return;
      }

      // Best-effort email notification (same endpoint the Friends page uses).
      if (target.email) {
        try {
          await fetch('/api/notify-friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toEmail: target.email,
              toName: target.username || '',
              fromUsername: myUsername,
            }),
          });
        } catch { /* ignore */ }
      }

      setSearchStatus({ type: 'success', msg: 'Friend request sent! Your Eating Out list is shared automatically once they accept.' });
      setSearchResult(null);
      getSentRequests(uid).then(setSentRequests).catch(() => {});
      onFriendsChanged?.();
    } catch (err) {
      setSearchStatus({ type: 'error', msg: err.message || 'Failed to send request.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(reqId) {
    try {
      await cancelFriendRequest(reqId);
      setSentRequests(prev => prev.filter(r => r.id !== reqId));
    } catch (err) {
      console.error('Cancel request error:', err);
    }
  }

  async function handleAccept(req) {
    setBusy(true);
    try {
      await acceptFriendRequest(req.id, req.from, uid);
      // Auto two-way: share my list back with the sender (own doc — always
      // works) and best-effort flip their share on too, in case they sent from
      // the plain Friends page and never pre-shared.
      try { await toggleEatingOutShare(uid, req.from, true); } catch { /* non-fatal */ }
      try { await toggleEatingOutShare(req.from, uid, true); } catch { /* rules may block cross-doc write */ }

      // Best-effort "request accepted" email to the sender.
      try {
        const senderData = await loadUserData(req.from);
        if (senderData?.email) {
          await fetch('/api/notify-friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'friend-accepted',
              toEmail: senderData.email,
              toName: req.fromUsername || '',
              fromUsername: myUsername || '',
            }),
          });
        }
      } catch { /* ignore */ }

      await refresh();
      onFriendsChanged?.();
    } catch (err) {
      console.error('Accept error:', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline(req) {
    try {
      await declineFriendRequest(req.id);
      setRequests(prev => prev.filter(r => r.id !== req.id));
    } catch (err) {
      console.error('Decline error:', err);
    }
  }

  async function handleToggleShare(friend, grant) {
    // Optimistic; revert on failure.
    setFriends(prev => prev.map(f => f.uid === friend.uid ? { ...f, iSharedEatingOut: grant } : f));
    try {
      await toggleEatingOutShare(uid, friend.uid, grant);
      onFriendsChanged?.();
    } catch (err) {
      console.error('Toggle eating-out share error:', err);
      setFriends(prev => prev.map(f => f.uid === friend.uid ? { ...f, iSharedEatingOut: !grant } : f));
    }
  }

  async function handleRemove(friendUid) {
    try {
      await removeFriend(uid, friendUid);
      setFriends(prev => prev.filter(f => f.uid !== friendUid));
      onFriendsChanged?.();
    } catch (err) {
      console.error('Remove friend error:', err);
    }
  }

  const statusStyle = (t) => ({
    margin: '0.35rem 0 0',
    fontSize: '0.82rem',
    color: t === 'error' ? '#dc2626' : 'var(--color-accent, #16a34a)',
  });
  const sectionLabel = {
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--color-text-muted)',
    margin: '1rem 0 0.4rem',
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>👥 Eating Out friends</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.modalBody}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Add a friend here and once they accept, you'll both see each other's spots on this
            page and can rank them together.
          </p>

          {!uid ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Sign in to add friends and share your Eating Out list.
            </p>
          ) : loading ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Loading…</p>
          ) : (
            <>
              {/* ── Username (must exist before you can send requests) ── */}
              {!myUsername ? (
                <>
                  <div style={sectionLabel}>Pick a username so friends can find you</div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="Choose a username"
                      value={usernameInput}
                      onChange={e => setUsernameInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSetUsername()}
                    />
                    <button type="button" className={styles.primaryBtn} onClick={handleSetUsername}>Save</button>
                  </div>
                  {usernameStatus && <p style={statusStyle(usernameStatus.type)}>{usernameStatus.msg}</p>}
                </>
              ) : (
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  You are <strong>@{myUsername}</strong>
                </div>
              )}

              {/* ── Add friend ── */}
              {myUsername && (
                <>
                  <div style={sectionLabel}>Add a friend</div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="Search by username, email, or name"
                      value={searchInput}
                      onChange={e => setSearchInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    />
                    <button type="button" className={styles.secondaryBtn} onClick={handleSearch}>Search</button>
                  </div>
                  {searchResult && searchResult !== 'none' && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '0.5rem', padding: '0.5rem 0.65rem', marginTop: '0.4rem',
                      border: '1px solid var(--color-border)', borderRadius: '10px',
                    }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        {searchResult.displayName || ''}{searchResult.username ? ` @${searchResult.username}` : (searchResult.displayName ? '' : searchResult.email)}
                      </span>
                      {friends.some(f => f.uid === searchResult.uid) ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Already friends</span>
                      ) : (
                        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => handleSendRequest(searchResult)}>
                          Send request
                        </button>
                      )}
                    </div>
                  )}
                  {searchStatus && <p style={statusStyle(searchStatus.type)}>{searchStatus.msg}</p>}
                </>
              )}

              {/* ── Incoming requests ── */}
              {requests.length > 0 && (
                <>
                  <div style={sectionLabel}>Requests for you</div>
                  {requests.map(req => (
                    <div key={req.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '0.5rem', padding: '0.5rem 0.65rem',
                      border: '1px solid var(--color-border)', borderRadius: '10px',
                    }}>
                      <span style={{ fontSize: '0.9rem' }}>
                        {req.fromUsername ? `@${req.fromUsername}` : 'Someone (no username)'}
                        {req.message && <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>"{req.message}"</span>}
                      </span>
                      <span style={{ display: 'flex', gap: '0.4rem' }}>
                        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => handleAccept(req)}>Accept</button>
                        <button type="button" className={styles.secondaryBtn} onClick={() => handleDecline(req)}>Decline</button>
                      </span>
                    </div>
                  ))}
                </>
              )}

              {/* ── Your eating-out friends ── */}
              <div style={sectionLabel}>Your friends</div>
              {friends.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
                  No friends yet. Search above to add one.
                </p>
              ) : (
                friends.map(f => (
                  <div key={f.uid} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '0.5rem', padding: '0.55rem 0.65rem',
                    border: '1px solid var(--color-border)', borderRadius: '10px',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        {f.username ? `@${f.username}` : (f.displayName || 'friend')}
                      </span>
                      <span style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                        {f.hasSharedEatingOutWithMe
                          ? '✓ Shares their spots with you'
                          : 'Not sharing their spots yet'}
                      </span>
                      <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!f.iSharedEatingOut}
                          onChange={e => handleToggleShare(f, e.target.checked)}
                        />
                        Share my spots with them
                      </label>
                    </div>
                    <button type="button" className={styles.secondaryBtn} onClick={() => handleRemove(f.uid)}>Remove</button>
                  </div>
                ))
              )}

              {/* ── Sent requests ── */}
              {sentRequests.length > 0 && (
                <>
                  <div style={sectionLabel}>Waiting on</div>
                  {sentRequests.map(req => (
                    <div key={req.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '0.5rem', padding: '0.45rem 0.65rem',
                      border: '1px solid var(--color-border)', borderRadius: '10px',
                    }}>
                      <span style={{ fontSize: '0.88rem' }}>
                        {req.toUsername ? `@${req.toUsername}` : (req.toDisplayName || 'Unknown user')}
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>pending</span>
                      </span>
                      <button type="button" className={styles.secondaryBtn} onClick={() => handleCancel(req.id)}>Cancel</button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        <div className={styles.modalFooter}>
          <span className={styles.footerSpacer} />
          <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
