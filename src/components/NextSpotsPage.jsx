import React, { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { loadMyEatingOutVotes, LEGACY_VOTE_CATEGORY } from '../utils/firestoreSync';
import styles from './EatingOutPage.module.css';

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Reads my eating-out votes + every list I have access to (my own +
// each shared friend) and groups the top-3 picks per category as my
// personal "to try next" queue.
export function NextSpotsPage({ user, sharedFromFriends = [], onClose, onOpenCategory }) {
  const [ownerData, setOwnerData] = useState({});
  const [votes, setVotes] = useState({});
  const [loading, setLoading] = useState(true);

  const sharerUids = useMemo(
    () => sharedFromFriends.map(s => s.uid).filter(Boolean).join('|'),
    [sharedFromFriends],
  );
  const sharerMeta = useMemo(() => {
    const m = {};
    for (const s of sharedFromFriends) m[s.uid] = s.username || 'friend';
    return m;
  }, [sharedFromFriends]);

  useEffect(() => {
    if (!user?.uid) return;
    const ownerUids = [user.uid, ...sharerUids.split('|').filter(Boolean)];
    const unsubs = ownerUids.map(uid => {
      const ref = doc(db, 'users', uid);
      return onSnapshot(ref, (snap) => {
        const data = snap.data() || {};
        const restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
        const username = uid === user.uid ? 'me' : (sharerMeta[uid] || data.username || 'friend');
        setOwnerData(prev => ({ ...prev, [uid]: { username, restaurants } }));
        setLoading(false);
      }, () => { if (uid === user.uid) setLoading(false); });
    });
    return () => { unsubs.forEach(u => u && u()); };
  }, [user?.uid, sharerUids, sharerMeta]);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    loadMyEatingOutVotes(user.uid)
      .then(v => { if (!cancelled) setVotes(v || {}); })
      .catch(() => { /* keep empty */ });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Resolve every restaurantId I've voted on to a full restaurant object
  // plus its owner. Skip categories with no non-null picks.
  const sections = useMemo(() => {
    const out = [];
    for (const [ownerUid, byCat] of Object.entries(votes)) {
      const ownerList = ownerData[ownerUid]?.restaurants || [];
      const byId = new Map(ownerList.map(r => [r.id, r]));
      const ownerUsername = ownerData[ownerUid]?.username || 'unknown';
      for (const [category, arr] of Object.entries(byCat)) {
        if (!Array.isArray(arr)) continue;
        const ranked = [1, 2, 3].map(rank => {
          const id = arr[rank - 1];
          if (!id) return null;
          const r = byId.get(id);
          return r ? { rank, restaurant: r } : null;
        }).filter(Boolean);
        if (ranked.length === 0) continue;
        out.push({
          ownerUid,
          ownerUsername,
          isMine: ownerUid === user?.uid,
          category,
          isLegacy: category === LEGACY_VOTE_CATEGORY,
          picks: ranked,
        });
      }
    }
    // Group by category label so the user sees one row per category even
    // when picks span multiple lists.
    out.sort((a, b) => {
      if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1;
      const ca = a.category.toLowerCase();
      const cb = b.category.toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      return a.ownerUsername.localeCompare(b.ownerUsername);
    });
    return out;
  }, [votes, ownerData, user?.uid]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onClose}>← Back</button>
        <h1 className={styles.title}>Next Spots</h1>
      </div>

      <div className={styles.layout}>
        <main className={styles.main} style={{ width: '100%' }}>
          {loading ? (
            <div className={styles.empty}>Loading…</div>
          ) : sections.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No picks yet</p>
              <p className={styles.emptyText}>
                Open <strong>Eating Out</strong>, pick a category in the sidebar (e.g. <em>coffee shops</em>),
                then tap 🥇 🥈 🥉 on three spots you want to try next. They'll show up here.
              </p>
            </div>
          ) : (
            sections.map(s => (
              <div key={`${s.ownerUid}:${s.category}`} className={styles.nextSpotsSection}>
                <div className={styles.nextSpotsHeader}>
                  <span className={styles.nextSpotsCategory}>
                    🏷 {s.isLegacy ? 'Uncategorized picks' : s.category}
                  </span>
                  <span className={styles.nextSpotsSource}>
                    from {s.isMine ? 'my list' : `@${s.ownerUsername}'s list`}
                  </span>
                  {!s.isLegacy && (
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => onOpenCategory && onOpenCategory(s.category)}
                    >
                      Open in Eating Out
                    </button>
                  )}
                </div>
                <div className={styles.nextSpotsList}>
                  {s.picks.map(p => {
                    const r = p.restaurant;
                    return (
                      <div key={`${p.rank}-${r.id}`} className={styles.nextSpotsRow}>
                        <span className={styles.nextSpotsRank}>{RANK_MEDAL[p.rank]}</span>
                        {r.imageUrl
                          ? <img src={r.imageUrl} alt="" className={styles.nextSpotsImg} />
                          : <div className={`${styles.nextSpotsImg} ${styles.cardImagePlaceholder}`}>🍽️</div>}
                        <div className={styles.nextSpotsBody}>
                          <div className={styles.nextSpotsName}>{r.name}</div>
                          {(r.cuisines?.length > 0 || r.address) && (
                            <div className={styles.nextSpotsMeta}>
                              {[...(r.cuisines || []), r.address].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {r.dish && <div className={styles.nextSpotsDish}>🍴 {r.dish}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
