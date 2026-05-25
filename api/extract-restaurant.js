// Vercel serverless function: best-effort restaurant extraction from a URL.
// For Instagram URLs, fetches the embed caption and returns the first
// @-mentioned account as the suggested restaurant name. For other URLs,
// parses OpenGraph / Twitter card metadata.
// Auto-routed at /api/extract-restaurant?url=...

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function metaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

async function extractFromInstagram(url) {
  const match = url.match(/instagram\.com\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
  if (!match) return null;
  const shortcode = match[1];
  const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/captioned/`;

  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    },
  });
  if (!response.ok) return null;
  const html = await response.text();

  // Extract caption from the embed HTML — try multiple patterns.
  let captionMatch = html.match(/class="Caption"[^>]*>(.*?)<\/div>/s);
  if (!captionMatch) captionMatch = html.match(/"caption":\s*\{[^}]*"text":"((?:[^"\\]|\\.)*)"/);
  if (!captionMatch) captionMatch = html.match(/"edge_media_to_caption".*?"text":"((?:[^"\\]|\\.)*)"/);
  let caption = '';
  if (captionMatch) {
    caption = captionMatch[1];
    try { caption = JSON.parse(`"${caption}"`); } catch {}
    caption = caption.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    caption = decodeEntities(caption);
    caption = caption.replace(/^[\w.]+/, '').trim();
    caption = caption.replace(/View all \d+ comments\s*$/, '').trim();
  }

  // Suggested name: first @mention in the caption that isn't the original
  // poster. Falls back to the first capitalized phrase, then to ''.
  let suggestedName = '';
  const mentions = [...caption.matchAll(/@([A-Za-z0-9_.]{2,})/g)].map(m => m[1]);
  if (mentions.length > 0) {
    suggestedName = mentions[0];
  } else {
    const cap = caption.match(/\b([A-Z][A-Za-z'’&]{1,}(?:\s+[A-Z][A-Za-z'’&]{1,}){0,3})\b/);
    if (cap) suggestedName = cap[1];
  }

  // Pull a thumbnail from the embed page.
  let imageUrl = null;
  const imgMatch = html.match(/<img[^>]+class="[^"]*EmbeddedMediaImage[^"]*"[^>]+src="([^"]+)"/i)
    || html.match(/property="og:image"\s+content="([^"]+)"/i);
  if (imgMatch) imageUrl = imgMatch[1].replace(/&amp;/g, '&');

  return {
    name: suggestedName,
    description: caption,
    imageUrl,
    sourceUrl: url,
    source: 'instagram',
  };
}

async function extractFromGenericUrl(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
  });
  if (!response.ok) return null;
  const html = await response.text();

  const ogTitle = metaContent(html, 'og:title');
  const ogSiteName = metaContent(html, 'og:site_name');
  const twTitle = metaContent(html, 'twitter:title');
  const ogDescription = metaContent(html, 'og:description') || metaContent(html, 'description') || '';
  const ogImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');

  // og:site_name tends to be the brand (best for restaurants).
  // Fall back to og:title / twitter:title / <title>.
  let name = ogSiteName || ogTitle || twTitle || '';
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) name = decodeEntities(titleMatch[1].trim());
  }
  // Strip common " | Brand" / " - Brand" tail when og:site_name is present.
  if (ogSiteName && ogTitle && ogTitle.endsWith(ogSiteName)) {
    name = ogSiteName;
  }

  return {
    name: name.split(/\s+[-–|]\s+/)[0].trim(),
    description: ogDescription,
    imageUrl: ogImage,
    sourceUrl: url,
    source: 'web',
  };
}

// Google Maps share URLs: name + coords parsed from the resolved long URL.
// Shapes we handle:
//   maps.app.goo.gl/XXXX  → 302 redirect to long URL
//   goo.gl/maps/XXXX      → 302 redirect (older short form)
//   www.google.com/maps/place/Place+Name/@40.7128,-74.0060,15z/data=...
//   maps.google.com/?q=...
function isGoogleMapsUrl(url) {
  return /(?:^|\.)(?:google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url);
}

async function resolveRedirect(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      },
    });
    return r.url || url;
  } catch {
    return url;
  }
}

async function extractFromGoogleMaps(url) {
  // Short forms need to redirect to the canonical /maps/place/... URL first.
  const isShort = /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url);
  const longUrl = isShort ? await resolveRedirect(url) : url;

  // Name: the segment immediately after /maps/place/ — URL-encoded, with
  // + standing in for spaces.
  let name = '';
  const placeMatch = longUrl.match(/\/maps\/place\/([^/?#@]+)/i);
  if (placeMatch) {
    try {
      name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
    } catch {
      name = placeMatch[1].replace(/\+/g, ' ').trim();
    }
  } else {
    // /?q=Place+Name or /?query=... variant.
    const qMatch = longUrl.match(/[?&](?:q|query)=([^&]+)/i);
    if (qMatch) {
      try { name = decodeURIComponent(qMatch[1].replace(/\+/g, ' ')).trim(); } catch { /* ignore */ }
    }
  }

  // Coordinates: @lat,lng,zoomz segment. lat/lng are signed floats.
  let lat = null;
  let lng = null;
  const atMatch = longUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const a = parseFloat(atMatch[1]);
    const b = parseFloat(atMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) { lat = a; lng = b; }
  }

  if (!name && lat == null) return null;

  return {
    name,
    description: '',
    imageUrl: null,
    address: undefined, // Google Maps URLs don't reliably carry the address; user can Lookup.
    lat: lat ?? undefined,
    lng: lng ?? undefined,
    sourceUrl: longUrl,
    source: 'google-maps',
  };
}

export default async function handler(req, res) {
  const url = req.query?.url || req.body?.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const isInstagram = /(^|\.)instagram\.com\//i.test(url);
    const isGoogleMaps = isGoogleMapsUrl(url);
    let result;
    let source;
    if (isGoogleMaps) {
      result = await extractFromGoogleMaps(url);
      source = 'google-maps';
    } else if (isInstagram) {
      result = await extractFromInstagram(url);
      source = 'instagram';
    } else {
      result = await extractFromGenericUrl(url);
      source = 'web';
    }

    if (!result) {
      return res.status(200).json({
        name: '',
        description: '',
        imageUrl: null,
        sourceUrl: url,
        source,
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to fetch URL' });
  }
}
