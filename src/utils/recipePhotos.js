// Multi-photo recipe scans: several photos of ONE recipe (a cookbook spread,
// a card's front and back) go to /api/parse-recipe-image as `images`.
//
// Vercel rejects a request body over 4.5 MB before our function ever runs, so
// the photos are packed into as few requests as fit under a budget — usually
// one — and, only when they had to be split, the partial recipes are merged
// back into one here. Mirrored in the mobile app (src/utils/recipePhotos.ts).

export const MAX_RECIPE_PHOTOS = 8;
// Base64 characters per request. Leaves headroom under Vercel's 4.5 MB cap for
// the JSON wrapper.
export const PHOTO_BATCH_CHAR_BUDGET = 3_800_000;

/** Greedily groups base64 strings into batches under `budget` characters. A
 * single photo over budget still gets its own batch — the server is the one to
 * say it's too big. */
export function batchPhotos(photos, budget = PHOTO_BATCH_CHAR_BUDGET) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const p of photos) {
    const len = String(p).length;
    if (current.length > 0 && size + len > budget) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Merges the recipes read from consecutive batches, in page order: the first
 * non-empty title/servings/category wins, ingredients are concatenated without
 * repeating a line, and instruction steps are appended. */
export function mergeRecipeParts(parts) {
  const merged = { title: '', ingredients: [], instructions: '', servings: '', category: '' };
  const seen = new Set();
  const steps = [];
  for (const part of parts) {
    if (!part) continue;
    if (!merged.title && part.title) merged.title = part.title;
    if (!merged.servings && part.servings) merged.servings = part.servings;
    if (!merged.category && part.category) merged.category = part.category;
    for (const line of Array.isArray(part.ingredients) ? part.ingredients : []) {
      const key = String(line).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.ingredients.push(String(line).trim());
    }
    for (const step of String(part.instructions || '').split('\n')) {
      if (step.trim()) steps.push(step.trim());
    }
  }
  merged.instructions = steps.join('\n');
  return merged;
}

/** Reads one recipe from several photos. `post(images)` sends one batch and
 * resolves to the parsed recipe; it's injected so the web and tests share
 * this. */
export async function parseRecipePhotos(photos, post) {
  const batches = batchPhotos(photos);
  const parts = [];
  for (const batch of batches) parts.push(await post(batch));
  return parts.length === 1 ? parts[0] : mergeRecipeParts(parts);
}

/** Reads an image file as a JPEG data URL no larger than `maxDim` on its long
 * side. Screenshots and phone photos are routinely 3-10 MB, and eight of those
 * would never fit in one request. Falls back to the untouched file when the
 * browser can't decode it (e.g. HEIC outside Safari) — the server converts
 * HEIC itself. */
export async function imageFileToDataUrl(file, maxDim = 1800, quality = 0.85) {
  const raw = () => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return raw();
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return raw();
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    // Already small: keep the original bytes rather than re-encoding.
    if (scale === 1 && file.size <= 1_500_000) return raw();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    // JPEG has no alpha; paint white so transparent screenshots stay legible.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close?.();
  }
}
