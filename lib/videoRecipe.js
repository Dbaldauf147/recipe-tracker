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
      'Answer with ONLY JSON, no markdown:',
      '{"title":"","titleSource":"screen|audio|caption|guessed","servings":"","prepTime":"","cookTime":"",',
      '"ingredients":[{"quantity":"","measurement":"","ingredient":""}],',
      '"instructions":"1. ...\\n2. ...","amountsFromVideo":true|false,"spoken":"short summary of what is said"}',
      '"amountsFromVideo" is true only if most amounts were actually shown or said in the video or caption.',
      'If the video contains no food or recipe at all, answer {"error":"no recipe"}.',
      author ? `Creator handle: ${author}` : '',
      caption ? `Caption: ${caption.slice(0, 2000)}` : '',
    ].filter(Boolean).join('\n');

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: 'video/mp4', data: media.base64 } },
            { text: prompt },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: 3000, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!r.ok) {
      // Loud on purpose: a dead key answers the same way every time.
      const body = (await r.text()).slice(0, 200);
      console.error(`Gemini recipe video read failed: ${r.status} ${body}`);
      return { recipe: null, watched: false, error: `gemini ${r.status}` };
    }
    const data = await r.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    return { recipe: parseVideoRecipeReply(text), watched: true, error: '' };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    console.error(`Gemini recipe video read ${aborted ? 'timed out' : 'threw'}: ${err?.message || err}`);
    return { recipe: null, watched: false, error: aborted ? 'timed out' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
