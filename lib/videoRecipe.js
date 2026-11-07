/* global process, Buffer */
// Read a recipe off a cooking video itself — on-screen text overlays AND what
// the creator says — for when the caption doesn't carry the recipe.
//
// Gemini takes the video file directly, so one call covers both the words on
// screen and the audio. This replaced AssemblyAI transcription, whose key went
// dead (401) and failed silently: imports looked like silent videos.

// Inline media travels inside the request, so the clip has a size ceiling.
// TikToks are comfortably under it; one that isn't is skipped, not fatal.
const MAX_VIDEO_BYTES = 18 * 1024 * 1024;

// gemini-2.5-flash is retired for new callers (404). Same model as
// api/extract-restaurant.js uses for TikTok venue names.
const MODEL = 'gemini-3.6-flash';

async function fetchVideoBytes(videoUrl, signal) {
  const r = await fetch(videoUrl, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return { error: `media fetch ${r.status}` };
  const declared = Number(r.headers.get('content-length') || 0);
  if (declared > MAX_VIDEO_BYTES) return { error: `video too large (${declared} bytes)` };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_VIDEO_BYTES) return { error: `video too large (${buf.length} bytes)` };
  return { base64: buf.toString('base64') };
}

/** True when text carries real recipe amounts ("2 cups", "1 tbsp", "400g"). */
export function hasRecipeAmounts(text) {
  return /\d+\s*(cups?|tbsp|tsp|oz|lbs?|g|grams?|tablespoons?|teaspoons?|ounces?|pounds?|cloves?|pinch|slices?|cans?)\b/i.test(String(text || ''));
}

const str = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/**
 * Turn the model's reply into a recipe, or null when it found none.
 * Tolerates markdown fences and stray prose around the JSON.
 */
export function parseVideoRecipeReply(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || parsed.error) return null;

  const ingredients = (Array.isArray(parsed.ingredients) ? parsed.ingredients : [])
    .map(ing => (typeof ing === 'string'
      ? { quantity: '', measurement: '', ingredient: ing.trim() }
      : { quantity: str(ing?.quantity), measurement: str(ing?.measurement), ingredient: str(ing?.ingredient) }))
    .filter(ing => ing.ingredient);

  const instructions = Array.isArray(parsed.instructions)
    ? parsed.instructions.map(str).filter(Boolean).join('\n')
    : str(parsed.instructions);

  const title = str(parsed.title);
  if (!title && ingredients.length === 0) return null;

  return {
    title,
    servings: str(parsed.servings),
    prepTime: str(parsed.prepTime),
    cookTime: str(parsed.cookTime),
    ingredients,
    instructions,
    // Did the video actually show/say the amounts, or did the model fill them in?
    amountsFromVideo: parsed.amountsFromVideo === true,
    titleSource: ['screen', 'audio', 'caption', 'guessed'].includes(parsed.titleSource) ? parsed.titleSource : '',
    spoken: str(parsed.spoken).slice(0, 4000),
  };
}

/**
 * What a tikwm response says the post is made of.
 *
 * A TikTok "photo" post (tiktok.com/@user/photo/…) is a slideshow: the recipe
 * is printed on the slides, and tikwm lists them in `data.images`. Its `play`
 * URL is then the background MUSIC, not a video — sending that to the video
 * reader finds nothing, which is how a slideshow recipe ended up as "could not
 * extract recipe from caption or audio".
 */
export function tiktokMedia(tikwm) {
  const d = (tikwm && typeof tikwm === 'object' && tikwm.data) || {};
  const imageUrls = (Array.isArray(d.images) ? d.images : [])
    .filter(u => typeof u === 'string' && /^https?:\/\//i.test(u));
  return {
    imageUrls,
    videoUrl: imageUrls.length ? '' : (typeof d.play === 'string' ? d.play : ''),
    coverUrl: typeof d.cover === 'string' ? d.cover : '',
    caption: typeof d.title === 'string' ? d.title : '',
    author: str(d.author?.unique_id || d.author?.nickname),
  };
}

// Image types Gemini reads inline. Anything else (e.g. a GIF) is skipped.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** The inline mime type for a fetched image, or '' when Gemini can't read it. */
export function imageMimeType(contentType, url = '') {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'image/jpg') return 'image/jpeg';
  if (IMAGE_TYPES.includes(ct)) return ct;
  // CDNs often answer application/octet-stream; fall back to the extension.
  const ext = (String(url).split('?')[0].match(/\.(jpe?g|png|webp|heic|heif)$/i) || [])[1];
  if (!ext) return '';
  const e = ext.toLowerCase();
  return e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : `image/${e}`;
}

// Slideshows run to ~35 slides, but recipes sit in the first handful.
const MAX_SLIDES = 10;

async function fetchImageParts(imageUrls, signal) {
  const parts = [];
  let total = 0;
  let lastError = '';
  for (const url of imageUrls.slice(0, MAX_SLIDES)) {
    try {
      const r = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) { lastError = `image fetch ${r.status}`; continue; }
      const mime = imageMimeType(r.headers.get('content-type'), url);
      if (!mime) { lastError = 'unsupported image type'; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (total + buf.length > MAX_VIDEO_BYTES) break;
      total += buf.length;
      parts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastError = String(err?.message || err);
    }
  }
  return { parts, error: parts.length ? '' : (lastError || 'no images') };
}

