#!/usr/bin/env node
/**
 * One-shot: write the admin-migration default keyIngredients list onto a
 * user's main doc. Used to restore healthy-ingredient selections after a
 * UID migration where the original main doc was wiped (so the data couldn't
 * be transferred via the subcollection migration script).
 *
 * The list mirrors the hardcoded migration in App.jsx:274-291.
 *
 * Usage:
 *   node scripts/setKeyIngredients.mjs --uid=<uid> --key=<service-account.json> [--dryRun]
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const INGREDIENTS = [
  'eggplant', 'seaweed', 'beets_pickled', 'alfalfa sprouts', 'olive(s)_pitted black',
  'asparagus', 'oregano_dried', 'orange(s)', 'chickpeas/garbanzo beans', 'shiitake mushrooms',
  'zucchini', 'green peas', 'red cabbage', 'green beans', 'collard greens', 'thyme_dried',
  'cauliflower', 'carrots_baby', 'hemp seeds', 'tumeric', 'brussel sprouts', 'lime(s)',
  'lentils_green', 'broccoli', 'lemon juice', 'ginger root', 'banana(s)', 'apple(s)_honey crisp',
  'cacao', 'rasberries', 'sweet potato(s)', 'bell pepper(s)', 'spinach', 'black beans', 'kale',
  'avocado(s)', 'blackberry(s)', 'blueberries', 'garlic', 'chia seeds', 'flaxseed meal',
  'tomato', 'cinnamon',
];

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--uid=')) args.uid = a.slice('--uid='.length);
    else if (a.startsWith('--key=')) args.key = a.slice('--key='.length);
    else if (a === '--dryRun' || a === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.uid || !args.key) {
    console.error('Usage: node scripts/setKeyIngredients.mjs --uid=<uid> --key=<service-account.json> [--dryRun]');
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(args.key, 'utf8'));
  initializeApp({ credential: cert(credentials) });
  const db = getFirestore();

  const ref = db.doc(`users/${args.uid}`);
  const snap = await ref.get();
  const currentCount = (snap.data()?.keyIngredients || []).length;

  console.log(`Target: users/${args.uid}`);
  console.log(`  Current keyIngredients count: ${currentCount}`);
  console.log(`  About to write: ${INGREDIENTS.length} ingredients`);
  console.log(`  Mode: ${args.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);

  if (args.dryRun) {
    console.log('\n✓ Dry run complete — no data changed.');
    return;
  }

  await ref.set({ keyIngredients: INGREDIENTS }, { merge: true });
  console.log('\n✓ keyIngredients written.');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
