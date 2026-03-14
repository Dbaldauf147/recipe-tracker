import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import SEASONAL_DATA from '../data/seasonalIngredients.js';

// In-memory cache to avoid repeated Firestore reads
const memCache = {};

/**
 * Load the cached seasonal lookups for a region from Firestore.
 * Returns an object of { ingredientName: [months] }.
 */
export async function loadSeasonalCache(region) {
  if (memCache[region]) return memCache[region];
  try {
    const snap = await getDoc(doc(db, 'seasonalCache', region));
    const data = snap.exists() ? snap.data() : {};
    memCache[region] = data;
    return data;
  } catch (err) {
    console.error('loadSeasonalCache:', err);
    return {};
  }
}

/**
 * Save seasonal data for ingredients to the Firestore cache.
 * Merges with existing data.
 */
async function saveToCache(region, newData) {
  try {
    if (!memCache[region]) memCache[region] = {};
    Object.assign(memCache[region], newData);
    await setDoc(doc(db, 'seasonalCache', region), newData, { merge: true });
  } catch (err) {
    console.error('saveToCache:', err);
  }
}

/**
 * Look up seasonal months for a list of ingredient names.
 * 1. Check static SEASONAL_DATA
 * 2. Check Firestore cache
 * 3. Call /api/seasonal-lookup for uncached ingredients
 * Returns { ingredientName: [months] } for all requested ingredients.
 */
export async function lookupSeasonalData(ingredientNames, region) {
  if (!region || !ingredientNames.length) return {};

  const staticData = SEASONAL_DATA[region] || {};
  const cache = await loadSeasonalCache(region);
  const result = {};
  const uncached = [];

  for (const name of ingredientNames) {
    const lower = name.toLowerCase().trim();
    if (!lower) continue;

    // Check static data first (exact or partial match)
    let found = false;
    for (const [staticName, months] of Object.entries(staticData)) {
      if (staticName === lower || lower.includes(staticName) || staticName.includes(lower)) {
        result[lower] = months;
        found = true;
        break;
      }
    }
    if (found) continue;

    // Check Firestore cache
    if (cache[lower] !== undefined) {
      result[lower] = cache[lower];
      continue;
    }

    uncached.push(lower);
  }

  // Batch lookup uncached ingredients via API
  if (uncached.length > 0) {
    try {
      const res = await fetch('/api/seasonal-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: uncached, region }),
      });
      if (res.ok) {
        const { data } = await res.json();
        // Merge results and save to cache
        const toCache = {};
        for (const name of uncached) {
          const months = data[name] || [];
          result[name] = months;
          toCache[name] = months;
        }
        await saveToCache(region, toCache);
      } else {
        // API failed — mark as empty so we don't retry
        for (const name of uncached) {
          result[name] = [];
        }
      }
    } catch (err) {
      console.error('seasonal lookup API error:', err);
      for (const name of uncached) {
        result[name] = [];
      }
    }
  }

  return result;
}
