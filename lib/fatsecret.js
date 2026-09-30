// FatSecret Platform API (free "Basic" tier) — restaurant and brand menu items.
//
// Basic tier: 5,000 calls/day, attribution required ("Powered by fatsecret"),
// and token requests are only honoured from IPs whitelisted on the key. Vercel
// functions have no fixed egress IP, so the key is whitelisted as 0.0.0.0/0;
// the secret never leaves the server, which is what keeps that acceptable.
//
// Env: FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET.

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const SEARCH_URL = 'https://platform.fatsecret.com/rest/foods/search/v1';
const FOOD_URL = 'https://platform.fatsecret.com/rest/food/v4';

export function fatSecretConfigured(env = process.env) {
  return !!(env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET);
}

// Tokens last 24h; a warm function instance reuses one instead of spending a
// call (and a token request) on every search.
let cachedToken = null;
let cachedTokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  const auth = Buffer.from(
    `${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`,
  ).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=basic',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`FatSecret token error: ${data.error || res.status}`);
  }
  cachedToken = data.access_token;
  // Refresh a minute early so a token never expires mid-request.
  cachedTokenExpiry = Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

async function call(url) {
  const token = await getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  // FatSecret reports failures (bad scope, IP not whitelisted, quota) as
  // 200 + { error: { code, message } }, so the status alone proves nothing.
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    throw new Error(`FatSecret error: ${msg}`);
  }
  return data;
}

// FatSecret returns a bare object instead of a one-element array when there
// is exactly one match — normalise both (and absence) to an array.
export function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// "Per 1 burger - Calories: 590kcal | Fat: 34.00g | Carbs: 46.00g | Protein: 25.00g"
export function parseFoodDescription(desc = '') {
  const [head, ...rest] = String(desc).split(' - ');
  const body = rest.join(' - ');
  const pick = (label) => {
    const m = body.match(new RegExp(`${label}:\\s*([\\d.]+)`, 'i'));
    return m ? parseFloat(m[1]) : null;
  };
  return {
    serving: head.replace(/^Per\s+/i, '').trim(),
    calories: pick('Calories'),
    fat: pick('Fat'),
    carbs: pick('Carbs'),
    protein: pick('Protein'),
  };
}

export function mapSearchResults(data) {
  const foods = asArray(data?.foods?.food);
  const results = foods.map(f => {
    const d = parseFoodDescription(f.food_description);
    return {
      id: String(f.food_id),
      source: 'fatsecret',
      name: f.food_name,
      brandName: f.brand_name || '',
      householdServing: d.serving,
      calories: d.calories != null ? Math.round(d.calories) : null,
      protein: d.protein != null ? Math.round(d.protein) : null,
      isBrand: f.food_type === 'Brand',
    };
  });
  // This is a restaurant search: chain/brand items before generic foods.
  // Array.prototype.sort is stable, so FatSecret's relevance order holds within each group.
  return results.sort((a, b) => Number(b.isBrand) - Number(a.isBrand));
}

const METRIC_ONLY = new Set(['g', 'oz', 'ml', 'fl oz', 'lb', 'kg']);

// Basic tier doesn't get the is_default flag. Restaurant items list a real
// portion ("1 sandwich", "1 medium") alongside "100 g"-style rows; prefer the
// real portion, since that's what someone ordering it actually ate.
export function pickServing(servings) {
  const list = asArray(servings);
  return (
    list.find(s => s.is_default === '1' || s.is_default === 1) ||
    list.find(s => !METRIC_ONLY.has(String(s.measurement_description || '').toLowerCase())) ||
    list[0] ||
    null
  );
}

function round2(v) {
  return v == null ? 0 : Math.round(v * 100) / 100;
}

// Same nutrient keys the USDA path returns, so the recipe it builds matches.
// FatSecret has no magnesium/zinc/B12 — those stay 0, as missing USDA values did.
export function mapFoodDetail(data) {
  const food = data?.food || {};
  const s = pickServing(food.servings?.serving) || {};
  const metric = num(s.metric_serving_amount);
  return {
    name: food.food_name || '',
    brandName: food.brand_name || '',
    servingSize: metric != null ? `${round2(metric)}${s.metric_serving_unit || 'g'}` : '',
    servingDescription: s.serving_description || '',
    nutrients: {
      calories: round2(num(s.calories)),
      protein: round2(num(s.protein)),
      carbs: round2(num(s.carbohydrate)),
      fat: round2(num(s.fat)),
      saturatedFat: round2(num(s.saturated_fat)),
      sugar: round2(num(s.sugar)),
      fiber: round2(num(s.fiber)),
      sodium: round2(num(s.sodium)),
      potassium: round2(num(s.potassium)),
      calcium: round2(num(s.calcium)),
      iron: round2(num(s.iron)),
      magnesium: 0,
      zinc: 0,
      vitaminB12: 0,
      vitaminC: round2(num(s.vitamin_c)),
      cholesterol: round2(num(s.cholesterol)),
    },
  };
}

export async function searchFoods(query, maxResults = 20) {
  const url = `${SEARCH_URL}?search_expression=${encodeURIComponent(query)}&max_results=${maxResults}&format=json`;
  return mapSearchResults(await call(url));
}

export async function getFood(foodId) {
  const url = `${FOOD_URL}?food_id=${encodeURIComponent(foodId)}&format=json`;
  return mapFoodDetail(await call(url));
}
