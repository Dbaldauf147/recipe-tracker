#!/usr/bin/env node
/**
 * Quick inspection: print a summary of each recipe's title, instruction length, and first 60 chars.
 * Usage: node scripts/inspectRecipes.mjs --email=<email> --key=<path>
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--email=')) args.email = a.slice('--email='.length);
    else if (a.startsWith('--key=')) args.key = a.slice('--key='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const credentials = JSON.parse(readFileSync(args.key, 'utf8'));
  initializeApp({ credential: cert(credentials) });
  const uid = (await getAuth().getUserByEmail(args.email)).uid;
  const snap = await getFirestore().doc(`users/${uid}/data/recipes`).get();
  const recipes = snap.data()?.recipes || [];

  const counts = { empty: 0, short: 0, medium: 0, long: 0 };
  for (const r of recipes) {
    const ins = (r.instructions || '').trim();
    const len = ins.length;
    if (len === 0) counts.empty++;
    else if (len < 30) counts.short++;
    else if (len < 200) counts.medium++;
    else counts.long++;
  }

  console.log(`Total recipes: ${recipes.length}`);
  console.log(`Instruction length: empty=${counts.empty}, <30chars=${counts.short}, <200chars=${counts.medium}, >=200chars=${counts.long}`);
  console.log('');
  console.log('Samples (title — length — preview):');
  for (const r of recipes.slice(0, 30)) {
    const ins = (r.instructions || '').replace(/\n/g, ' \\n ').slice(0, 80);
    console.log(`  ${String((r.instructions || '').length).padStart(4)} ${r.title}: ${ins}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
