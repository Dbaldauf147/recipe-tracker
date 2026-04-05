// Vercel serverless function: fetches TikTok video captions via the oEmbed API
// Auto-routed at /api/tiktok-caption?url=...

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Validate it looks like a TikTok URL
  const isTikTok = /tiktok\.com/i.test(url);
  if (!isTikTok) {
    return res.status(400).json({ error: 'Invalid TikTok URL' });
  }

  try {
    // 1. Try oEmbed API first (most reliable, no auth needed)
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const oembedRes = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (oembedRes.ok) {
      const data = await oembedRes.json();
      const caption = data.title || '';
      if (caption) {
        return res.status(200).json({
          caption,
          author: data.author_name || '',
          authorUrl: data.author_url || '',
        });
      }
    }

    // 2. Fallback: fetch the page HTML and extract from meta tags / JSON-LD
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!pageRes.ok) {
      return res.status(502).json({ error: `TikTok returned ${pageRes.status}` });
    }

    const html = await pageRes.text();

    // Try og:description meta tag
    const ogMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i)
      || html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:description"[^>]*>/i);
    if (ogMatch) {
      let caption = ogMatch[1];
      caption = caption.replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return res.status(200).json({ caption, author: '', authorUrl: '' });
    }

    // Try JSON-LD VideoObject
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const block of jsonLdMatch) {
        const jsonStr = block.replace(/<\/?script[^>]*>/gi, '');
        try {
          let data = JSON.parse(jsonStr);
          if (Array.isArray(data)) data = data[0];
          if (data?.description || data?.name) {
            return res.status(200).json({
              caption: data.description || data.name || '',
              author: data.creator?.name || data.author?.name || '',
              authorUrl: '',
            });
          }
        } catch {}
      }
    }

    // Try embedded __UNIVERSAL_DATA desc field
    const descMatch = html.match(/"desc"\s*:\s*"([^"]+)"/);
    if (descMatch) {
      let caption = descMatch[1].replace(/\\u[\dA-Fa-f]{4}/g, m =>
        String.fromCharCode(parseInt(m.slice(2), 16))
      );
      return res.status(200).json({ caption, author: '', authorUrl: '' });
    }

    return res.status(404).json({ error: 'No caption found for this TikTok video' });
  } catch (err) {
    console.error('TikTok caption error:', err);
    return res.status(502).json({ error: err.message });
  }
}
