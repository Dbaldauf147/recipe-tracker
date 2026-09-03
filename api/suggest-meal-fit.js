// Vercel serverless function: ingredient swaps that move a meal toward its
// nutrition goals. Auto-routed at /api/suggest-meal-fit
//
// The Design a Meal page solves the arithmetic itself — how far to cut the
// olive oil, how much spinach closes the fibre gap — from real per-ingredient
// nutrition. This endpoint covers what arithmetic cannot: substitutions.
// Greek yogurt for sour cream is not a number the solver can reach, because
// the alternative isn't in the meal.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, servings, ingredients, goals } = req.body || {};
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'Missing ingredients' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const ingredientList = ingredients
    .map(i => `${i.quantity || ''} ${i.measurement || ''} ${i.ingredient}`.replace(/\s+/g, ' ').trim())
    .join('\n');

  const goalList = (goals || [])
    .map(g => {
      const bound = g.min != null && g.max != null
        ? `${g.min}–${g.max}${g.unit || ''}`
        : g.min != null
          ? `at least ${g.min}${g.unit || ''}`
          : `at most ${g.max}${g.unit || ''}`;
      return `- ${g.label}: ${g.actual}${g.unit || ''} (target ${bound}) — ${g.status.toUpperCase()}`;
    })
    .join('\n');

  const systemPrompt = `You are a nutrition-minded cook. A meal has been scored against per-serving goals and some are missed. Suggest INGREDIENT SUBSTITUTIONS and ADDITIONS that move it toward the missed goals while keeping the dish recognisable and good to eat.

Return ONLY valid JSON, no markdown:
{
  "swaps": [
    { "remove": "ingredient currently in the meal", "add": "replacement", "amount": "1/2 cup", "reason": "short reason tied to a missed goal" }
  ],
  "additions": [
    { "ingredient": "name", "amount": "1 cup", "reason": "short reason tied to a missed goal" }
  ],
  "removals": [
    { "ingredient": "name", "reason": "short reason" }
  ],
  "notes": ["one short caveat or cooking note, if any"]
}

Rules:
- Only suggest changes that help a goal marked OVER or UNDER. Say which in the reason.
- "remove" must name an ingredient that is actually in the list you were given, spelled the same way.
- Always give a concrete "amount" with a unit for anything added — it gets looked up and scored.
- Prefer common, accessible ingredients over specialty ones.
- At most 3 swaps, 3 additions, 2 removals. Reasons under 12 words.
- Do NOT suggest simply using less or more of something already in the meal — the app already computes those amounts exactly. Suggest different ingredients.
- Return an empty array for any section you have nothing useful for.`;

  const userMsg = `Meal: ${title || 'untitled'}${servings ? ` (makes ${servings} servings)` : ''}

Ingredients:
${ingredientList}

Per-serving goals:
${goalList || '(none provided)'}`;

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
        max_tokens: 1500,
        messages: [{ role: 'user', content: userMsg }],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(502).json({ error: 'Failed to generate ideas.' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let ideas;
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      ideas = JSON.parse(jsonStr);
    } catch {
      console.error('Parse error:', text);
      return res.status(502).json({ error: 'Failed to parse ideas.' });
    }

    // Shape defensively — the page maps over each of these.
    return res.status(200).json({
      swaps: Array.isArray(ideas.swaps) ? ideas.swaps : [],
      additions: Array.isArray(ideas.additions) ? ideas.additions : [],
      removals: Array.isArray(ideas.removals) ? ideas.removals : [],
      notes: Array.isArray(ideas.notes) ? ideas.notes : [],
    });
  } catch (err) {
    console.error('Suggest meal fit error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
