// Vercel serverless function: suggests recipe improvements via Claude
// Auto-routed at /api/suggest-improvements

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, ingredients, instructions, cuisine } = req.body || {};
  if (!title) {
    return res.status(400).json({ error: 'Missing recipe title' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const ingredientList = (ingredients || []).map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`.trim()).join(', ');

  const systemPrompt = `You are a professional chef giving quick, practical suggestions to improve a home recipe. Be concise and specific. Return ONLY valid JSON, no markdown.

Return this structure:
{
  "ingredientSwaps": [
    { "current": "ingredient name", "suggestion": "better alternative", "reason": "short reason" }
  ],
  "additions": [
    { "ingredient": "name", "amount": "suggested amount", "reason": "what it adds to the dish" }
  ],
  "tips": [
    "1-2 sentence cooking tip specific to this recipe"
  ]
}

Rules:
- Suggest 1-3 ingredient swaps (for health, flavor, or texture)
- Suggest 1-3 additions that would elevate the dish
- Give 1-2 cooking tips specific to this recipe
- Keep reasons under 10 words each
- Be practical — suggest common, accessible ingredients`;

  const userMsg = `Recipe: ${title}${cuisine ? ` (${cuisine} cuisine)` : ''}
Ingredients: ${ingredientList || 'not provided'}
${instructions ? `Instructions: ${instructions.slice(0, 500)}` : ''}`;

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
      return res.status(502).json({ error: 'Failed to generate suggestions.' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let suggestions;
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      suggestions = JSON.parse(jsonStr);
    } catch {
      console.error('Parse error:', text);
      return res.status(502).json({ error: 'Failed to parse suggestions.' });
    }

    return res.status(200).json(suggestions);
  } catch (err) {
    console.error('Suggest improvements error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
