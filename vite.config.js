import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
              'User-Agent': 'Mozilla/5.0 (compatible; PrepDayMealPlanner/1.0)',
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

// Dev-only middleware: fetches Instagram captions via the embed endpoint
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
        const match = url.match(/instagram\.com\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
        if (!match) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid Instagram post URL' }));
          return;
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
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Instagram returned ${response.status}` }));
            return;
          }
          const html = await response.text();
          const captionMatch = html.match(/class="Caption"[^>]*>(.*?)<\/div>/s);
          if (!captionMatch) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No caption found for this Instagram post' }));
            return;
          }
          let caption = captionMatch[1];
          caption = caption.replace(/<br\s*\/?>/gi, '\n');
          caption = caption.replace(/<[^>]+>/g, '');
          caption = caption.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
          caption = caption.replace(/^[\w.]+/, '').trim();
          caption = caption.replace(/View all \d+ comments\s*$/, '').trim();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ caption }));
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
  server: {
    proxy: {
      '/api/nutrition-lookup': { target: 'https://prep-day.com', changeOrigin: true, secure: true },
      '/api/parse-nutrition-label': { target: 'https://prep-day.com', changeOrigin: true, secure: true },
      '/api/parse-nutrition-text': { target: 'https://prep-day.com', changeOrigin: true, secure: true },
      '/api/extract-recipe': { target: 'https://prep-day.com', changeOrigin: true, secure: true },
      '/api/notify-signup': { target: 'https://prep-day.com', changeOrigin: true, secure: true },
    },
  },
  plugins: [
    react(),
    fetchUrlProxy(),
    instagramCaptionProxy(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Prep Day',
        short_name: 'Prep Day',
        description: 'Meal planning and recipe tracker',
        theme_color: '#2C2520',
        background_color: '#FAF8F5',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
})
