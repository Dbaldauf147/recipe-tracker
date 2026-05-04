/**
 * Vercel serverless function: fetches a URL, extracts structured recipe data
 * (Schema.org JSON-LD via cheerio), and returns a parsed recipe object.
 * Falls back to plain text extraction when no structured data is found.
 *
 * Used by the mobile app which cannot use DOMParser.
 * Auto-routed at /api/extract-recipe?url=...
 */

import * as cheerio from 'cheerio';

// ── Fraction normalization (same as web app) ──

const UNICODE_FRACTIONS = {
  '\u00BC': '1/4', '\u00BD': '1/2', '\u00BE': '3/4',
  '\u2153': '1/3', '\u2154': '2/3', '\u2155': '1/5',
  '\u2156': '2/5', '\u2157': '3/5', '\u2158': '4/5',
  '\u2159': '1/6', '\u215A': '5/6', '\u215B': '1/8',
  '\u215C': '3/8', '\u215D': '5/8', '\u215E': '7/8',
};

function normalizeFractions(text) {
  return text.replace(/(\d)?([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_, leading, ch) => {
    const frac = UNICODE_FRACTIONS[ch] || ch;
    return leading ? leading + ' ' + frac : frac;
  });
}

// ── Ingredient line parser (same as web app) ──

const MEASUREMENTS = [
  'cups?', 'c\\.', 'tbsps?', 'tablespoons?', 'tbs?\\.?',
  'tsps?', 'teaspoons?', 'ozs?\\.?', 'ounces?',
  'lbs?\\.?', 'pounds?', 'grams?', 'g\\.?', 'kgs?\\.?',
  'mls?\\.?', 'milliliters?', 'liters?',
  'pints?', 'quarts?', 'gallons?',
  'pinch(?:es)?', 'dash(?:es)?', 'cloves?', 'cans?',
  'packages?', 'pkgs?\\.?', 'pieces?', 'slices?',
  'sticks?', 'heads?', 'stalks?', 'sprigs?', 'handfuls?',
  'small', 'medium', 'large',
];

const QTY_PATTERN = /^(\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?(?:\s+\d+\s*\/\s*\d+)?)\s*/;
const MEAS_PATTERN = new RegExp(`^(${MEASUREMENTS.join('|')})\\b\\.?\\s*`, 'i');

function parseIngredientLine(line) {
  let text = line.trim().replace(/^[-•*▪▸►]\s*/, '');
  let quantity = '';
  let measurement = '';
  const qtyMatch = text.match(QTY_PATTERN);
  if (qtyMatch) {
    quantity = qtyMatch[1].trim();
    text = text.slice(qtyMatch[0].length);
  }
  const measMatch = text.match(MEAS_PATTERN);
  if (measMatch) {
    measurement = measMatch[1].replace(/\.$/, '').trim();
    text = text.slice(measMatch[0].length);
  }
  text = text.replace(/^of\s+/i, '');
  return { quantity, measurement, ingredient: text.trim() };
}

// ── JSON-LD extraction via cheerio ──

function extractJsonLdRecipe($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      let data = JSON.parse($(scripts[i]).html());
      if (data['@graph']) data = data['@graph'];
      if (Array.isArray(data)) {
        const recipe = data.find(
          item => item['@type'] === 'Recipe' || (Array.isArray(item['@type']) && item['@type'].includes('Recipe'))
        );
        if (recipe) return recipe;
      } else if (data['@type'] === 'Recipe' || (Array.isArray(data['@type']) && data['@type'].includes('Recipe'))) {
        return data;
      }
    } catch {
      // malformed JSON-LD, skip
    }
  }
  return null;
}

// ── Normalizers ──

