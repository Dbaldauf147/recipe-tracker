// Vercel serverless function: parses plain text nutrition data via Claude
// Auto-routed at /api/parse-nutrition-text

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: 'Missing text in request body' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const prompt = `You are a nutrition data extraction assistant. Parse the following text and extract nutrition information for each ingredient or food item mentioned.

For EACH ingredient found, return a JSON object with these exact keys (use empty string "" for any value not found):

{
  "ingredient": "(ingredient name)",
  "grams": "(serving size in grams)",
  "measurement": "(serving size description, e.g. '1 cup', '100g')",
  "calories": "(calories per serving)",
  "protein": "(protein in grams)",
  "carbs": "(total carbs in grams)",
  "fat": "(total fat in grams)",
  "saturatedFat": "(saturated fat in grams)",
  "fiber": "(dietary fiber in grams)",
  "sugar": "(total sugars in grams)",
  "addedSugar": "(added sugars in grams)",
  "sodium": "(sodium in mg)",
  "potassium": "(potassium in mg)",
  "calcium": "(calcium in mg)",
  "magnesium": "(magnesium in mg)",
  "iron": "(iron in mg)",
  "zinc": "(zinc in mg)",
  "vitaminB12": "(vitamin B12 in mcg)",
  "vitaminC": "(vitamin C in mg)",
  "leucine": "",
  "omega3": "",
  "notes": ""
}

If there are multiple ingredients, return a JSON array of objects.
If there is only one ingredient, return a single JSON object (not wrapped in an array).

Important rules:
- Return ONLY valid JSON, no markdown, no explanation, no code fences
- Use numeric values only (no units in the value, e.g. "150" not "150mg")
- If nutritional values are not provided in the text, use "" for those fields
- Normalize serving sizes to grams when possible

Text to parse:
${text}`;

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
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(502).json({ error: `Claude API error: ${response.status}`, details: errBody });
    }

    const result = await response.json();
    const responseText = result.content?.[0]?.text || '';

    // Parse the JSON from Claude's response
    const jsonMatch = responseText.match(/[\[{][\s\S]*[\]}]/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Could not parse nutrition data from text', raw: responseText });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
