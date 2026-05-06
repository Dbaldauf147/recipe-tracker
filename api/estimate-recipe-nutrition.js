// Vercel serverless function: estimates nutrition for an existing recipe via Claude.
// Auto-routed at /api/estimate-recipe-nutrition.
//
// Unlike /api/generate-recipe (which invents recipes), this endpoint takes the
// caller's existing title + ingredients + servings and returns macrosPerServing
// only. Ingredients are not rewritten.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, ingredients, servings } = req.body || {};
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'Missing ingredients' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const ingList = ingredients
    .map((ing) => {
      const parts = [ing.quantity, ing.measurement, ing.ingredient].filter(Boolean);
      return `- ${parts.join(' ')}${ing.notes ? ` (${ing.notes})` : ''}`;
    })
    .join('\n');

  const servingsLabel = parseFloat(servings) || 1;

  const userPrompt = `Estimate nutrition for the recipe below. Use realistic values for the listed ingredients and the stated number of servings. Do not invent or substitute ingredients.

Title: ${title || 'Untitled recipe'}
Servings: ${servingsLabel}
Ingredients:
${ingList}

Return ONLY valid JSON, no markdown, no explanation:
{
  "macrosPerServing": {
    "calories": number,
    "protein": number,
    "carbs": number,
    "fat": number,
    "fiber": number,
    "sugar": number,
    "saturatedFat": number,
    "sodium": number
  }
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(502).json({ error: 'Failed to estimate nutrition. Please try again.' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let parsed;
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', text);
      return res.status(502).json({ error: 'Failed to parse nutrition estimate. Please try again.' });
    }

    const macros = parsed?.macrosPerServing;
    if (!macros || typeof macros !== 'object') {
      return res.status(502).json({ error: 'Unexpected response format. Please try again.' });
    }

    const cleaned = {};
    for (const k of ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'saturatedFat', 'sodium']) {
      const v = macros[k];
      const num = typeof v === 'number' ? v : parseFloat(v);
      if (!isNaN(num) && num >= 0) cleaned[k] = Math.round(num * 10) / 10;
    }

    return res.status(200).json({ macrosPerServing: cleaned });
  } catch (err) {
    console.error('Estimate recipe nutrition error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
