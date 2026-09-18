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

// ── TikTok ─────────────────────────────────────────────────────────────────
//
// A TikTok that recommends a restaurant usually never writes its name down:
// the caption is "you NEED to try this 🤤", the on-page title is the same
// caption, and the place is only ever SAID out loud. So when the written
// material yields no name, fall back to what the creator actually says: the
// clip itself goes to Gemini, which hears the spoken name (and reads anything
// on screen) and answers with the venue.
export function isTikTokUrl(url) {
  return /(?:\/\/|\.)(?:tiktok\.com|vm\.tiktok\.com)\//i.test(String(url || ''));
}

/**
 * The name out of the model's answer, or '' when it couldn't tell.
 *
 * Kept separate (and exported) because this is the judgement call worth
 * testing: a model that hedges, answers in prose, or offers the creator's handle
 * instead of the restaurant must come back as "no name", not as a wrong name
 * silently saved onto a spot.
 */
export function parsePlaceFromModel(text) {
  const empty = { name: '', address: '', quote: '' };
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return empty;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return empty;
  }
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const confident = parsed.confident === true || parsed.confident === 'true';
  // No name, no confidence, or a model that answered with a placeholder.
  if (!name || !confident) return empty;
  if (/^(unknown|unclear|n\/?a|none|not (?:stated|mentioned|specified))$/i.test(name)) return empty;
  if (name.length > 80) return empty;
  return {
    name,
    address: typeof parsed.address === 'string' ? parsed.address.trim() : '',
    quote: typeof parsed.quote === 'string' ? parsed.quote.trim().slice(0, 200) : '',
  };
}

// oEmbed gives the caption, creator and thumbnail; tikwm gives a direct media
// URL to download. Both are the same sources api/extract-recipe.js already
// relies on for recipe videos.
async function fetchTikTokMeta(url) {
  let caption = '';
  let author = '';
  let imageUrl = null;
  let videoUrl = '';
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    if (r.ok) {
      const data = await r.json();
      caption = decodeEntities(data.title || '');
      author = data.author_name || '';
      imageUrl = data.thumbnail_url || null;
    }
  } catch { /* oEmbed is best-effort */ }
  try {
    const r = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    if (r.ok) {
      const data = await r.json();
      if (data?.data?.play) videoUrl = data.data.play;
      if (!imageUrl && data?.data?.cover) imageUrl = data.data.cover;
      if (!caption && data?.data?.title) caption = decodeEntities(data.data.title);
    }
  } catch { /* tikwm is best-effort; without it there's simply no audio */ }
  return { caption, author, imageUrl, videoUrl };
}

// Gemini takes the video itself, so it hears the audio AND reads whatever is
// on screen. Inline media has to travel inside the request, so the clip has a
// size ceiling; TikToks are comfortably under it, and one that isn't is simply
// left unheard rather than blowing up the import.
const MAX_VIDEO_BYTES = 18 * 1024 * 1024;

async function fetchVideoBytes(videoUrl, signal) {
  const r = await fetch(videoUrl, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return { error: `media fetch ${r.status}` };
  const declared = Number(r.headers.get('content-length') || 0);
  if (declared > MAX_VIDEO_BYTES) return { error: `video too large (${declared} bytes)` };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_VIDEO_BYTES) return { error: `video too large (${buf.length} bytes)` };
  return { base64: buf.toString('base64'), bytes: buf.length };
}

/**
 * Watch and listen to the video, and say which venue it is about.
 *
 * Returns { place, heard, unavailable }: `heard` means the video actually
 * reached the model, `unavailable` that it never could (no media URL, clip too
 * big, no key, or the service refused) — a different story from "listened, and
 * nobody said a name", and the UI tells them apart.
 */
