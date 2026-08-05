// Air fryer times and temperatures, by ingredient.
//
// A LOOKUP TABLE, not recipes: the question this answers is "I'm holding a
// thing — how hot, how long?", asked while standing at the counter. Everything
// here is per-ingredient and answerable in one glance.
//
// Times assume a PREHEATED basket-style fryer and a single, uncrowded layer.
// A stacked basket cooks slower and unevenly, which is why so many rows say
// shake — that note is the difference between these numbers working and not.
//
// Ranges are honest: fryers vary by several hundred watts and baskets vary in
// size, so a single number would be false precision. Start at the low end and
// add time; you can always cook it more. `doneF` is the internal temperature
// that actually settles the question for meat — trust it over the clock.

export const AIR_FRYER_CATEGORIES = [
  'Chicken',
  'Beef & Pork',
  'Seafood',
  'Vegetables',
  'Potatoes',
  'From frozen',
  'Eggs & extras',
];

/**
 * name    what you're holding
 * cat     one of AIR_FRYER_CATEGORIES
 * tempF   basket temperature
 * min/max minutes, the honest range
 * note    the one thing that makes it come out right
 * doneF   internal temperature when it's done (meat and fish only)
 */
const GUIDE = [
  // ── Chicken ────────────────────────────────────────────────────────────
  { name: 'Chicken breast (boneless)', cat: 'Chicken', tempF: 375, min: 18, max: 22, doneF: 165, note: 'Flip halfway. Thicker than an inch, drop to 360°F and go longer — the outside dries out before the middle is safe.' },
  { name: 'Chicken thighs (bone-in)', cat: 'Chicken', tempF: 400, min: 22, max: 26, doneF: 175, note: 'Skin up the whole time, never flip. Thighs are forgiving — 175°F is juicier than 165°F here.' },
  { name: 'Chicken thighs (boneless)', cat: 'Chicken', tempF: 400, min: 16, max: 20, doneF: 175, note: 'Flip halfway.' },
  { name: 'Chicken drumsticks', cat: 'Chicken', tempF: 400, min: 20, max: 24, doneF: 175, note: 'Turn every 8 minutes so all sides crisp.' },
  { name: 'Chicken wings', cat: 'Chicken', tempF: 400, min: 20, max: 24, doneF: 175, note: 'Pat bone dry first — wet skin steams instead of crisping. Shake every 8 minutes.' },
  { name: 'Chicken tenders (breaded)', cat: 'Chicken', tempF: 400, min: 10, max: 12, doneF: 165, note: 'Spray the breading or it stays powdery and pale.' },
  { name: 'Whole chicken (3–4 lb)', cat: 'Chicken', tempF: 350, min: 50, max: 60, doneF: 165, note: 'Breast down for the first 30 minutes, then flip. Measure the thigh, not the breast.' },
  { name: 'Ground chicken / turkey', cat: 'Chicken', tempF: 375, min: 10, max: 14, doneF: 165, note: 'Break it up and shake twice, or it fuses into one cake.' },

  // ── Beef & Pork ────────────────────────────────────────────────────────
  { name: 'Steak (1 inch)', cat: 'Beef & Pork', tempF: 400, min: 8, max: 12, doneF: 130, note: 'Flip halfway. 130°F is medium-rare; it climbs ~5°F while it rests. Rest it 5 minutes.' },
  { name: 'Burgers (¾ inch)', cat: 'Beef & Pork', tempF: 375, min: 8, max: 12, doneF: 160, note: 'Flip halfway. Dimple the middle so they don\'t dome.' },
  { name: 'Meatballs (1½ inch)', cat: 'Beef & Pork', tempF: 380, min: 10, max: 12, doneF: 160, note: 'Shake once. Space them or the sides never brown.' },
  { name: 'Pork chops (1 inch)', cat: 'Beef & Pork', tempF: 400, min: 12, max: 15, doneF: 145, note: 'Flip halfway. 145°F and a rest — pork past 155°F is dry.' },
  { name: 'Pork tenderloin', cat: 'Beef & Pork', tempF: 400, min: 18, max: 22, doneF: 145, note: 'Turn every 7 minutes. Rest 5 minutes before slicing.' },
  { name: 'Bacon', cat: 'Beef & Pork', tempF: 350, min: 8, max: 10, note: 'Single layer, no overlap. Lower temp on purpose — 400°F sets off the smoke alarm as the fat renders.' },
  { name: 'Sausages (raw)', cat: 'Beef & Pork', tempF: 380, min: 12, max: 15, doneF: 160, note: 'Turn halfway. Don\'t prick them.' },
  { name: 'Hot dogs', cat: 'Beef & Pork', tempF: 380, min: 5, max: 7, note: 'Score them if you want the split-open look.' },
  { name: 'Lamb chops', cat: 'Beef & Pork', tempF: 400, min: 8, max: 12, doneF: 135, note: 'Flip halfway. Rest 5 minutes.' },

  // ── Seafood ────────────────────────────────────────────────────────────
  { name: 'Salmon fillet (6 oz)', cat: 'Seafood', tempF: 400, min: 8, max: 11, doneF: 125, note: 'Skin down, no flip. 125°F is still translucent in the middle, which is where salmon is best.' },
  { name: 'Cod / white fish', cat: 'Seafood', tempF: 380, min: 10, max: 12, doneF: 140, note: 'No flip — it falls apart. Done when it flakes.' },
  { name: 'Tuna steak', cat: 'Seafood', tempF: 400, min: 6, max: 8, doneF: 125, note: 'Flip halfway, and err short — this one goes from rare to chalky fast.' },
  { name: 'Shrimp (large, raw)', cat: 'Seafood', tempF: 400, min: 6, max: 8, note: 'Shake once. Pull them the moment they curl into a C — an O means overcooked.' },
  { name: 'Scallops', cat: 'Seafood', tempF: 400, min: 6, max: 8, note: 'Bone dry and spaced apart, or they steam grey instead of searing.' },
  { name: 'Salmon burgers', cat: 'Seafood', tempF: 390, min: 10, max: 12, note: 'Flip halfway.' },

  // ── Vegetables ─────────────────────────────────────────────────────────
  { name: 'Broccoli florets', cat: 'Vegetables', tempF: 375, min: 8, max: 10, note: 'Shake once. A splash of water in the drawer keeps the tips from burning before the stems soften.' },
  { name: 'Brussels sprouts (halved)', cat: 'Vegetables', tempF: 375, min: 12, max: 15, note: 'Cut side down to start, then shake. The loose outer leaves will char — that\'s the good part.' },
  { name: 'Cauliflower florets', cat: 'Vegetables', tempF: 400, min: 12, max: 15, note: 'Shake twice.' },
  { name: 'Asparagus', cat: 'Vegetables', tempF: 400, min: 7, max: 9, note: 'Single layer. Thin spears, check at 5 minutes.' },
  { name: 'Green beans', cat: 'Vegetables', tempF: 375, min: 8, max: 10, note: 'Shake once.' },
  { name: 'Carrots (½ inch)', cat: 'Vegetables', tempF: 380, min: 12, max: 16, note: 'Shake twice. Cut them evenly or the thin ones burn.' },
  { name: 'Zucchini (½ inch)', cat: 'Vegetables', tempF: 400, min: 10, max: 12, note: 'Salt AFTER cooking — salting first pulls out water and you get soggy zucchini.' },
  { name: 'Bell peppers', cat: 'Vegetables', tempF: 400, min: 8, max: 10, note: 'Shake once.' },
  { name: 'Mushrooms', cat: 'Vegetables', tempF: 380, min: 8, max: 10, note: 'Shake once. They release water first, then brown — don\'t pull them at the wet stage.' },
  { name: 'Onions (wedges)', cat: 'Vegetables', tempF: 375, min: 10, max: 12, note: 'Shake once.' },
  { name: 'Cherry tomatoes', cat: 'Vegetables', tempF: 400, min: 8, max: 10, note: 'They burst — that\'s intended. Line the basket if you don\'t want to scrub it.' },
  { name: 'Eggplant (½ inch)', cat: 'Vegetables', tempF: 375, min: 12, max: 15, note: 'Oil it properly. Eggplant is a sponge and drinks the first coat.' },
  { name: 'Cabbage wedges', cat: 'Vegetables', tempF: 375, min: 12, max: 15, note: 'Flip halfway.' },
  { name: 'Butternut squash (cubed)', cat: 'Vegetables', tempF: 400, min: 15, max: 20, note: 'Shake twice.' },
  { name: 'Corn on the cob', cat: 'Vegetables', tempF: 400, min: 10, max: 14, note: 'Turn every 5 minutes.' },
  { name: 'Kale chips', cat: 'Vegetables', tempF: 300, min: 4, max: 6, note: 'Low and short. Weigh them down or they fly into the element.' },
  { name: 'Tofu (cubed, pressed)', cat: 'Vegetables', tempF: 400, min: 12, max: 15, note: 'Press it 20 minutes first. Cornstarch in the toss is what makes the crust.' },
  { name: 'Chickpeas (canned)', cat: 'Vegetables', tempF: 390, min: 12, max: 15, note: 'Dry them completely, shake twice. They crisp as they cool, not in the basket.' },

  // ── Potatoes ───────────────────────────────────────────────────────────
  { name: 'Baby potatoes (halved)', cat: 'Potatoes', tempF: 400, min: 15, max: 20, note: 'Shake twice.' },
  { name: 'Potato wedges (fresh)', cat: 'Potatoes', tempF: 400, min: 18, max: 22, note: 'Shake twice.' },
  { name: 'Fries, homemade (¼ inch)', cat: 'Potatoes', tempF: 380, min: 15, max: 18, note: 'Soak the cut potatoes 30 minutes and dry them — that soak is the whole difference between fries and sad sticks.' },
  { name: 'Sweet potato (cubed)', cat: 'Potatoes', tempF: 400, min: 15, max: 18, note: 'Shake twice. Burns faster than white potato — sugar.' },
  { name: 'Baked potato (whole)', cat: 'Potatoes', tempF: 400, min: 35, max: 45, note: 'Pierce it, oil and salt the skin, turn once.' },
  { name: 'Hash browns (fresh, shredded)', cat: 'Potatoes', tempF: 380, min: 12, max: 15, note: 'Squeeze the water out. Press into a flat cake and flip once.' },

  // ── From frozen ────────────────────────────────────────────────────────
  { name: 'French fries (frozen)', cat: 'From frozen', tempF: 400, min: 15, max: 18, note: 'Straight from the freezer, no thawing, no oil. Shake twice.' },
  { name: 'Tater tots (frozen)', cat: 'From frozen', tempF: 400, min: 12, max: 15, note: 'Shake twice.' },
  { name: 'Onion rings (frozen)', cat: 'From frozen', tempF: 400, min: 8, max: 10, note: 'Single layer.' },
  { name: 'Chicken nuggets (frozen)', cat: 'From frozen', tempF: 400, min: 8, max: 10, note: 'Shake once.' },
  { name: 'Mozzarella sticks (frozen)', cat: 'From frozen', tempF: 380, min: 6, max: 8, note: 'Watch them — a minute long and the cheese is out on the basket floor.' },
  { name: 'Fish sticks (frozen)', cat: 'From frozen', tempF: 400, min: 9, max: 11, note: 'Flip halfway.' },
  { name: 'Breaded fish fillets (frozen)', cat: 'From frozen', tempF: 400, min: 12, max: 14, note: 'Flip halfway.' },
  { name: 'Breaded shrimp (frozen)', cat: 'From frozen', tempF: 400, min: 10, max: 12, note: 'Shake once.' },
  { name: 'Spring rolls / egg rolls (frozen)', cat: 'From frozen', tempF: 390, min: 10, max: 12, note: 'Turn halfway. Spray them.' },
  { name: 'Dumplings / potstickers (frozen)', cat: 'From frozen', tempF: 380, min: 10, max: 12, note: 'Spray well and shake once, or the wrappers dry out leathery.' },
  { name: 'Pizza rolls (frozen)', cat: 'From frozen', tempF: 380, min: 6, max: 8, note: 'Shake once. They leak if you push past 8 minutes.' },
  { name: 'Burrito (frozen)', cat: 'From frozen', tempF: 380, min: 12, max: 15, note: 'Turn halfway. Wrap in foil for the first half if the ends brown too fast.' },
  { name: 'Veggie burger (frozen)', cat: 'From frozen', tempF: 380, min: 10, max: 12, note: 'Flip halfway.' },
  { name: 'Frozen vegetables', cat: 'From frozen', tempF: 400, min: 10, max: 14, note: 'No thawing — thawed veg steams. Shake twice.' },

  // ── Eggs & extras ──────────────────────────────────────────────────────
  { name: 'Hard "boiled" eggs', cat: 'Eggs & extras', tempF: 270, min: 15, max: 17, note: 'Straight on the rack, no water. Ice bath immediately or they keep cooking. 13 minutes for jammy.' },
  { name: 'Reheat pizza', cat: 'Eggs & extras', tempF: 350, min: 3, max: 5, note: 'The single best use of an air fryer. Crust comes back crisp, which a microwave can never do.' },
  { name: 'Garlic bread', cat: 'Eggs & extras', tempF: 350, min: 4, max: 6, note: 'Watch it from minute 3.' },
  { name: 'Toast', cat: 'Eggs & extras', tempF: 400, min: 3, max: 4, note: 'Weigh the bread down with a rack or it lifts into the element.' },
  { name: 'Bacon-wrapped anything', cat: 'Eggs & extras', tempF: 375, min: 12, max: 15, note: 'Seam side down first so it doesn\'t unwrap.' },
  { name: 'Reheat fried chicken', cat: 'Eggs & extras', tempF: 350, min: 5, max: 8, note: 'Better than new. No oil needed.' },
  { name: 'Nuts (toasting)', cat: 'Eggs & extras', tempF: 320, min: 4, max: 6, note: 'Shake every 2 minutes. They go from toasted to burnt in about 30 seconds.' },
];

/** The rules that apply to everything, shown once at the top of the page. */
export const AIR_FRYER_RULES = [
  'Preheat 3 minutes. Every time in this table assumes a hot basket.',
  'One layer, with gaps. A crowded basket steams — that\'s the difference between crisp and pale.',
  'Shake or flip at the halfway mark unless the note says not to.',
  'A light spray of oil on anything breaded. Dry breading stays powdery and white.',
  'Cooking from frozen? Add 2–3 minutes and don\'t thaw first.',
  'Meat is done at the internal temperature, not the clock. The times are a guide to when to start checking.',
];

/** Stable key for matching a user override to a built-in row. */
export function airFryerKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** °F → °C, rounded to the nearest 5 — the granularity a dial actually has. */
export function toCelsius(f) {
  return Math.round(((f - 32) * 5 / 9) / 5) * 5;
}

export default GUIDE;
