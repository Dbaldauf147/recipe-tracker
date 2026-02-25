import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only middleware: proxies /api/fetch-url?url=... requests server-side
// so the browser never hits CORS issues.
function fetchUrlProxy() {
  return {
    name: 'fetch-url-proxy',
    configureServer(server) {
      server.middlewares.use('/api/fetch-url', async (req, res) => {
        const url = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; SundayMealPlanner/1.0)',
              'Accept': 'text/html,application/xhtml+xml',
            },
          });
          if (!response.ok) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Upstream returned ${response.status}` }));
            return;
          }
          const html = await response.text();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

// Dev-only middleware: proxies /api/instagram-caption?url=... to Apify
function instagramCaptionProxy() {
  return {
    name: 'instagram-caption-proxy',
    configureServer(server) {
      server.middlewares.use('/api/instagram-caption', async (req, res) => {
        const url = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }
        if (!/instagram\.com\/(p|reel|tv)\//i.test(url)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid Instagram post URL' }));
          return;
        }
        const apiKey = process.env.APIFY_API_KEY;
        if (!apiKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Apify API key is not configured' }));
          return;
        }
        try {
          const runRes = await fetch(
            `https://api.apify.com/v2/acts/apify~instagram-post-scraper/runs?token=${apiKey}&waitForFinish=60`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ directUrls: [url], resultsLimit: 1 }),
            }
          );
          if (!runRes.ok) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to start Apify scraper' }));
            return;
          }
          const run = await runRes.json();
          const datasetId = run.data?.defaultDatasetId;
          if (!datasetId) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Apify run did not return a dataset' }));
            return;
          }
          const datasetRes = await fetch(
            `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&format=json`
          );
          if (!datasetRes.ok) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch Apify dataset results' }));
            return;
          }
          const items = await datasetRes.json();
          if (!items.length || !items[0].caption) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No caption found for this Instagram post' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ caption: items[0].caption }));
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ prefixed) for server middleware
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [react(), fetchUrlProxy(), instagramCaptionProxy()],
  };
})
