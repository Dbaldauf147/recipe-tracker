import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
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
  getUsername,
  getPendingSharedRecipes,
  acceptSharedRecipe,
  declineSharedRecipe,
  toggleRecipeAccess,
  toggleShoppingShare,
  loadFriendRecipes,
} from '../utils/firestoreSync';
import styles from './FriendsPage.module.css';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function FriendsPage({ onClose, addRecipe, importRecipes }) {
  const { user } = useAuth();
  const uid = user?.uid;

  /* ── State ── */
  const [myUsername, setMyUsername] = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null); // { type, msg }

  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState(null); // { uid, username } | 'none'
  const [searchStatus, setSearchStatus] = useState(null);
  const [requestMessage, setRequestMessage] = useState('');

  const [requests, setRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [friends, setFriends] = useState([]);
  const [sharedRecipes, setSharedRecipes] = useState([]);
  const [browseFriend, setBrowseFriend] = useState(null); // { uid, username, loading, recipes }
  const [loading, setLoading] = useState(true);

  /* ── Load initial data ── */
  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      const [name, reqs, sent, frs, shared] = await Promise.all([
        getUsername(uid),
        getPendingRequests(uid),
        getSentRequests(uid),
        loadFriends(uid),
        getPendingSharedRecipes(uid),
      ]);
      setMyUsername(name);
      setRequests(reqs);
      setSentRequests(sent);
      setFriends(frs);
      setSharedRecipes(shared);
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
      // Try username first, then email, then name
      let result = await searchByUsername(val);
      if (!result && val.includes('@')) {
        result = await searchByEmail(val);
      }
      if (!result) {
        result = await searchByName(val);
      }
      if (!result) {
        setSearchResult('none');
        setSearchStatus({ type: 'error', msg: 'User not found. Try their username, email, or full name.' });
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
      const msg = requestMessage.trim();
      await sendFriendRequest(uid, toUid, myUsername, msg || undefined);

      // Send email notification and track result
      const toEmail = searchResult?.email;
      let emailStatus = '';
      if (toEmail) {
        try {
          const emailRes = await fetch('/api/notify-friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toEmail,
              toName: searchResult.username || '',
              fromUsername: myUsername,
              message: msg || undefined,
            }),
          });
          emailStatus = emailRes.ok ? ' Email notification sent.' : ' Email notification failed.';
        } catch {
          emailStatus = ' Email notification failed.';
        }
      } else {
        emailStatus = ' No email on file — notification not sent.';
      }

      setSearchStatus({ type: 'success', msg: `Friend request sent!${emailStatus}` });
      setSearchResult(null);
      setRequestMessage('');
      // Refresh sent requests list
      getSentRequests(uid).then(setSentRequests).catch(() => {});
    } catch {
      setSearchStatus({ type: 'error', msg: 'Failed to send request.' });
    }
  }

  /* ── Cancel sent request ── */
  async function handleCancelRequest(reqId) {
    try {
      await cancelFriendRequest(reqId);
      setSentRequests(prev => prev.filter(r => r.id !== reqId));
    } catch (err) {
      console.error('Cancel request error:', err);
    }
  }

  /* ── Accept / Decline ── */
  async function handleAccept(req) {
    try {
      await acceptFriendRequest(req.id, req.from, uid);

      // Notify the sender that their request was accepted
      try {
        const senderData = await loadUserData(req.from);
        const senderEmail = senderData?.email;
        console.log('Accept notification: sender=', req.from, 'email=', senderEmail, 'myUsername=', myUsername);
        if (senderEmail) {
          const emailRes = await fetch('/api/notify-friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'friend-accepted',
              toEmail: senderEmail,
              toName: req.fromUsername || '',
              fromUsername: myUsername || '',
            }),
          });
          console.log('Accept email sent:', emailRes.ok, emailRes.status);
        } else {
          console.warn('No email found for sender', req.from);
        }
      } catch (emailErr) {
        console.error('Accept notification error:', emailErr);
      }

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

  /* ── Accept / Decline shared recipe ── */
  async function handleAcceptRecipe(share) {
    try {
      await acceptSharedRecipe(share.id);
      if (addRecipe && share.recipe) {
        const { id, ...recipeData } = share.recipe;
        addRecipe({ ...recipeData, source: 'shared', sharedFrom: share.fromUsername || '' });
      }
      setSharedRecipes(prev => prev.filter(s => s.id !== share.id));
    } catch (err) {
      console.error('Accept shared recipe error:', err);
    }
  }

  async function handleDeclineRecipe(share) {
    try {
      await declineSharedRecipe(share.id);
      setSharedRecipes(prev => prev.filter(s => s.id !== share.id));
    } catch (err) {
      console.error('Decline shared recipe error:', err);
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
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
        {myUsername && <span className={styles.myUsernameBadge}>@{myUsername}</span>}
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
                {searchResult.displayName || searchResult.username ? `${searchResult.displayName || ''}${searchResult.username ? ` @${searchResult.username}` : ''}`.trim() : searchResult.email}
              </span>
              {friends.some(f => f.uid === searchResult.uid) ? (
                <span className={styles.emptyText}>Already friends</span>
              ) : (
                <div className={styles.sendRequestWrap}>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="Add a message (optional)"
                    value={requestMessage}
                    onChange={e => setRequestMessage(e.target.value)}
                  />
                  <button className={styles.actionBtn} onClick={() => handleSendRequest(searchResult.uid)}>
                    Send Request
                  </button>
                </div>
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

      <div className={styles.friendsGrid}>
        {/* ── Left: Your Friends ── */}
        <div className={styles.friendsGridCol}>
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
                {(f.hasGrantedAccess || f.hasSharedShoppingWithMe) && (
                  <span className={styles.friendDisplayName}>
                    sharing with you:
                    {f.hasGrantedAccess ? ' recipes' : ''}
                    {f.hasGrantedAccess && f.hasSharedShoppingWithMe ? ',' : ''}
                    {f.hasSharedShoppingWithMe ? ' shopping list' : ''}
                  </span>
                )}
                <div className={styles.friendAccessRow}>
                  <label className={styles.shareToggle}>
                    <input
                      type="checkbox"
                      checked={f.iGrantedAccess}
                      onChange={async (e) => {
                        const grant = e.target.checked;
                        await toggleRecipeAccess(uid, f.uid, grant);
                        setFriends(prev => prev.map(fr => fr.uid === f.uid ? { ...fr, iGrantedAccess: grant } : fr));
                      }}
                    />
                    Share my recipes
                  </label>
                  <label className={styles.shareToggle}>
                    <input
                      type="checkbox"
                      checked={f.iSharedShopping}
                      onChange={async (e) => {
                        const grant = e.target.checked;
                        await toggleShoppingShare(uid, f.uid, grant);
                        setFriends(prev => prev.map(fr => fr.uid === f.uid ? { ...fr, iSharedShopping: grant } : fr));
                      }}
                    />
                    Share my shopping list
                  </label>
                  {f.hasGrantedAccess && (
                    <button
                      className={styles.browseBtn}
                      onClick={async () => {
                        setBrowseFriend(prev => prev?.uid === f.uid ? null : { uid: f.uid, username: f.username || f.displayName, loading: true, recipes: [] });
                        const data = await loadFriendRecipes(f.uid);
                        setBrowseFriend({ uid: f.uid, username: f.username || f.displayName, loading: false, recipes: data.recipes });
                      }}
                    >
                      Browse their recipes
                    </button>
                  )}
                </div>
              </div>
              <button className={styles.dangerBtn} onClick={() => handleRemove(f.uid)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      {/* ── Browse Friend's Recipes ── */}
      {browseFriend && (
        <div className={styles.section}>
          <div className={styles.browseFriendHeader}>
            <h3 className={styles.sectionTitle}>@{browseFriend.username}'s Recipes</h3>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {!browseFriend.loading && browseFriend.recipes.length > 0 && importRecipes && (
                <button
                  className={styles.actionBtn}
                  onClick={() => {
                    const toImport = browseFriend.recipes
                      .filter(r => (r.frequency || 'common') !== 'retired')
                      .map(r => {
                        const { id, ...rest } = r;
                        return { ...rest, source: 'shared', sharedFrom: browseFriend.username || '' };
                      });
                    if (toImport.length > 0) importRecipes(toImport);
                  }}
                >
                  + Add all
                </button>
              )}
              <button className={styles.closeBtn} onClick={() => setBrowseFriend(null)}>&times;</button>
            </div>
          </div>
          {browseFriend.loading ? (
            <p className={styles.emptyText}>Loading recipes...</p>
          ) : browseFriend.recipes.length === 0 ? (
            <p className={styles.emptyText}>No recipes shared.</p>
          ) : (
            <div className={styles.friendRecipeList}>
              {browseFriend.recipes
                .filter(r => (r.frequency || 'common') !== 'retired')
                .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
                .map((r, i) => (
                <div key={r.id || i} className={styles.friendRecipeRow}>
                  <span className={styles.friendRecipeName}>{r.title}</span>
                  <span className={styles.friendRecipeMeta}>
                    {r.category === 'breakfast' ? 'Breakfast' : 'Lunch/Dinner'}
                    {r.prepTime && ` · ${r.prepTime}`}
                  </span>
                  <button
                    className={styles.importBtn}
                    onClick={() => {
                      if (addRecipe) {
                        const { id, ...recipeData } = r;
                        addRecipe({ ...recipeData, source: 'shared', sharedFrom: browseFriend.username || '' });
                      }
                    }}
                  >
                    + Add to My Recipes
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
        </div>

        {/* ── Right: Pending Requests ── */}
        <div className={styles.friendsGridCol}>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Pending Requests</h3>
            {requests.length === 0 ? (
              <p className={styles.emptyText}>No pending requests.</p>
            ) : (
              requests.map(req => (
                <div key={req.id} className={styles.requestRow}>
                  <div className={styles.friendInfo}>
                    <span className={styles.friendUsername}>@{req.fromUsername}</span>
                    {req.message && <span className={styles.requestMsg}>"{req.message}"</span>}
                  </div>
                  <div className={styles.requestActions}>
                    <button className={styles.actionBtn} onClick={() => handleAccept(req)}>Accept</button>
                    <button className={styles.dangerBtn} onClick={() => handleDecline(req)}>Decline</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {sentRequests.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Sent Requests</h3>
              {sentRequests.map(req => (
                <div key={req.id} className={styles.requestRow}>
                  <div className={styles.friendInfo}>
                    <span className={styles.friendUsername}>
                      {req.toUsername ? `@${req.toUsername}` : req.toDisplayName || 'Unknown user'}
                    </span>
                    <span className={styles.sentLabel}>Pending</span>
                  </div>
                  <button className={styles.dangerBtn} onClick={() => handleCancelRequest(req.id)}>
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Shared Recipes</h3>
            {sharedRecipes.length === 0 ? (
              <p className={styles.emptyText}>No shared recipes.</p>
            ) : (
              sharedRecipes.map(share => (
                <div key={share.id} className={styles.requestRow}>
                  <div className={styles.friendInfo}>
                    <span className={styles.friendUsername}>
                      {share.recipe?.title || 'Untitled'}
                    </span>
                    <span className={styles.friendDisplayName}>
                      from @{share.fromUsername}
                    </span>
                  </div>
                  <div className={styles.requestActions}>
                    <button className={styles.actionBtn} onClick={() => handleAcceptRecipe(share)}>Accept</button>
                    <button className={styles.dangerBtn} onClick={() => handleDeclineRecipe(share)}>Decline</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
