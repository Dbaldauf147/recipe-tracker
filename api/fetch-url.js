// Vercel serverless function: proxies recipe URL fetches to avoid CORS
// Auto-routed at /api/fetch-url?url=...
// Also handles Pinterest extraction: /api/fetch-url?url=...&pinterest=true

function extractPinterestSourceUrl(html) {
  let sourceUrl = null;

  // Strategy 1: JSON data blocks embedded in the page
  const jsonPatterns = [
    /"link"\s*:\s*"(https?:\/\/[^"]+)"/g,
    /"source_url"\s*:\s*"(https?:\/\/[^"]+)"/g,
    /"richPinUrl"\s*:\s*"(https?:\/\/[^"]+)"/g,
  ];

  for (const pattern of jsonPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const candidate = match[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
      if (!candidate.includes('pinterest.com') && !candidate.includes('pin.it')) {
        sourceUrl = candidate;
        break;
      }
    }
    if (sourceUrl) break;
  }

  // Strategy 2: meta tags
  if (!sourceUrl) {
    const metaPatterns = [
      /property="pinterestapp:source"\s+content="([^"]+)"/i,
      /name="pinterestapp:source"\s+content="([^"]+)"/i,
      /property="og:see_also"\s+content="([^"]+)"/i,
    ];
    for (const pattern of metaPatterns) {
      const match = html.match(pattern);
      if (match && match[1] && !match[1].includes('pinterest.com')) {
        sourceUrl = match[1];
        break;
      }
    }
  }

  // Strategy 3: data-test-id link
  if (!sourceUrl) {
    const visitMatch = html.match(/data-test-id="(?:rich-pin-link|source-link)"[^>]*href="([^"]+)"/i);
    if (visitMatch && visitMatch[1]) {
      sourceUrl = visitMatch[1];
    }
  }

  return sourceUrl;
}

export default async function handler(req, res) {
  const url = req.query.url;
  const isPinterest = req.query.pinterest === 'true';

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  if (isPinterest && !/pinterest\.(com|ca|co\.uk|com\.au)|pin\.it/i.test(url)) {
    return res.status(400).json({ error: 'Not a valid Pinterest URL' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PrepDayMealPlanner/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Upstream returned ${response.status}` });
    }

    const html = await response.text();

    if (isPinterest) {
      const sourceUrl = extractPinterestSourceUrl(html);
      if (!sourceUrl) {
        return res.status(404).json({
          error: 'Could not find a source recipe link on this Pinterest pin. The pin may not link to an external recipe.',
        });
      }
      return res.status(200).json({ sourceUrl });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
