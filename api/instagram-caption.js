// Vercel serverless function: fetches Instagram post captions via the embed endpoint
// Auto-routed at /api/instagram-caption?url=...

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Extract the shortcode from various Instagram URL formats
  const match = url.match(/instagram\.com\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
  if (!match) {
    return res.status(400).json({ error: 'Invalid Instagram post URL' });
  }

  const shortcode = match[1];
  const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/captioned/`;

  try {
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Instagram returned ${response.status}` });
    }

    const html = await response.text();

    // Extract caption from the embed HTML
    const captionMatch = html.match(/class="Caption"[^>]*>(.*?)<\/div>/s);
    if (!captionMatch) {
      return res.status(404).json({ error: 'No caption found for this Instagram post' });
    }

    let caption = captionMatch[1];
    // Replace <br> tags with newlines
    caption = caption.replace(/<br\s*\/?>/gi, '\n');
    // Strip remaining HTML tags
    caption = caption.replace(/<[^>]+>/g, '');
    // Decode HTML entities
    caption = caption.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    // Remove leading username (first word before the caption)
    caption = caption.replace(/^[\w.]+/, '').trim();
    // Remove trailing "View all N comments" line
    caption = caption.replace(/View all \d+ comments\s*$/, '').trim();

    return res.status(200).json({ caption });
  } catch (err) {
    console.error('Instagram caption error:', err);
    return res.status(502).json({ error: err.message });
  }
}
