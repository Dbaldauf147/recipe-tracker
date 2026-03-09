// Vercel serverless function: generates two recipe ideas via Claude
// Auto-routed at /api/generate-recipe

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, dietPreferences, count: rawCount } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing prompt in request body' });
  }

  const count = Math.max(1, Math.min(4, parseInt(rawCount) || 2));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const dietContext = dietPreferences && dietPreferences.length > 0
    ? `\nThe user follows these diets: ${dietPreferences.join(', ')}. Make sure all recipes comply.`
    : '';

  const systemPrompt = `You are a professional chef and recipe developer. Generate exactly ${count} different recipe idea${count > 1 ? 's' : ''} based on the user's request. Return ONLY valid JSON, no markdown, no explanation.

The JSON must be an array of exactly ${count} object${count > 1 ? 's' : ''}, each with this structure:
{
  "title": "Recipe Name",
  "description": "Brief 1-2 sentence description",
  "category": "breakfast" or "lunch-dinner" or "snacks" or "desserts" or "drinks",
  "highlights": ["What makes this recipe unique vs the others - 3-4 short bullet points"],
  "macrosPerServing": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "servings": number,
  "prepTime": "X min",
  "cookTime": "X min",
  "ingredients": [
    { "quantity": "2", "measurement": "cups", "ingredient": "flour" }
  ],
  "instructions": "Step-by-step cooking instructions as a single string with numbered steps"
}

Rules:
- For the "highlights" field, write 3-4 short bullet points (each under 10 words) explaining what makes this recipe different from the others (e.g. cooking method, flavor profile, cuisine, difficulty, cook time). If only 1 recipe is requested, highlight what makes it special.
- Each recipe should have 5-15 ingredients with realistic quantities
- Use standard measurements (cups, tbsp, tsp, oz, lb, g, cloves, whole, etc.)
- Instructions should be clear, numbered steps
- Each recipe should be a meaningfully different approach to the user's request
- Keep quantities and servings realistic for home cooking
- For macrosPerServing, estimate realistic per-serving values: calories (kcal), protein (grams), carbs (grams), fat (grams) based on the ingredients and quantities${dietContext}`;

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
        max_tokens: count <= 2 ? 4000 : 8000,
        messages: [
          { role: 'user', content: prompt.trim() },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(502).json({ error: 'Failed to generate recipes. Please try again.' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from response (handle potential markdown code blocks)
    let recipes;
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      recipes = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', text);
      return res.status(502).json({ error: 'Failed to parse recipe data. Please try again.' });
    }

    if (!Array.isArray(recipes) || recipes.length === 0) {
      return res.status(502).json({ error: 'Unexpected response format. Please try again.' });
    }

    return res.status(200).json({ recipes: recipes.slice(0, count) });
  } catch (err) {
    console.error('Generate recipe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
