import React, { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import styles from './EatingOutPage.module.css';

// How many top-ranked spots to surface per list.
const TOP_N = 5;

// Shows the top of every Eating Out list I have access to (my own + each
// shared friend) as my "to try next" queue. Ranking is the master order of
// each list (the `restaurants` array order), so the top items are simply the
// highest-ranked spots — numbered 1, 2, 3…
export function NextSpotsPage({ user, sharedFromFriends = [], onClose, onOpenCategory }) {
  const [ownerData, setOwnerData] = useState({});
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

  // One section per accessible list, each showing its top N spots in rank
  // (master) order. Retired spots are skipped.
  const sections = useMemo(() => {
    const out = [];
    for (const [ownerUid, entry] of Object.entries(ownerData)) {
      const list = Array.isArray(entry?.restaurants) ? entry.restaurants : [];
      const picks = list
        .filter(r => r && r.frequency !== 'retired')
        .slice(0, TOP_N)
        .map((r, i) => ({ rank: i + 1, restaurant: r }));
      if (picks.length === 0) continue;
      out.push({
        ownerUid,
        ownerUsername: entry?.username || 'unknown',
        isMine: ownerUid === user?.uid,
        picks,
      });
    }
    out.sort((a, b) => {
      if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
      return a.ownerUsername.localeCompare(b.ownerUsername);
    });
    return out;
  }, [ownerData, user?.uid]);

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
              <p className={styles.emptyTitle}>No spots yet</p>
              <p className={styles.emptyText}>
                Add places in <strong>Eating Out</strong> and use the ▲▼ arrows to rank them.
                Your top picks show up here.
              </p>
            </div>
          ) : (
            sections.map(s => (
              <div key={s.ownerUid} className={styles.nextSpotsSection}>
                <div className={styles.nextSpotsHeader}>
                  <span className={styles.nextSpotsCategory}>
                    🍽 {s.isMine ? 'My top spots' : `@${s.ownerUsername}'s top spots`}
                  </span>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => (onOpenCategory ? onOpenCategory(null) : onClose && onClose())}
                  >
                    Open in Eating Out
                  </button>
                </div>
                <div className={styles.nextSpotsList}>
                  {s.picks.map(p => {
                    const r = p.restaurant;
                    return (
                      <div key={r.id} className={styles.nextSpotsRow}>
                        <span className={styles.nextSpotsRank}>#{p.rank}</span>
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
