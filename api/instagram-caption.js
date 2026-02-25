// Vercel serverless function: fetches Instagram post captions via Apify
// Auto-routed at /api/instagram-caption?url=...

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Basic validation: must look like an Instagram URL
  if (!/instagram\.com\/(p|reels?|tv)\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid Instagram post URL' });
  }

  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Apify API key is not configured' });
  }

  try {
    // Start the actor run and wait up to 60 seconds for it to finish
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-post-scraper/runs?token=${apiKey}&waitForFinish=60`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directUrls: [url],
          resultsLimit: 1,
        }),
      }
    );

    if (!runRes.ok) {
      const body = await runRes.text();
      console.error('Apify run request failed:', runRes.status, body);
      return res.status(502).json({ error: 'Failed to start Apify scraper' });
    }

    const run = await runRes.json();
    const datasetId = run.data?.defaultDatasetId;

    if (!datasetId) {
      return res.status(502).json({ error: 'Apify run did not return a dataset' });
    }

    // Fetch results from the dataset
    const datasetRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&format=json`
    );

    if (!datasetRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch Apify dataset results' });
    }

    const items = await datasetRes.json();

    if (!items.length || !items[0].caption) {
      return res.status(404).json({ error: 'No caption found for this Instagram post' });
    }

    return res.status(200).json({ caption: items[0].caption });
  } catch (err) {
    console.error('Instagram caption error:', err);
    return res.status(502).json({ error: err.message });
  }
}
