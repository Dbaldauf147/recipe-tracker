// Accounts you can't put a name to, and the link between the two halves of one
// person.
//
// Sign in with Apple hands Firebase a per-app relay address
// (bynzwr9kdz@privaterelay.appleid.com) instead of the user's real email. So
// somebody who signed up on the website as rachaelroy@mac.com and later
// installed the app and tapped "Sign in with Apple" becomes TWO accounts, with
// two different emails and nothing joining them. The admin cleanup de-dupes by
// email, which structurally cannot catch this: the emails genuinely differ.
//
// The symptom is a named account that reads as abandoned ("Last App Login —")
// while its owner uses the app daily under a hex string nobody recognises.
//
// AUTOMATIC MATCHING WAS TRIED AND REMOVED. Scoring on the shape of the fork
// (Apple-domain email, web-only vs app-only, one going quiet as the other
// starts) proposed the SAME person for four different relay accounts, because
// the fork splits a person's data instead of copying it — the two halves have
// nothing in common to match on, and a relay address is designed not to be
// traceable. A confident-looking wrong guess here ends with one person's data
// in another person's account, so the link is recorded only when a human who
// actually knows says so: `accountLinks` on the admin's own user doc, written
// from the dashboard.

const RELAY_RE = /@privaterelay\.appleid\.com$/i;

export function isRelayEmail(email) {
  return RELAY_RE.test(String(email || '').trim());
}

/** Nobody could tell who this is from the users table. */
export function isAnonymousAccount(u) {
  return !String(u?.displayName || '').trim() || isRelayEmail(u?.email);
}

/** Why it's unidentifiable, for the badge. */
export function anonymousReason(u) {
  if (isRelayEmail(u?.email)) return 'Apple relay address — the real email is hidden';
  if (!String(u?.displayName || '').trim()) return 'No display name set';
  return '';
}

/**
 * What this account has actually done, so an unnamed row can still be judged.
 * Everything here is a fact on the record, not an inference.
 */
export function accountEvidence(u) {
  const bits = [];
  const app = u?.mobileLastLogin;
  const web = u?.lastLogin;
  if (app) bits.push(`app ${(u.mobileLoginCount || 0)}× — last ${String(app).slice(0, 10)}`);
  if (web) bits.push(`web ${(u.loginCount || 0)}× — last ${String(web).slice(0, 10)}`);
  if (!app && !web) bits.push('never signed in');
  const recipes = Array.isArray(u?.recipes) ? u.recipes.length : (u?.recipeCount || 0);
  if (recipes) bits.push(`${recipes} recipe${recipes === 1 ? '' : 's'}`);
  return bits;
}

/**
 * Resolve a display label for an account, preferring a link the admin has made.
 * `links` is { [uid]: { name, mergedInto } } from the admin's `accountLinks`.
 */
export function labelFor(u, links = {}) {
  const linked = links?.[u?.uid]?.name;
  if (linked) return linked;
  return String(u?.displayName || '').trim() || u?.email || u?.uid || '';
}

/** Accounts needing a human to say who they are, most recently active first. */
export function unidentifiedAccounts(users, links = {}) {
  return (Array.isArray(users) ? users : [])
    .filter(u => isAnonymousAccount(u) && !links?.[u.uid]?.name)
    .sort((a, b) => {
      const la = [a.mobileLastLogin, a.lastLogin].filter(Boolean).sort().pop() || '';
      const lb = [b.mobileLastLogin, b.lastLogin].filter(Boolean).sort().pop() || '';
      return lb.localeCompare(la);
    });
}
