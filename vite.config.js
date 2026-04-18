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

// Dev-only middleware: fetches TikTok captions via oEmbed API
function tiktokCaptionProxy() {
  return {
    name: 'tiktok-caption-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tiktok-caption', async (req, res) => {
        const url = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }
        if (!/tiktok\.com/i.test(url)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid TikTok URL' }));
          return;
        }
        try {
          // Use TikTok oEmbed API
          const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
          const oembedRes = await fetch(oembedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
            },
          });
          if (oembedRes.ok) {
            const data = await oembedRes.json();
            if (data.title) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                caption: data.title,
                author: data.author_name || '',
                authorUrl: data.author_url || '',
              }));
              return;
            }
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No caption found for this TikTok video' }));
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

// Dev-only middleware: proxies USDA Branded food search for restaurant import
function restaurantSearchProxy() {
  return {
    name: 'restaurant-search-proxy',
    configureServer(server) {
      server.middlewares.use('/api/restaurant-search', async (req, res) => {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const query = params.get('query');
        const type = params.get('type');
        const fdcId = params.get('fdcId');
        const apiKey = process.env.VITE_USDA_API_KEY || 'DEMO_KEY';

        const NUTRIENT_IDS = {
          calories: 1008, protein: 1003, carbs: 1005, fat: 1004,
          saturatedFat: 1258, sugar: 2000, fiber: 1079, sodium: 1093,
          potassium: 1092, calcium: 1087, iron: 1089, magnesium: 1090,
          zinc: 1095, vitaminB12: 1178, vitaminC: 1162, cholesterol: 1253,
        };

        function extractNutrient(nutrients, nid) {
          const m = nutrients.find(fn => (fn.nutrientId || fn.nutrient?.id) === nid);
          return m ? (m.value ?? m.amount ?? null) : null;
        }

        try {
          if (type === 'nutrients' && fdcId) {
            const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${apiKey}`;
            const response = await fetch(url);
            if (!response.ok) {
              res.writeHead(response.status, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `USDA API error: ${response.status}` }));
              return;
            }
            const food = await response.json();
            const foodNutrients = food.foodNutrients || [];
            const nutrients = {};
            for (const [key, nid] of Object.entries(NUTRIENT_IDS)) {
              const val = extractNutrient(foodNutrients, nid);
              nutrients[key] = val != null ? Math.round(val * 100) / 100 : 0;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              name: food.description,
              brandName: food.brandName || food.brandOwner || '',
              servingSize: food.servingSize ? `${food.servingSize}${food.servingSizeUnit || 'g'}` : '',
              servingDescription: food.householdServingFullText || '',
              nutrients,
            }));
            return;
          }

          if (!query || !query.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing query parameter' }));
            return;
          }

          const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query.trim())}&dataType=Branded&pageSize=20`;
          const response = await fetch(url);
          if (!response.ok) {
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `USDA API error: ${response.status}` }));
            return;
          }
          const data = await response.json();
          const results = (data.foods || []).map(food => {
            const calories = extractNutrient(food.foodNutrients || [], 1008);
            const protein = extractNutrient(food.foodNutrients || [], 1003);
            return {
              fdcId: food.fdcId,
              name: food.description,
              brandName: food.brandName || food.brandOwner || '',
              servingSize: food.servingSize,
              servingSizeUnit: food.servingSizeUnit || 'g',
              householdServing: food.householdServingFullText || '',
              calories: calories != null ? Math.round(calories) : null,
              protein: protein != null ? Math.round(protein) : null,
            };
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ results }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
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
    tiktokCaptionProxy(),
    restaurantSearchProxy(),
    VitePWA({
      registerType: 'prompt',
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
        globPatterns: ['**/*.{ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // skipWaiting intentionally left off so UpdatePrompt can surface the
        // "new version available" pill (needRefresh only fires while the new
        // SW is still waiting).
        clientsClaim: true,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'assets', expiration: { maxEntries: 50, maxAgeSeconds: 3600 } },
          },
        ],
      },
    }),
  ],
})
