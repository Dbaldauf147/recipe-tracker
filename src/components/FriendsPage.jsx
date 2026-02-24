import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  setUsername,
  searchByUsername,
  searchByEmail,
  sendFriendRequest,
  getPendingRequests,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  loadFriends,
  getUsername,
} from '../utils/firestoreSync';
import styles from './FriendsPage.module.css';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function FriendsPage({ onClose }) {
  const { user } = useAuth();
  const uid = user?.uid;

  /* ── State ── */
  const [myUsername, setMyUsername] = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null); // { type, msg }

  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState(null); // { uid, username } | 'none'
  const [searchStatus, setSearchStatus] = useState(null);

  const [requests, setRequests] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ── Load initial data ── */
  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      const [name, reqs, frs] = await Promise.all([
        getUsername(uid),
        getPendingRequests(uid),
        loadFriends(uid),
      ]);
      setMyUsername(name);
      setRequests(reqs);
      setFriends(frs);
    } catch (err) {
      console.error('FriendsPage load error:', err);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { refresh(); }, [refresh]);

  /* ── Claim username ── */
  async function handleSetUsername() {
    const val = usernameInput.trim();
    if (!USERNAME_RE.test(val)) {
      setUsernameStatus({ type: 'error', msg: 'Must be 3-20 chars: letters, numbers, underscores.' });
      return;
    }
    try {
      await setUsername(uid, val);
      setMyUsername(val.toLowerCase());
      setUsernameStatus({ type: 'success', msg: 'Username saved!' });
    } catch (err) {
      setUsernameStatus({ type: 'error', msg: err.message || 'Failed to set username.' });
    }
  }

  /* ── Search ── */
  async function handleSearch() {
    const val = searchInput.trim().toLowerCase();
    if (!val) return;
    setSearchStatus(null);
    setSearchResult(null);
    try {
      // Try username first, then email
      let result = await searchByUsername(val);
      if (!result && val.includes('@')) {
        result = await searchByEmail(val);
      }
      if (!result) {
        setSearchResult('none');
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

  /* ── Send request ── */
  async function handleSendRequest(toUid) {
    try {
      await sendFriendRequest(uid, toUid, myUsername);
      setSearchStatus({ type: 'success', msg: 'Friend request sent!' });
      setSearchResult(null);
    } catch {
      setSearchStatus({ type: 'error', msg: 'Failed to send request.' });
    }
  }

  /* ── Accept / Decline ── */
  async function handleAccept(req) {
    try {
      await acceptFriendRequest(req.id, req.from, uid);
      await refresh();
    } catch (err) {
      console.error('Accept error:', err);
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

  /* ── Remove friend ── */
  async function handleRemove(friendUid) {
    try {
      await removeFriend(uid, friendUid);
      setFriends(prev => prev.filter(f => f.uid !== friendUid));
    } catch (err) {
      console.error('Remove error:', err);
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
          <h2 className={styles.title}>Friends</h2>
        </div>
        <p className={styles.emptyText}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
        <h2 className={styles.title}>Friends</h2>
      </div>

      {/* ── Your Username ── */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Your Username</h3>
        {myUsername ? (
          <span className={styles.usernameDisplay}>@{myUsername}</span>
        ) : (
          <>
            <div className={styles.searchRow}>
              <input
                className={styles.input}
                type="text"
                placeholder="Choose a username"
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSetUsername()}
              />
              <button className={styles.searchBtn} onClick={handleSetUsername}>
                Save
              </button>
            </div>
            {usernameStatus && (
              <p className={usernameStatus.type === 'error' ? styles.statusError : styles.statusSuccess}>
                {usernameStatus.msg}
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Add Friend ── */}
      {myUsername && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Add Friend</h3>
          <div className={styles.searchRow}>
            <input
              className={styles.input}
              type="text"
              placeholder="Search by username or email"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button className={styles.searchBtn} onClick={handleSearch}>
              Search
            </button>
          </div>
          {searchResult === 'none' && !searchStatus && (
            <p className={styles.statusError}>No user found.</p>
          )}
          {searchResult && searchResult !== 'none' && (
            <div className={styles.resultCard}>
              <span className={styles.resultName}>
                {searchResult.username ? `@${searchResult.username}` : searchResult.email}
              </span>
              {friends.some(f => f.uid === searchResult.uid) ? (
                <span className={styles.emptyText}>Already friends</span>
              ) : (
                <button className={styles.actionBtn} onClick={() => handleSendRequest(searchResult.uid)}>
                  Send Request
                </button>
              )}
            </div>
          )}
          {searchStatus && (
            <p className={searchStatus.type === 'error' ? styles.statusError : styles.statusSuccess}>
              {searchStatus.msg}
            </p>
          )}
        </div>
      )}

      {/* ── Pending Requests ── */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Pending Requests</h3>
        {requests.length === 0 ? (
          <p className={styles.emptyText}>No pending requests.</p>
        ) : (
          requests.map(req => (
            <div key={req.id} className={styles.requestRow}>
              <span className={styles.friendUsername}>@{req.fromUsername}</span>
              <div className={styles.requestActions}>
                <button className={styles.actionBtn} onClick={() => handleAccept(req)}>Accept</button>
                <button className={styles.dangerBtn} onClick={() => handleDecline(req)}>Decline</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Your Friends ── */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Your Friends</h3>
        {friends.length === 0 ? (
          <p className={styles.emptyText}>No friends yet.</p>
        ) : (
          friends.map(f => (
            <div key={f.uid} className={styles.friendRow}>
              <div className={styles.friendInfo}>
                <span className={styles.friendUsername}>@{f.username}</span>
                {f.displayName && <span className={styles.friendDisplayName}>{f.displayName}</span>}
              </div>
              <button className={styles.dangerBtn} onClick={() => handleRemove(f.uid)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
