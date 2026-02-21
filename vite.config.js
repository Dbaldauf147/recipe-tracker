import { defineConfig } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), fetchUrlProxy()],
})
