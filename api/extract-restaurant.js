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
  // Host must start right after "//" or a subdomain "." — but NOT be anchored so
  // tightly that `https://maps.google.com` (host right after the slashes) is
  // missed. Covers google.<tld>/maps, maps.google.<tld>, and the short forms.
  return /(?:\/\/|\.)(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url);
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

// A MOBILE user agent, and it has to stay one.
//
// A maps.app.goo.gl short link is a Firebase deep link. Asked with a DESKTOP
// browser UA, Google answers 200 with a JavaScript interstitial ("Durable Deep
// Link UI") that contains no destination at all — no redirect, no canonical to
// the place, nothing to parse — so every short link resolved to nothing and the
// place came through unnamed. Asked with a mobile UA (or curl's, or none), the
// very same link answers 302 straight to
// maps.google.com?q=<Name>,+<Address>&ftid=… , which is where the name comes
// from. Nothing about the share source matters: ?g_st=… is only Google noting
// which app the link was shared from, and ig / the share-extension bundle id /
// no g_st at all behave identically.
const MAPS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function fetchGoogleMapsHtml(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': MAPS_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    return { html: await r.text(), finalUrl: r.url || url };
  } catch {
    return { html: '', finalUrl: url };
  }
}

// Google's short-link redirect packs the name AND the address into one ?q=:
// "Ivan Ramen, 25 Clinton St, New York, NY 10002". Split at the first comma
// whose remainder looks like an address (has a digit in it), so the name is the
// name and the rest is available as the address. A name that merely contains a
// comma ("Dave's, Inc") has no digits after it and is left whole.
function splitNameAndAddress(q) {
  const parts = String(q || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return { name: String(q || '').trim(), address: '' };
  const rest = parts.slice(1).join(', ');
  if (!/\d/.test(rest)) return { name: String(q || '').trim(), address: '' };
  return { name: parts[0], address: rest };
}

async function extractFromGoogleMaps(url) {
  // Fetch the page following redirects — this resolves short links
  // (maps.app.goo.gl / goo.gl/maps) to the canonical /maps/place/<Name>/@lat,lng
  // URL, which is where we read the name and coords from.
  const { html, finalUrl } = await fetchGoogleMapsHtml(url);
  const longUrl = finalUrl || url;

  // Name candidates, in priority order. The URL is the reliable source: Google
  // now serves a generic og:title/<title> of just "Google Maps" to non-JS
  // clients, so the page metadata can't be trusted for the place name.
  //   1. /maps/place/<Name>/ segment of the URL (resolved, then original)
  //   2. ?q=Name / ?query=Name from the URL
  //   3. og:title / twitter:title — only when it's a real title, not the
  //      "Google Maps" placeholder Google serves to servers
  const isCoordPair = (s) => /^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(s);
  const decodePlus = (s) => {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')).trim(); }
    catch { return s.replace(/\+/g, ' ').trim(); }
  };
  // A ?q= can hold a machine identifier rather than a place name — those must
  // never become the restaurant's name.
  // Matches anywhere, not just at the start: a candidate can arrive percent-
  // encoded (…/maps/place/%3Fq%3Dplace_id:ChIJ…) and only look like a query
  // fragment once decoded.
  const isIdentifier = (s) =>
    /(?:^|[?&/])(?:place_id|cid|ftid|q)\s*[:=]\s*(?:place_id:|0x|ChIJ|[\d.,+-]+$)/i.test(s)
    || /(?:place_id|ftid)\s*[:=]/i.test(s)
    || /^0x[0-9a-f]+/i.test(s)
    || /^[?&]/.test(s);
  const usable = (s) => !!s && !isCoordPair(s) && !isIdentifier(s);

  // Candidate URLs, best first. A short link (maps.app.goo.gl) doesn't always
  // answer with a 302 we can follow — sometimes it's an interstitial page whose
  // BODY carries the real destination, in which case r.url is still the short
  // link and the name would be lost. So mine the HTML for the canonical link, a
  // meta-refresh target, and any /maps/place/ URL it mentions.
  const candidateUrls = [longUrl, url];
  if (html) {
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    if (canonical && canonical[1]) candidateUrls.push(decodeEntities(canonical[1]));
    const refresh = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"';]+)/i);
    if (refresh && refresh[1]) candidateUrls.push(decodeEntities(refresh[1].trim().replace(/^['"]|['"]$/g, '')));
    for (const m of html.matchAll(/https?:\/\/[^"'\s\\<>]*\/maps\/place\/[^"'\s\\<>]+/gi)) {
      candidateUrls.push(decodeEntities(m[0]));
      if (candidateUrls.length > 12) break; // one is enough; don't scan a whole SPA payload
    }
  }

  let name = '';
  // 1. /maps/place/<Name>/ — the reliable source.
  for (const u of candidateUrls) {
    const m = u && u.match(/\/maps\/place\/([^/?#@]+)/i);
    if (m && m[1]) {
      const cand = decodePlus(m[1]);
      if (usable(cand)) { name = cand; break; }
    }
  }
  // 2. ?q=Name / ?query=Name — this is what a resolved short link gives us, and
  //    it carries the address after the name.
  let qAddress = '';
  if (!name) {
    for (const u of candidateUrls) {
      const m = u && u.match(/[?&](?:q|query)=([^&]+)/i);
      if (m && m[1]) {
        const cand = decodePlus(m[1]);
        if (usable(cand)) {
          const split = splitNameAndAddress(cand);
          name = split.name;
          qAddress = split.address;
          break;
        }
      }
    }
  }
  if (!name && html) {
    const ogTitle = metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
    if (ogTitle) {
      // Google formats a real og:title as "Place Name · Address" or "Place Name
      // - Google Maps"; strip the trailing separator + tail, then discard the
      // bare "Google Maps" placeholder so it never becomes the name.
      const cleaned = ogTitle
        .replace(/\s+[-·–|]\s+Google\s+Maps\s*$/i, '')
        .split(/\s+[·•]\s+/)[0]
        .trim();
      if (cleaned && !/^google\s+maps$/i.test(cleaned)) name = cleaned;
    }
  }

  // Coordinates: @lat,lng,zoom segment of the resolved URL.
  let lat = null;
  let lng = null;
  const atMatch = longUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const a = parseFloat(atMatch[1]);
    const b = parseFloat(atMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) { lat = a; lng = b; }
  }

  // Address: the ?q= tail when the redirect gave us one, else og:description on
  // Google Maps place pages, which is often "Address · Phone · Rating" — take
  // the leading address chunk.
  let address = qAddress || undefined;
  if (!address && html) {
    const ogDesc = metaContent(html, 'og:description');
    if (ogDesc) {
      const first = ogDesc.split(/\s+[·•]\s+/)[0].trim();
      // Heuristic: looks like an address if it contains a digit (street #).
      if (first && /\d/.test(first)) address = first;
    }
  }

  // og:image fallback for the card preview.
  let imageUrl;
  if (html) imageUrl = metaContent(html, 'og:image') || null;

  if (!name && lat == null) return null;

  return {
    name,
    description: '',
    imageUrl: imageUrl || null,
    address,
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