function normalizeInstructions(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map(item => {
        if (typeof item === 'string') return item;
        if (item['@type'] === 'HowToSection') {
          const heading = item.name ? `${item.name}\n` : '';
          const steps = (item.itemListElement || [])
            .map(s => s.text || s.name || '')
            .filter(Boolean)
            .join('\n');
          return heading + steps;
        }
        return item.text || item.name || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(raw);
}

function normalizeServings(raw) {
  if (!raw) return '1';
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const match = str.match(/(\d+)/);
  return match ? match[1] : '1';
}

function parseISO8601Duration(iso) {
  if (!iso) return '';
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return '';
  const parts = [];
  if (m[1]) parts.push(`${m[1]} hr`);
  if (m[2]) parts.push(`${m[2]} min`);
  if (m[3]) parts.push(`${m[3]} sec`);
  return parts.join(' ');
}

function normalizeIngredients(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(line => {
    const text = normalizeFractions(typeof line === 'string' ? line : line.text || '');
    return parseIngredientLine(text);
  });
}

function titleCase(str) {
  if (!str || str !== str.toUpperCase()) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Social media detection ──

function isSocialMediaUrl(url) {
  return /tiktok\.com|instagram\.com|pinterest\.com|youtube\.com|youtu\.be|facebook\.com|threads\.net/i.test(url);
}

async function fetchInstagramEmbedCaption(url) {
  // Instagram's normal pages are login-walled, so og:description/og:title
  // come back empty when fetched server-side. The /reel/<id>/embed/captioned/
  // endpoint is public and returns the caption HTML.
  const m = url.match(/instagram\.com\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
  if (!m) return '';
  const shortcode = m[1];
  try {
    const res = await fetch(`https://www.instagram.com/reel/${shortcode}/embed/captioned/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    let captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/);
    if (!captionMatch) captionMatch = html.match(/class="CaptionComments"[^>]*>[\s\S]*?class="CaptionUsername"[^>]*>[\s\S]*?<\/a>([\s\S]*?)<\/div>/);
    if (!captionMatch) captionMatch = html.match(/"caption":\s*\{[^}]*"text":"((?:[^"\\]|\\.)*)"/);
    if (!captionMatch) captionMatch = html.match(/"edge_media_to_caption"[\s\S]*?"text":"((?:[^"\\]|\\.)*)"/);
    if (!captionMatch) {
      // Last-ditch oEmbed
      try {
        const oembedRes = await fetch(`https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/reel/${shortcode}/`);
        if (oembedRes.ok) {
          const oembed = await oembedRes.json();
          if (oembed.title) return oembed.title;
        }
      } catch {}
      return '';
    }
    let caption = captionMatch[1];
    try { caption = JSON.parse(`"${caption}"`); } catch {}
    caption = caption.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    caption = caption
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    caption = caption.replace(/^[\w.]+/, '').trim();
    caption = caption.replace(/View all \d+ comments\s*$/, '').trim();
    return caption;
  } catch {
    return '';
  }
}

async function fetchSocialData(url) {
  let caption = '';
  let author = '';
  let thumbnailUrl = '';
  let videoDownloadUrl = '';

  // Instagram: pull the caption from the public embed endpoint.
  // The normal page is login-walled and would return only "Instagram"
  // as the og:title, which is what was leaking through to the AI parse.
  if (/instagram\.com/i.test(url)) {
    caption = await fetchInstagramEmbedCaption(url);
  }

  // TikTok: use oEmbed + tikwm for video download URL
  if (/tiktok\.com/i.test(url)) {
    try {
      const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        caption = data.title || '';
        author = data.author_name || '';
        thumbnailUrl = data.thumbnail_url || '';
      }
    } catch {}

    // Get direct video URL via tikwm
    try {
      const tikwmRes = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
      if (tikwmRes.ok) {
        const tikwmData = await tikwmRes.json();
        if (tikwmData.data?.play) videoDownloadUrl = tikwmData.data.play;
        if (!thumbnailUrl && tikwmData.data?.cover) thumbnailUrl = tikwmData.data.cover;
      }
    } catch {}
  }

  // Fetch page HTML for og:image and og:description (all platforms)
  try {
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      if (!caption) {
        const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i)
          || html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:description"[^>]*>/i);
        if (ogDesc) caption = ogDesc[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      }
      if (!caption) {
        const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i)
          || html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (titleMatch) caption = titleMatch[1];
      }
      if (!thumbnailUrl) {
        const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i)
          || html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:image"[^>]*>/i);
        if (ogImage) thumbnailUrl = ogImage[1];
      }
    }
  } catch {}

  if (!caption && !thumbnailUrl && !videoDownloadUrl) return null;
  return { caption, author, thumbnailUrl, videoDownloadUrl };
}

async function transcribeVideo(videoUrl) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey || !videoUrl) return null;

  try {
    // Submit transcription
    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: videoUrl, language_detection: true }),
    });
    if (!submitRes.ok) return null;
    const { id } = await submitRes.json();

    // Poll for completion (max 45 seconds)
    const start = Date.now();
    while (Date.now() - start < 45000) {
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { 'Authorization': apiKey },
      });
      if (!pollRes.ok) return null;
      const result = await pollRes.json();
      if (result.status === 'completed') return result.text;
      if (result.status === 'error') return null;
      await new Promise(r => setTimeout(r, 2500));
    }
  } catch {}
  return null;
}

async function parseRecipeWithAI(text, sourceUrl, images) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || (!text && (!images || images.length === 0))) return null;

  try {
    // Build message content — text + optional images
    const content = [];

    // Add images first (Claude vision)
    if (images && images.length > 0) {
      for (const img of images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.contentType,
            data: img.base64,
          },
        });
      }
    }

    const prompt = `You are a recipe extraction expert. ${images?.length ? 'Look at the image(s) from a social media cooking video — read ALL text visible on screen (ingredients, instructions, measurements, recipe name). Also use the caption text below.' : 'Given text from a social media post,'} create a complete recipe.

Return ONLY valid JSON with this exact structure:
{"title":"recipe name","servings":"number","prepTime":"time","cookTime":"time","ingredients":[{"quantity":"amount","measurement":"unit","ingredient":"name"}],"instructions":"step 1. First do this.\\nstep 2. Then do that."}

IMPORTANT RULES:
- READ ALL TEXT VISIBLE IN THE IMAGE(S) — recipe names, ingredient lists, measurements, instructions shown as text overlays.
- Combine what you read from the image with the caption text to build the most complete recipe possible.
- If the image/text mentions a dish but doesn't list full ingredients, use your cooking knowledge to fill in a realistic ingredient list.
- Always provide clear step-by-step instructions.
- Make the recipe practical and cookable with common measurements.
- If there is absolutely no food content at all, return {"error":"no recipe found"}.

${text ? `Social media caption:\n${text.slice(0, 2000)}` : ''}`;

    content.push({ type: 'text', text: prompt });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const responseText = data.content?.[0]?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error) return null;
      return parsed;
    }
  } catch {}
  return null;
}

// ── Handler ──

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    // Social media URLs: fetch caption + transcribe audio + AI parse
    if (isSocialMediaUrl(url)) {
      const social = await fetchSocialData(url);
      if (social) {
        // Transcribe video audio if we have a download URL
        let transcript = '';
        if (social.videoDownloadUrl) {
          transcript = await transcribeVideo(social.videoDownloadUrl) || '';
        }

        // Combine caption + transcript for the richest context
        const combinedText = [
          social.caption ? `Video caption: ${social.caption}` : '',
          transcript ? `Video audio transcript: ${transcript}` : '',
        ].filter(Boolean).join('\n\n');

        // Check if the source text actually contains recipe details or just a description
        const sourceText = combinedText || social.caption || '';
        const hasRecipeText = /\d+\s*(cup|tbsp|tsp|oz|lb|g|tablespoon|teaspoon|ounce|pound|gram|clove|pinch|slice|can)/i.test(sourceText);

        // Send to Claude AI
        const aiRecipe = await parseRecipeWithAI(sourceText, url, null);
        if (aiRecipe) {
          return res.status(200).json({
            title: aiRecipe.title || '',
            description: (social.caption || '').slice(0, 500),
            estimated: !hasRecipeText,
            category: 'lunch-dinner',
            frequency: 'common',
            mealType: '',
            servings: aiRecipe.servings || '1',
            prepTime: aiRecipe.prepTime || '',
            cookTime: aiRecipe.cookTime || '',
            sourceUrl: url,
            videoUrl: url,
            ingredients: (aiRecipe.ingredients || []).map(ing => ({
              quantity: ing.quantity || '',
              measurement: ing.measurement || '',
              ingredient: ing.ingredient || '',
            })),
            instructions: aiRecipe.instructions || '',
            socialCaption: social.caption || '',
            transcript: transcript || '',
            author: social.author || '',
          });
        }
        // AI couldn't parse — return caption + transcript as raw text
        return res.status(200).json({
          title: '',
          description: '',
          category: 'lunch-dinner',
          frequency: 'common',
          mealType: '',
          servings: '1',
          prepTime: '',
          cookTime: '',
          sourceUrl: url,
          videoUrl: url,
          ingredients: [],
          instructions: '',
          rawText: social.caption,
          socialCaption: social.caption,
          author: social.author || '',
        });
      }
    }

    // Regular URLs: fetch HTML and extract structured data
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PrepDayMealPlanner/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Upstream returned ${response.status}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Try structured data first
    const ld = extractJsonLdRecipe($);
    if (ld) {
      return res.status(200).json({
        title: titleCase(ld.name || ''),
        description: ld.description || '',
        category: 'lunch-dinner',
        frequency: 'common',
        mealType: '',
        servings: normalizeServings(ld.recipeYield),
        prepTime: parseISO8601Duration(ld.prepTime),
        cookTime: parseISO8601Duration(ld.cookTime),
        sourceUrl: url,
        ingredients: normalizeIngredients(ld.recipeIngredient),
        instructions: normalizeInstructions(ld.recipeInstructions),
      });
    }

    // Fallback: strip HTML to plain text
    $('script, style, nav, footer, header, aside, .ad, .sidebar').remove();
    const text = $('body').text().replace(/[ \t]+/g, ' ').trim();

    // Try AI parsing on the plain text too
    if (text.length > 50) {
      const aiRecipe = await parseRecipeWithAI(text.slice(0, 3000), url);
      if (aiRecipe) {
        return res.status(200).json({
          title: aiRecipe.title || '',
          description: '',
          category: 'lunch-dinner',
          frequency: 'common',
          mealType: '',
          servings: aiRecipe.servings || '1',
          prepTime: aiRecipe.prepTime || '',
          cookTime: aiRecipe.cookTime || '',
          sourceUrl: url,
          ingredients: (aiRecipe.ingredients || []).map(ing => ({
            quantity: ing.quantity || '',
            measurement: ing.measurement || '',
            ingredient: ing.ingredient || '',
          })),
          instructions: aiRecipe.instructions || '',
        });
      }
    }

    // Return raw text for client-side parsing
    return res.status(200).json({
      title: '',
      description: '',
      category: 'lunch-dinner',
      frequency: 'common',
      mealType: '',
      servings: '1',
      prepTime: '',
      cookTime: '',
      sourceUrl: url,
      ingredients: [],
      instructions: '',
      rawText: text,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
