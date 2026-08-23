// Handing a shared link off to the native Prep Day app.
//
// A share link is `prep-day.com?share=<token>` — one URL, sent by text, that
// has to work for everyone: a stranger on a laptop, a friend with the app
// already on their home screen. The website is the safe default (it always
// works), so the app is offered rather than forced: the recipient picks.
//
// The handoff is a custom scheme, not a Universal Link. That matters:
// `prepday://` is already the app's registered scheme, so this works on every
// build already installed. Associated domains would open the app with no
// prompt at all — but they cannot ship over the air, so nobody would get it
// until they updated, and they would take the choice away.

export const APP_STORE_URL = 'https://apps.apple.com/app/prep-day/id6760323206';

/**
 * The deep link that lands on the app's /share route (app/share.tsx in the
 * PrepDay repo), which reads the same sharedLinks/{token} doc this page does.
 */
export function sharedRecipeAppLink(token) {
  const clean = String(token || '').trim();
  if (!clean) return '';
  return `prepday://share?token=${encodeURIComponent(clean)}`;
}

/**
 * 'ios' | 'android' | null — null meaning "don't offer the app here".
 *
 * Desktop is deliberately excluded: there is no app to open, and a button that
 * does nothing on the one platform where the website is unambiguously the
 * right answer is worse than no button.
 *
 * iPadOS 13+ reports a desktop Safari user agent, so it is identified the only
 * way left: a "Macintosh" that reports touch points.
 */
export function detectMobilePlatform(userAgent = '', maxTouchPoints = 0) {
  const ua = String(userAgent);
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && Number(maxTouchPoints) > 1) return 'ios';
  return null;
}
