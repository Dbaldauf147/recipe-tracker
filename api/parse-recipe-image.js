// Vercel serverless function: parses recipe screenshots/photos via Claude Vision
// Auto-routed at /api/parse-recipe-image

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

  let mediaType = 'image/jpeg';
  let base64Data = image;
  const dataUriMatch = image.match(/^data:(image\/\w+);base64,/);
  if (dataUriMatch) {
    mediaType = dataUriMatch[1];
    base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  }

  const prompt = `You are reading a recipe from an image. The layout could be ANY of:
- A standard recipe (Title, "Ingredients:" list, "Instructions:" steps)
- A photo of a recipe card or cookbook page
- A spreadsheet/table with columns like Instructions, Quantity, Measurement, Ingredient (or Unit, Item, Amount, Qty)
- A sticky note or hand-written list

Extract the recipe and return ONLY a JSON object with these exact keys:

{
  "title": "(recipe name; empty string if none visible)",
  "ingredients": ["(one ingredient per array element, e.g. '9 large eggs', '2 tbsp olive oil')"],
  "instructions": "(steps as a single string, one step per line, separated by \\n; do not number)",
  "servings": "(number of servings as a string, or empty string)",
  "category": "(one of: breakfast, lunch-dinner, snack, dessert, drink — or empty string)"
}

CRITICAL — handle tabular layouts carefully:
- If the image shows columns labeled "Quantity", "Measurement", "Ingredient" (or similar like Unit/Item/Amount/Qty), each ROW is ONE ingredient. Combine the quantity + measurement + ingredient cells from each row into a single natural string and put it in the ingredients array.
- If the image has BOTH an "Instructions" column AND ingredient columns, you must extract BOTH independently:
    - Instructions cells → joined into the "instructions" field (one step per line)
    - Quantity + Measurement + Ingredient cells from each row → one entry in the "ingredients" array
- A row may have an instruction step paired with an ingredient — extract both, do not skip either side.
- An empty Instructions cell does NOT mean skip the row — the ingredient on that row is still valid.
- An empty Ingredient cell with a non-empty Instructions cell is still a valid instruction step.

Rules:
- Return ONLY the JSON object — no markdown, no commentary, no code fence
- Each ingredient is one array element, formatted naturally (combine qty + unit + name)
- Strip trailing zeros from numeric quantities ("9.00" → "9", "1.50" → "1.5")
- Skip section headers in ingredients (e.g. "For the sauce:") and skip column headers themselves
- Use "" for missing strings, [] for missing ingredients
- Never return an empty ingredients array if any ingredient text is visible in the image`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              { type: 'text', text: prompt },
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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Could not parse recipe from image', raw: text });
    }

    const recipe = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(recipe.ingredients)) recipe.ingredients = [];
    if (typeof recipe.title !== 'string') recipe.title = '';
    if (typeof recipe.instructions !== 'string') recipe.instructions = '';
    if (typeof recipe.servings !== 'string') recipe.servings = '';
    if (typeof recipe.category !== 'string') recipe.category = '';
    return res.status(200).json(recipe);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
