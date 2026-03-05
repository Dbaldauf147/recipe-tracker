// Vercel serverless function: parses nutrition label photos via Claude Vision
// Auto-routed at /api/parse-nutrition-label

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image } = req.body || {};
  if (!image) {
    return res.status(400).json({ error: 'Missing image (base64) in request body' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  // Detect media type from base64 data URI prefix, default to jpeg
  let mediaType = 'image/jpeg';
  let base64Data = image;
  const dataUriMatch = image.match(/^data:(image\/\w+);base64,/);
  if (dataUriMatch) {
    mediaType = dataUriMatch[1];
    base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  }

  const prompt = `You are reading a nutrition facts label from a food product photo.

Extract every nutrition value you can find and return ONLY a JSON object with these exact keys (use empty string "" for any value not visible on the label):

{
  "ingredient": "(product name if visible, otherwise empty string)",
  "grams": "(serving size in grams)",
  "measurement": "(serving size description, e.g. '1 cup', '2 tbsp')",
  "calories": "(total calories per serving)",
  "protein": "(protein in grams)",
  "carbs": "(total carbohydrates in grams)",
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
  "vitaminB12": "(vitamin B12 in µg)",
  "vitaminC": "(vitamin C in mg)",
  "leucine": "",
  "omega3": "",
  "proteinPerCal": "",
  "fiberPerCal": "",
  "processed": "",
  "notes": "",
  "link": "",
  "lastBought": "",
  "storage": "",
  "minShelf": "",
  "maxShelf": ""
}

Important rules:
- Return ONLY the JSON object, no markdown, no explanation
- Use numeric values only (no units in the value, e.g. "150" not "150mg")
- If a value shows a percentage (% Daily Value) but not the actual amount, leave it as ""
- If the label shows values per container, use the PER SERVING values instead`;

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
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(502).json({ error: `Claude API error: ${response.status}`, details: errBody });
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || '';

    // Parse the JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Could not parse nutrition data from image', raw: text });
    }

    const nutrition = JSON.parse(jsonMatch[0]);
    return res.status(200).json(nutrition);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
