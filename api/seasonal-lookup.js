// Vercel serverless function: looks up seasonal months for ingredients via Claude
// Auto-routed at /api/seasonal-lookup

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ingredients, region } = req.body || {};
  if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'Missing ingredients array' });
  }
  if (!region) {
    return res.status(400).json({ error: 'Missing region' });
  }

  // Limit batch size
  const batch = ingredients.slice(0, 20);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const regionDisplay = region.replace(/_/g, ' ');

  const systemPrompt = `You are a produce seasonality expert. For each ingredient, determine its peak season months in the ${regionDisplay} region of the United States.

Return ONLY valid JSON — no markdown, no explanation. The JSON must be an object where each key is the ingredient name (lowercase) and the value is an array of month numbers (1-12) when that ingredient is in peak/good season in that region.

Rules:
- Use month numbers 1-12 (1=January, 12=December)
- Only include months when the ingredient is in peak or good season locally
- For ingredients that are not seasonal produce (e.g. rice, pasta, chicken, milk), return an empty array []
- For ingredients available year-round in that region, return all 12 months [1,2,3,4,5,6,7,8,9,10,11,12]
- Base answers on USDA seasonal guides and local agricultural data
- Be specific to the ${regionDisplay} region's climate and growing season`;

  const prompt = `What are the peak season months for these ingredients in the ${regionDisplay} US region?\n\n${batch.map((ing, i) => `${i + 1}. ${ing}`).join('\n')}`;

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
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude API error:', response.status, errText);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: 'Could not parse AI response' });
    }

    const result = JSON.parse(jsonMatch[0]);

    // Validate structure
    const cleaned = {};
    for (const [key, months] of Object.entries(result)) {
      if (Array.isArray(months) && months.every(m => typeof m === 'number' && m >= 1 && m <= 12)) {
        cleaned[key.toLowerCase()] = months;
      }
    }

    return res.status(200).json({ data: cleaned });
  } catch (err) {
    console.error('seasonal-lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
