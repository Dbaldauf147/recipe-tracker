// Bringing the two halves of one person back together.
//
// When Sign in with Apple forks an account (see duplicateAccounts.js), the
// person's history is SPLIT: recipes they saved on the website are on one uid,
// everything they've done in the app on another. Neither is a copy of the other.
//
// Two rules govern everything here, both because the identity behind a relay
// address can only ever be asserted by a human:
//
//   ADDITIVE      Nothing is deleted and nothing is overwritten. Recipes are
//                 matched by id and only the ones missing from the target are
//                 copied. Re-running it changes nothing the second time.
//   NON-DESTRUCTIVE TO THE SOURCE
//                 The source account is left exactly as it was. If the link
//                 turns out to be wrong, the fix is to delete the copied ids
//                 from the target — which is why every merge records what it
//                 moved, on the target, under `mergeHistory`.
//
// A merge that deleted the source would make a misidentification unrecoverable,
// so it doesn't.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

/** Recipes live in their own doc; read one account's list. */
async function readRecipes(uid) {
  try {
    const snap = await getDoc(doc(db, `users/${uid}/data/recipes`));
    if (!snap.exists()) return [];
    const list = snap.data()?.recipes;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * What a merge WOULD do. Always call this first and show it — the confirmation
 * has to name what moves, not just ask "are you sure".
 */
export async function previewMerge(sourceUid, targetUid) {
  const [src, tgt] = await Promise.all([readRecipes(sourceUid), readRecipes(targetUid)]);
  const have = new Set(tgt.map(r => r?.id).filter(Boolean));
  const incoming = src.filter(r => r?.id && !have.has(r.id));
  return {
    sourceRecipes: src.length,
    targetRecipes: tgt.length,
    willCopy: incoming.length,
    alreadyThere: src.length - incoming.length,
    titles: incoming.map(r => r?.title || 'Untitled'),
  };
}

/**
 * Copy the source's missing recipes into the target.
 *
 * Returns what it actually did, which is also what gets written to the target's
 * `mergeHistory` so the move can be traced — and undone — later.
 */
export async function mergeRecipes(sourceUid, targetUid) {
  if (!sourceUid || !targetUid || sourceUid === targetUid) {
    throw new Error('Merge needs two different accounts.');
  }
  const [src, tgt] = await Promise.all([readRecipes(sourceUid), readRecipes(targetUid)]);
  const have = new Set(tgt.map(r => r?.id).filter(Boolean));
  const incoming = src.filter(r => r?.id && !have.has(r.id));
  if (incoming.length === 0) {
    return { copied: 0, ids: [], note: 'Nothing to copy — the target already has every recipe.' };
  }

  const record = {
    at: new Date().toISOString(),
    from: sourceUid,
    copiedIds: incoming.map(r => r.id),
    copiedTitles: incoming.map(r => r?.title || 'Untitled'),
  };

  const prior = await getDoc(doc(db, 'users', targetUid));
  const history = Array.isArray(prior.data()?.mergeHistory) ? prior.data().mergeHistory : [];

  // Recipes first: if the history write fails the data is still there, whereas
  // history claiming a merge that didn't happen would be a lie in the record.
  await setDoc(doc(db, `users/${targetUid}/data/recipes`), { recipes: [...tgt, ...incoming] }, { merge: true });
  await setDoc(doc(db, 'users', targetUid), { mergeHistory: [...history, record] }, { merge: true });

  return { copied: incoming.length, ids: record.copiedIds, titles: record.copiedTitles };
}

/**
 * Undo a merge: remove exactly the ids it copied. The source was never touched,
 * so this restores both accounts to their pre-merge state.
 */
export async function undoMerge(targetUid, record) {
  const ids = new Set((record?.copiedIds || []).filter(Boolean));
  if (ids.size === 0) return { removed: 0 };
  const tgt = await readRecipes(targetUid);
  const kept = tgt.filter(r => !ids.has(r?.id));
  await setDoc(doc(db, `users/${targetUid}/data/recipes`), { recipes: kept }, { merge: true });
  const prior = await getDoc(doc(db, 'users', targetUid));
  const history = (Array.isArray(prior.data()?.mergeHistory) ? prior.data().mergeHistory : [])
    .filter(h => h?.at !== record?.at);
  await setDoc(doc(db, 'users', targetUid), { mergeHistory: history }, { merge: true });
  return { removed: tgt.length - kept.length };
}
