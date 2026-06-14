// Vercel serverless function: reads a Sudoku puzzle from a screenshot/photo via Claude Vision
// Auto-routed at /api/parse-sudoku-image
// Returns a 9x9 grid of integers (0 = empty cell).

import heicConvert from 'heic-convert';

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
  base64Data = base64Data.replace(/\s+/g, '');

  const invalidCharMatch = base64Data.match(/[^A-Za-z0-9+/=]/);
  if (invalidCharMatch) {
    return res.status(400).json({
      error: `Base64 contains invalid character "${invalidCharMatch[0]}" (code ${invalidCharMatch[0].charCodeAt(0)}) at position ${invalidCharMatch.index}`,
    });
  }

  let decodedBuffer;
  try {
    decodedBuffer = Buffer.from(base64Data, 'base64');
  } catch (err) {
    return res.status(400).json({ error: `Base64 decode failed: ${err.message}` });
  }
  const firstBytes = decodedBuffer.slice(0, 16).toString('hex');
  const lastBytes = decodedBuffer.slice(-8).toString('hex');

  let detectedFormat = 'unknown';
  if (decodedBuffer[0] === 0xff && decodedBuffer[1] === 0xd8 && decodedBuffer[2] === 0xff) {
    detectedFormat = 'jpeg';
    mediaType = 'image/jpeg';
  } else if (decodedBuffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
    detectedFormat = 'png';
    mediaType = 'image/png';
  } else if (decodedBuffer.slice(0, 4).toString('ascii') === 'GIF8') {
    detectedFormat = 'gif';
    mediaType = 'image/gif';
  } else if (decodedBuffer.slice(0, 4).toString('ascii') === 'RIFF' && decodedBuffer.slice(8, 12).toString('ascii') === 'WEBP') {
    detectedFormat = 'webp';
    mediaType = 'image/webp';
  } else if (decodedBuffer.slice(4, 12).toString('ascii') === 'ftypheic' || decodedBuffer.slice(4, 12).toString('ascii') === 'ftypheix' || decodedBuffer.slice(4, 12).toString('ascii') === 'ftypmif1') {
    try {
      const jpegArrayBuffer = await heicConvert({ buffer: decodedBuffer, format: 'JPEG', quality: 0.85 });
      decodedBuffer = Buffer.from(jpegArrayBuffer);
      base64Data = decodedBuffer.toString('base64');
      detectedFormat = 'jpeg';
      mediaType = 'image/jpeg';
    } catch (err) {
      return res.status(500).json({ error: `HEIC decode failed: ${err.message}` });
    }
  } else {
    return res.status(400).json({ error: `Unrecognized image format. First 16 bytes (hex): ${firstBytes}`, decodedLength: decodedBuffer.length });
  }

  // JPEG sanity: must end with FFD9 (EOI marker). Truncated JPEGs cause Claude
  // to return "Could not process image" with no specific reason.
  if (detectedFormat === 'jpeg') {
    const tail = decodedBuffer.slice(-2).toString('hex');
    if (tail !== 'ffd9') {
      return res.status(400).json({
        error: `JPEG appears truncated — missing EOI marker. Last 8 bytes: ${lastBytes}, length: ${decodedBuffer.length}, base64 length: ${base64Data.length}`,
      });
    }
  }

  const prompt = `You are reading a 9x9 Sudoku puzzle from an image (a screenshot, photo, or scan of a puzzle).

Read the grid carefully, top-to-bottom, left-to-right. Some cells contain a printed digit (1-9) and some are blank. Ignore any small "pencil mark" candidate digits printed in the corners of empty cells — only report a digit if it is the single large value filling the cell.

Return ONLY a JSON object with this exact shape:

{
  "grid": [
    [r1c1, r1c2, r1c3, r1c4, r1c5, r1c6, r1c7, r1c8, r1c9],
    ... 9 rows total ...
  ]
}

Rules:
- "grid" MUST be an array of exactly 9 rows, each an array of exactly 9 integers.
- Use 0 for any blank/empty cell. Use 1-9 for filled cells.
- Return ONLY the JSON object — no markdown, no commentary, no code fence.
- Double-check the row and column count: exactly 9 x 9.`;

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
        max_tokens: 1024,
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
      return res.status(500).json({ error: 'Could not parse Sudoku grid from image', raw: text });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      return res.status(500).json({ error: `Failed to parse JSON from model output: ${err.message}`, raw: text });
    }

    const grid = parsed.grid;
    if (!Array.isArray(grid) || grid.length !== 9 || !grid.every(row => Array.isArray(row) && row.length === 9)) {
      return res.status(500).json({ error: 'Model did not return a valid 9x9 grid', raw: text });
    }

    // Normalize every cell to an integer 0-9.
    const normalized = grid.map(row =>
      row.map(cell => {
        const n = Number(cell);
        return Number.isInteger(n) && n >= 1 && n <= 9 ? n : 0;
      })
    );

    return res.status(200).json({ grid: normalized });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
