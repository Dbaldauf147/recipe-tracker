#!/usr/bin/env node
/**
 * Fill missing ingredients/instructions on a user's recipes from the master Google Sheet.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS="C:/path/to/service-account.json" \
 *   node scripts/fillRecipeGaps.mjs --email=baldaufdan@gmail.com [--apply]
 *
 * Without --apply, runs in dry-run mode and prints the diff only.
 * With --apply, writes the filled recipes back to users/{uid}/data/recipes.
 *
 * Only fills fields that are currently empty on the user's recipe. Existing
 * ingredients and instructions are never overwritten.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { fetchRecipesFromSheet } from '../src/utils/sheetRecipes.js';

function parseArgs(argv) {
  const args = { apply: false };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--email=')) args.email = a.slice('--email='.length);
    else if (a.startsWith('--key=')) args.key = a.slice('--key='.length);
  }
  return args;
}

// Vocabulary used for recipe category tags. If every comma-separated chunk
// in the instructions field comes from this set, treat the field as "missing"
// — a past import bug stashed category tags in the instructions column.
const TAG_WORDS = new Set([
  'breakfast', 'lunch', 'dinner', 'lunch/dinner', 'drink', 'drinks',
  'desert', 'dessert', 'snack', 'snacks',
  'regular', 'special', 'retired', 'common', 'rare',
  'meat', 'pescatarian', 'vegan', 'vegetarian',
  'healthy', 'workout', 'unhealthy', 'low protein',
  '-', '',
]);

function looksLikeTagsOnly(text) {
  const s = (text || '').trim();
  if (!s) return true;
  // Split on commas, dashes, and newlines; check every chunk against the tag vocab
  const chunks = s
    .split(/[,\n-]/)
    .map(c => c.trim().toLowerCase())
    .filter(c => c.length > 0);
  if (chunks.length === 0) return true;
  return chunks.every(c => TAG_WORDS.has(c));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.email) {
    console.error('Usage: node scripts/fillRecipeGaps.mjs --email=<email> [--apply] [--key=<path>]');
    process.exit(1);
  }

  const keyPath = args.key || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('Missing service account key. Pass --key=<path> or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(keyPath, 'utf8'));
  initializeApp({ credential: cert(credentials) });
  const auth = getAuth();
  const db = getFirestore();

  console.log(`→ Looking up uid for ${args.email}...`);
  const userRecord = await auth.getUserByEmail(args.email);
  const uid = userRecord.uid;
  console.log(`  uid: ${uid}`);

  console.log('→ Fetching recipes from sheet...');
  const sheetRecipes = await fetchRecipesFromSheet();
  console.log(`  sheet has ${sheetRecipes.length} recipes`);

  console.log("→ Loading user's recipes from Firestore...");
  const recipesRef = db.doc(`users/${uid}/data/recipes`);
  const snap = await recipesRef.get();
  const existing = (snap.exists ? snap.data().recipes : null) || [];
  console.log(`  account has ${existing.length} recipes`);

  const byTitle = new Map(
    sheetRecipes.map(r => [r.title.toLowerCase().trim(), r])
  );

  const updates = [];
  const updatedRecipes = existing.map(r => {
    const sheet = byTitle.get((r.title || '').toLowerCase().trim());
    if (!sheet) return r;
    // Policy: only fill instructions (skip ingredients), and treat tag-only
    // instruction strings as missing.
    const instructionsMissing = looksLikeTagsOnly(r.instructions);
    if (!instructionsMissing || !sheet.instructions) return r;
    updates.push({
      title: r.title,
      filledFields: ['instructions'],
      oldPreview: (r.instructions || '').slice(0, 60),
    });
    return { ...r, instructions: sheet.instructions };
  });

  const matchedTitles = new Set(
    existing.map(r => (r.title || '').toLowerCase().trim())
  );
  const unmatchedSheet = sheetRecipes.filter(
    r => !matchedTitles.has(r.title.toLowerCase().trim())
  );

  console.log('');
  console.log(`Would update ${updates.length} recipe(s):`);
  for (const u of updates) {
    const old = u.oldPreview ? ` (replacing: "${u.oldPreview}${u.oldPreview.length >= 60 ? '...' : ''}")` : '';
    console.log(`  • ${u.title} — filling: ${u.filledFields.join(', ')}${old}`);
  }

  if (unmatchedSheet.length > 0) {
    console.log('');
    console.log(`${unmatchedSheet.length} sheet recipe(s) not in the account (skipped, review only):`);
    for (const r of unmatchedSheet) {
      console.log(`  • ${r.title}`);
    }
  }

  if (!args.apply) {
    console.log('');
    console.log('Dry run. Re-run with --apply to write changes.');
    return;
  }

  if (updates.length === 0) {
    console.log('');
    console.log('Nothing to apply.');
    return;
  }

  console.log('');
  console.log('→ Writing back to Firestore...');
  await recipesRef.set({ recipes: updatedRecipes });
  console.log(`✓ Updated ${updates.length} recipe(s).`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
