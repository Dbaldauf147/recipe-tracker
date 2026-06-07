import sharp from 'sharp';

// POST /api/generate-meal-image
//   { image: <dataUrl|base64> }                      → compress an uploaded photo
//   { recipeName, ingredients: [{ingredient}|str] }  → AI-generate a dish photo
// Returns { dataUrl } as a ≤800px JPEG (well under Firestore's ~1MB doc cap), so
// the mobile app — which has no canvas to compress with — can save it directly
// to users/{uid}/mealImages/{recipeId}, matching the website.
async function toCompressedDataUrl(buf) {
  const jpeg = await sharp(buf)
    .rotate() // honor EXIF orientation from phone photos
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { image, recipeName, ingredients } = req.body || {};

    // Mode 1: compress an uploaded image.
    if (image) {
      const b64 = String(image).replace(/^data:[^,]+,/, '');
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return res.status(400).json({ error: 'empty image' });
      return res.status(200).json({ dataUrl: await toCompressedDataUrl(buf) });
    }

    // Mode 2: AI-generate via Gemini, then compress. Prefer VITE_GEMINI_API_KEY
    // (the key the website successfully uses for image generation) and send the
    // matching Referer so the key's HTTP-referrer restriction is satisfied.
    const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    const list = (Array.isArray(ingredients) ? ingredients : [])
      .map(i => (typeof i === 'string' ? i : (i?.ingredient || '')))
      .map(s => String(s).trim())
      .filter(Boolean)
      .slice(0, 10)
      .join(', ');
    const prompt = `Professional overhead food photography of ${recipeName || 'a dish'} on a clean white plate${list ? `, containing ${list}` : ''}, natural lighting, appetizing, high quality, no text`;

    let lastErr = 'unknown error';
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Referer': 'https://prep-day.com/' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
          }),
        },
      );
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('[generate-meal-image] Gemini error', r.status, t.slice(0, 300));
        // Don't echo the provider body (it can include the key id).
        lastErr = r.status === 403
          ? 'AI image generation is temporarily unavailable (image API key issue).'
          : `Image generation failed (HTTP ${r.status}).`;
        if (r.status === 429) { await new Promise(s => setTimeout(s, 8000)); continue; }
        break;
      }
      const data = await r.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const img = parts.find(p => p.inlineData);
      if (!img) { lastErr = 'no image in response'; continue; }
      return res.status(200).json({ dataUrl: await toCompressedDataUrl(Buffer.from(img.inlineData.data, 'base64')) });
    }
    return res.status(502).json({ error: lastErr });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
