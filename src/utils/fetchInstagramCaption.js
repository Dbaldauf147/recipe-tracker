/**
 * Fetches an Instagram post's caption by extracting the og:description
 * meta tag from the page HTML, using the existing /api/fetch-url proxy.
 */

export async function fetchInstagramCaption(url) {
  const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = await res.text();
    let message = 'Could not fetch the Instagram post.';
    try { message = JSON.parse(body).error || message; } catch {}
    throw new Error(message);
  }

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const ogDesc = doc.querySelector('meta[property="og:description"]');

  if (!ogDesc || !ogDesc.getAttribute('content')) {
    throw new Error(
      'Could not extract caption from this Instagram post. Try copying the caption manually instead.'
    );
  }

  return ogDesc.getAttribute('content');
}