const REPLY_SHAPE = [
  'Answer with ONLY JSON, no markdown:',
  '{"title":"","titleSource":"screen|audio|caption|guessed","servings":"","prepTime":"","cookTime":"",',
  '"ingredients":[{"quantity":"","measurement":"","ingredient":""}],',
  '"instructions":"1. ...\\n2. ...","amountsFromVideo":true|false,"spoken":"short summary of what is said"}',
];

/**
 * Send media parts + prompt to Gemini and parse the recipe reply.
 * `label` names the media in logs ("video" / "slides").
 */
async function askGemini(apiKey, mediaParts, prompt, signal, label) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [...mediaParts, { text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 3000, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!r.ok) {
    // Loud on purpose: a dead key answers the same way every time.
    const body = (await r.text()).slice(0, 200);
    console.error(`Gemini recipe ${label} read failed: ${r.status} ${body}`);
    return { recipe: null, watched: false, error: `gemini ${r.status}` };
  }
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return { recipe: parseVideoRecipeReply(text), watched: true, error: '' };
}

function readFailed(err, label) {
  const aborted = err?.name === 'AbortError';
  console.error(`Gemini recipe ${label} read ${aborted ? 'timed out' : 'threw'}: ${err?.message || err}`);
  return { recipe: null, watched: false, error: aborted ? 'timed out' : String(err?.message || err) };
}

/**
 * Watch the video and pull the recipe from its on-screen text and audio.
 * Returns { recipe, watched, error }: `watched` means the video reached the
 * model (so a null recipe means "looked, found none", not "never looked").
 */
export async function readRecipeFromVideo(videoUrl, { caption = '', author = '', budgetMs = 40000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { recipe: null, watched: false, error: 'GEMINI_API_KEY not set' };
  if (!videoUrl) return { recipe: null, watched: false, error: 'no video URL' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const media = await fetchVideoBytes(videoUrl, controller.signal);
    if (media.error) return { recipe: null, watched: false, error: media.error };

    const prompt = [
      'This is a short cooking video. Extract the recipe it shows.',
      'READ ALL TEXT SHOWN ON SCREEN — title cards, ingredient lists, amounts, step captions, labels on packages.',
      'LISTEN to what the creator says — amounts and steps are often spoken.',
      'Also use the caption below. On-screen text and speech win over guesses.',
      'Title: use the recipe name shown on screen or said aloud; otherwise name the dish plainly (e.g. "Garlic Butter Chicken Bites"). Never use the creator\'s username or hashtags as the title.',
      'If amounts are not shown or said, fill in realistic ones from cooking knowledge.',
      ...REPLY_SHAPE,
      '"amountsFromVideo" is true only if most amounts were actually shown or said in the video or caption.',
      'If the video contains no food or recipe at all, answer {"error":"no recipe"}.',
      author ? `Creator handle: ${author}` : '',
      caption ? `Caption: ${caption.slice(0, 2000)}` : '',
    ].filter(Boolean).join('\n');

    return await askGemini(apiKey, [{ inline_data: { mime_type: 'video/mp4', data: media.base64 } }], prompt, controller.signal, 'video');
  } catch (err) {
    return readFailed(err, 'video');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a recipe printed on a photo slideshow (TikTok photo post). Same
 * { recipe, watched, error } contract as readRecipeFromVideo.
 */
export async function readRecipeFromImages(imageUrls, { caption = '', author = '', budgetMs = 40000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { recipe: null, watched: false, error: 'GEMINI_API_KEY not set' };
  if (!imageUrls?.length) return { recipe: null, watched: false, error: 'no images' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const { parts, error } = await fetchImageParts(imageUrls, controller.signal);
    if (!parts.length) return { recipe: null, watched: false, error };

    const prompt = [
      'These images are the slides of one social media post, in order. Extract the recipe they show.',
      'READ ALL TEXT ON THE SLIDES — the recipe name, every ingredient with its amount and unit exactly as written, and every step.',
      'Copy amounts and units as written (e.g. "1/2 oz", "1 tbs"); do not convert or round them.',
      'Lines with no amount (e.g. "Ice", "Figs") are still ingredients. Method lines ("Shake…", "Strain…", "Garnish…") are instructions.',
      'Drop a series number in front of the name ("#40 Figgy Christmas" → "Figgy Christmas"). Never use the creator\'s username or hashtags as the title.',
      'Also use the caption below. Only if the slides give no amounts, fill in realistic ones from cooking knowledge.',
      ...REPLY_SHAPE,
      '"amountsFromVideo" is true only if most amounts were actually printed on the slides or in the caption. Leave "spoken" empty.',
      'If the slides contain no food or drink recipe at all, answer {"error":"no recipe"}.',
      author ? `Creator handle: ${author}` : '',
      caption ? `Caption: ${caption.slice(0, 2000)}` : '',
    ].filter(Boolean).join('\n');

    return await askGemini(apiKey, parts, prompt, controller.signal, 'slides');
  } catch (err) {
    return readFailed(err, 'slides');
  } finally {
    clearTimeout(timer);
  }
}
