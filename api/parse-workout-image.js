// Vercel serverless function: parses workout-log screenshots via Claude Vision
// Auto-routed at /api/parse-workout-image
//
// Returns { entries: [{ group, exercise, notes, time, sets[4], weight, perArm }] }
// to match the WorkoutPage Log Workout entry shape.

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

  const prompt = `You are reading a workout log from a screenshot — typically a spreadsheet or app showing one row per exercise with columns like Group, Exercise/Workout, Date, Gym, Notes, Time (rest), 1/2/3/4 (set reps), Per (per-arm/leg weight), Total (total weight).

Extract every exercise row and return ONLY this JSON object:

{
  "entries": [
    {
      "group": "(one of: Chest, Back, Legs, Shoulders, Biceps, Triceps, Abs, Forearms, Cardio, Yoga, Whole Body — pick the closest match; empty string if unknown)",
      "exercise": "(exercise name)",
      "notes": "(notes for that row; empty string if none)",
      "time": "(rest time as a string, e.g. '2:00'; default '2:00' if not visible)",
      "sets": ["(set 1 reps as string)", "(set 2)", "(set 3)", "(set 4)"],
      "weight": "(weight as a number string; the per-side value when perArm is true, otherwise the total)",
      "perArm": (boolean — true when the screenshot shows separate "Per" / "Total" columns or otherwise indicates the weight is per arm/leg/side)
    }
  ]
}

CRITICAL rules:
- Skip the header row (Group / Exercise / etc.)
- Each subsequent row is one entry
- "sets" must always be length 4 — pad with empty strings if fewer set columns are filled
- If you see BOTH a "Per" column AND a "Total" column, use the Per value for "weight" and set perArm: true. (Total = Per × 2 when per-arm; do not use the Total field for "weight".)
- If only one weight column exists, use it for "weight" and set perArm: false
- Strip trailing zeros from numeric values ("9.00" → "9", "72.50" → "72.5")
- For Group: map source-spreadsheet groups to the canonical list above. Movement-pattern groups translate as: Push → use Chest/Shoulders/Triceps based on the exercise; Pull → Back/Biceps; Snack → Whole Body; if ambiguous, leave empty.
- Return ONLY the JSON object, no markdown, no commentary
- Do not include Date or Gym fields in the output — those are tracked separately in the app`;

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
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
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
      return res.status(500).json({ error: 'Could not parse workout data from image', raw: text });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    // Normalise each entry to the exact shape WorkoutPage expects.
    const cleaned = entries.map(e => {
      let sets = Array.isArray(e.sets) ? e.sets.map(s => (s == null ? '' : String(s).trim())) : [];
      while (sets.length < 4) sets.push('');
      sets = sets.slice(0, 4);
      return {
        group: typeof e.group === 'string' ? e.group.trim() : '',
        exercise: typeof e.exercise === 'string' ? e.exercise.trim() : '',
        notes: typeof e.notes === 'string' ? e.notes.trim() : '',
        time: typeof e.time === 'string' && e.time.trim() ? e.time.trim() : '2:00',
        sets,
        weight: e.weight == null ? '' : String(e.weight).trim(),
        perArm: !!e.perArm,
      };
    });
    return res.status(200).json({ entries: cleaned });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