export async function askVideoForPlace(videoUrl, { caption = '', author = '', budgetMs = 30000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const none = { place: { name: '', address: '', quote: '' }, heard: false, unavailable: true };
  if (!apiKey || !videoUrl) return none;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const media = await fetchVideoBytes(videoUrl, controller.signal);
    if (media.error) {
      console.error(`TikTok place import: ${media.error}`);
      return none;
    }
    const prompt = [
      'This is a social video recommending somewhere to eat or drink.',
      'Identify the venue. Listen to what the speaker SAYS — the name is usually spoken, not written.',
      'Text on screen counts too. The creator\'s username is NOT the venue name unless they say the venue is called that.',
      'A dish, a cuisine or a city on its own is NOT a venue name.',
      'Answer with ONLY JSON, no markdown:',
      '{"name": "...", "address": "...", "quote": "...", "confident": true|false}',
      '"address" only if a city, neighbourhood or street is actually stated, else "".',
      '"quote" is the words that named the place, as spoken or shown.',
      'If no specific venue is named anywhere, answer {"name": "", "confident": false}.',
      author ? `Creator handle: ${author}` : '',
      caption ? `Caption: ${caption}` : '',
    ].filter(Boolean).join('\n');

    const r = await fetch(
      // gemini-2.5-flash is retired for new callers and answers 404; 3.6-flash
      // is the current one that takes video.
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'video/mp4', data: media.base64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 300 },
        }),
      },
    );
    if (!r.ok) {
      // Loud on purpose: a dead key answers the same way every time, and
      // swallowing it is how this quietly stops working for months.
      console.error(`Gemini video read failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return none;
    }
    const data = await r.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    return { place: parsePlaceFromModel(text), heard: true, unavailable: false };
  } catch (err) {
    // An abort here is the time budget, not a failure to reach the service.
    const aborted = err?.name === 'AbortError';
    console.error(`Gemini video read ${aborted ? 'timed out' : 'threw'}: ${err?.message || err}`);
    return { place: { name: '', address: '', quote: '' }, heard: false, unavailable: !aborted };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the model which venue the WRITTEN material is about — the caption and the
 * creator's handle. Cheap and instant, and it answers on the minority of posts
 * that actually write the name down; everything else goes to the video.
 */
export async function askModelForPlace({ caption, author, transcript = '' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || (!caption && !transcript)) return { name: '', address: '', quote: '' };
  const system =
    'You identify the restaurant, cafe, bar or food shop a social video is about. '
    + 'Return ONLY JSON, no markdown: {"name": "...", "address": "...", "quote": "...", "confident": true|false}. '
    + '"name" is the venue\'s own name as a person would search it. '
    + '"address" is a city, neighbourhood or street ONLY if one is actually stated — otherwise "". '
    + '"quote" is the short phrase from the material that names the place. '
    + 'The creator\'s username or channel is NOT the venue name unless the material says the venue is called that. '
    + 'A dish, cuisine or city on its own is NOT a venue name. '
    + 'If no specific venue is named, return {"name": "", "confident": false}.';
  const lines = [];
  if (author) lines.push(`Creator handle: ${author}`);
  if (caption) lines.push(`Caption: ${caption}`);
  if (transcript) lines.push(`What the creator says in the video: ${transcript.slice(0, 6000)}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: lines.join('\n') }],
      }),
    });
    if (!r.ok) return { name: '', address: '', quote: '' };
    const data = await r.json();
    return parsePlaceFromModel(data.content?.[0]?.text || '');
  } catch {
    return { name: '', address: '', quote: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function extractFromTikTok(url, { budgetMs = 30000 } = {}) {
  const meta = await fetchTikTokMeta(url);
  if (!meta.caption && !meta.videoUrl && !meta.imageUrl) return null;

  // The written material first — it's instant and cheap when the caption does
  // name the place, and most of the time it doesn't.
  let place = await askModelForPlace({ caption: meta.caption, author: meta.author });
  let nameSource = place.name ? 'caption' : '';
  let heardAudio = false;
  let audioUnavailable = false;

  // Nothing written down: watch and listen to the video itself.
  if (!place.name) {
    const watched = await askVideoForPlace(meta.videoUrl, {
      caption: meta.caption,
      author: meta.author,
      budgetMs,
    });
    heardAudio = watched.heard;
    audioUnavailable = watched.unavailable;
    if (watched.place.name) {
      place = watched.place;
      nameSource = 'audio';
    }
  }

  return {
    name: place.name,
    address: place.address,
    description: meta.caption,
    imageUrl: meta.imageUrl,
    sourceUrl: url,
    source: 'tiktok',
    // How the name was found — '' when nothing named the place, so the caller
    // can say "we couldn't hear a name" rather than pretend the field is empty
    // by accident.
    nameSource,
    nameQuote: place.quote,
    heardAudio,
    // True when we never got to hear the video at all (no media URL, or the
    // transcription service refused) — a different story from "listened, and
    // nobody said a name", and the UI says so.
    audioUnavailable,
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

// Google answers a datacenter IP (which is what this function is) with a CAPTCHA
// at /sorry/index instead of the page itself. That URL is not a dead end: it
// carries the destination we asked for in ?continue=, so unwrap it and use that.
//
// Doing so is not optional. The CAPTCHA URL has its OWN ?q= — the challenge
// token — and the place name is read from ?q=, so left alone it hands back
// "EgQS6DNxGOPvr9MG…" as the restaurant's name. An empty name is a visible
// failure; a plausible-looking wrong one gets saved.
function unwrapGoogleBlockPage(u) {
  const s = String(u || '');
  if (!/\/sorry\/|consent\.google\./i.test(s)) return s;
  const m = s.match(/[?&]continue=([^&]+)/i);
  if (!m) return s;
  try { return decodeURIComponent(m[1]); } catch { return s; }
}

// A ?q= that is one long unbroken run of token characters is a machine value
// (the CAPTCHA challenge, a signed id), not somewhere you ate. Real place names
// this long have spaces in them.
function looksLikeOpaqueToken(s) {
  const v = String(s || '').trim();
  return v.length >= 24 && !/\s/.test(v) && /^[A-Za-z0-9_-]+$/.test(v);
}

// A short link resolves to ?q=<Name>,+<Address> with no coordinates in it — the
// @lat,lng segment only exists on a full /maps/place/ URL — so a share-link
// import would save without a map pin. We have a street address though, and the
// app already geocodes addresses for free through Nominatim, so use it.
//
// Mirrors api/geocode.js (same endpoint, same User-Agent per Nominatim's usage
// policy, same normalized shape) — kept as a direct call rather than a self-
// request so this doesn't need to know its own deployment URL. Best-effort: a
// failure here just means no pin, which is where we started.
//
// `extratags=1` comes along for free: when OpenStreetMap knows the place, its
// `cuisine=ramen;japanese` tag is the one factual cuisine source we have (Google
// hides its category from servers, and there's no Places API key). `near`
// narrows a name-only search to a small box around known coordinates, so a
// full /maps/place/ URL can still pick up that tag.
async function geocodeAddress(query, { near = null } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  let bounds = '';
  if (near) {
    const d = 0.005; // ~500 m
    bounds = `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}&bounded=1`;
  }
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&extratags=1${bounds}&q=${encodeURIComponent(q)}`,
      {
        headers: {
          'User-Agent': 'PrepDay/1.0 (https://prep-day.com; baldaufdan@gmail.com)',
          'Accept': 'application/json',
          'Accept-Language': 'en',
        },
      },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const top = Array.isArray(data) ? data[0] : null;
    const lat = parseFloat(top?.lat);
    const lng = parseFloat(top?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      osmType: top?.type || '',
      osmCuisine: top?.extratags?.cuisine || '',
    };
  } catch {
    return null;
  }
}

// ── cuisine ──────────────────────────────────────────────────────────────────

/**
 * The model's answer, cleaned: at most two names, trimmed, deduped, and
 * re-spelled to match the user's existing cuisine list where one matches
 * case-insensitively ("japanese" → "Japanese"), so an import never splits a
 * tag the user already has into a second spelling.
 */
export function normalizeCuisines(raw, vocab = []) {
  const bySpelling = new Map();
  for (const v of vocab) {
    const s = String(v || '').trim();
    if (s && !bySpelling.has(s.toLowerCase())) bySpelling.set(s.toLowerCase(), s);
  }
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const s = String(c || '').trim().replace(/\s+/g, ' ');
    if (!s || s.length > 40) continue;
    const spelled = bySpelling.get(s.toLowerCase())
      || s.replace(/\b\w/g, ch => ch.toUpperCase());
    if (!out.some(o => o.toLowerCase() === spelled.toLowerCase())) out.push(spelled);
    if (out.length === 2) break;
  }
  return out;
}

/** "a, b,c" → ["a","b","c"]; the client sends its cuisine vocabulary this way. */
export function parseVocab(param) {
  return String(param || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 200);
}

/**
 * Best guess at a restaurant's cuisine, from its name and address plus the OSM
 * cuisine tag when there is one. Returns [] on any failure or when the model
 * isn't reasonably sure — an empty Cuisines box is fine, a wrong tag gets saved.
 */
async function guessCuisines({ name, address, osmCuisine, osmType, vocab }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !name) return [];
  const system =
    'You tag restaurants, cafes and bars with their cuisine. Return ONLY JSON, no markdown: '
    + '{"cuisines": ["..."]} with one or two short cuisine names (e.g. "Japanese", "Ramen", '
    + '"Pizza", "Mexican", "Coffee", "Cocktail Bar"). Most specific first. If the user\'s existing '
    + 'list has a name that fits, use that exact spelling. If you cannot tell with reasonable '
    + 'confidence, return {"cuisines": []}.';
  const lines = [`Name: ${name}`];
  if (address) lines.push(`Address: ${address}`);
  if (osmCuisine || osmType) lines.push(`OpenStreetMap tags: ${[osmType && `type=${osmType}`, osmCuisine && `cuisine=${osmCuisine}`].filter(Boolean).join(', ')}`);
  if (vocab.length) lines.push(`User's existing cuisine list: ${vocab.join(', ')}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system,
        messages: [{ role: 'user', content: lines.join('\n') }],
      }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    const text = data.content?.[0]?.text || '';
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) return [];
    return normalizeCuisines(JSON.parse(json[0]).cuisines, vocab);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
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

async function extractFromGoogleMaps(url, { vocab = [] } = {}) {
  // Fetch the page following redirects — this resolves short links
  // (maps.app.goo.gl / goo.gl/maps) to the canonical /maps/place/<Name>/@lat,lng
  // URL, which is where we read the name and coords from.
  const { html, finalUrl } = await fetchGoogleMapsHtml(url);
  // A CAPTCHA page still tells us where we were going — see unwrapGoogleBlockPage.
  const longUrl = unwrapGoogleBlockPage(finalUrl || url);

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
  const usable = (s) => !!s && !isCoordPair(s) && !isIdentifier(s) && !looksLikeOpaqueToken(s);

  // Candidate URLs, best first. A short link (maps.app.goo.gl) doesn't always
  // answer with a 302 we can follow — sometimes it's an interstitial page whose
  // BODY carries the real destination, in which case r.url is still the short
  // link and the name would be lost. So mine the HTML for the canonical link, a
  // meta-refresh target, and any /maps/place/ URL it mentions.
  const candidateUrls = [longUrl, unwrapGoogleBlockPage(url)];
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

  // No @lat,lng in the URL (every short link) — fall back to geocoding the
  // address the redirect gave us, so the spot still lands on the map.
  let osm = null;
  if (lat == null && address) {
    osm = await geocodeAddress(name ? `${name}, ${address}` : address);
    if (osm) { lat = osm.lat; lng = osm.lng; }
  } else if (name && lat != null) {
    // Coords already known — this lookup is only for OSM's cuisine tag.
    osm = await geocodeAddress(name, { near: { lat, lng } });
  }

  const cuisines = await guessCuisines({
    name,
    address,
    osmCuisine: osm?.osmCuisine || '',
    osmType: osm?.osmType || '',
    vocab,
  });

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
    cuisines,
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
      result = await extractFromGoogleMaps(url, {
        vocab: parseVocab(req.query?.cuisines || req.body?.cuisines),
      });
      source = 'google-maps';
    } else if (isTikTokUrl(url)) {
      result = await extractFromTikTok(url);
      source = 'tiktok';
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
