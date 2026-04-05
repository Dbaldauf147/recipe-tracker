// Vercel serverless function: recommends new meals based on user's eating history
// Auto-routed at /api/recommend-meals

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topCuisines, topIngredients, recentRecipes, dietPreferences } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const cuisineContext = topCuisines?.length > 0
    ? `Their favorite cuisines are: ${topCuisines.join(', ')}.`
    : '';
  const ingredientContext = topIngredients?.length > 0
    ? `They frequently use: ${topIngredients.join(', ')}.`
    : '';
  const recentContext = recentRecipes?.length > 0
    ? `They recently cooked: ${recentRecipes.join(', ')}.`
    : '';
  const dietContext = dietPreferences?.length > 0
    ? `They follow these dietary preferences: ${dietPreferences.join(', ')}.`
    : '';

  const systemPrompt = `You are a creative chef recommending new meals for someone to try. Based on their cooking history and preferences, suggest 4 recipes they would enjoy but haven't made yet. Mix familiar flavors with new ideas.

${cuisineContext}
${ingredientContext}
${recentContext}
${dietContext}

Return ONLY valid JSON array with exactly 4 objects:
{
  "title": "Recipe Name",
  "description": "1-2 sentence pitch for why they'd love this",
  "cuisine": "Italian/Mexican/etc",
  "category": "breakfast" or "lunch-dinner" or "snacks" or "desserts" or "drinks",
  "whyYoullLoveIt": "Short reason based on their preferences",
  "servings": number,
  "prepTime": "X min",
  "cookTime": "X min",
  "ingredients": [{ "quantity": "2", "measurement": "cups", "ingredient": "flour" }],
  "instructions": "Numbered step-by-step instructions"
}

Rules:
- Suggest meals they haven't made recently
- 2 should be close to their comfort zone, 2 should push boundaries slightly
- Keep ingredients accessible (no ultra-obscure items)
- Each recipe should have 5-12 ingredients with realistic quantities
- Vary the categories (don't suggest 4 dinners)`;

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
        max_tokens: 6000,
        messages: [
          { role: 'user', content: 'Recommend 4 new meals for me to try based on my cooking history.' },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(502).json({ error: 'Failed to generate recommendations.' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let recipes;
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      recipes = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('Failed to parse response:', text);
      return res.status(502).json({ error: 'Failed to parse recommendations.' });
    }

    if (!Array.isArray(recipes)) {
      return res.status(502).json({ error: 'Unexpected response format.' });
    }

    return res.status(200).json({ recipes: recipes.slice(0, 4) });
  } catch (err) {
    console.error('Recommend meals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
