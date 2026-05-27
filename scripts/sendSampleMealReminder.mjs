// One-off: send the new meal-log reminder email (with next-4-days
// planned meals) to a chosen address. Pulls the real dailyLog from
// the matching user's Firestore doc.
//
// Usage from project root:
//   node scripts/sendSampleMealReminder.mjs --to=baldaufdan@gmail.com
//
// Reads GMAIL_USER, GMAIL_APP_PASSWORD, FIREBASE_SERVICE_ACCOUNT from
// .env.local (do `vercel env pull .env.local --environment=production`
// first if those are missing).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';
import { renderMealReminder } from '../lib/mealReminderEmail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function loadEnvLocal() {
  const path = resolve(PROJECT_ROOT, '.env.local');
  const text = readFileSync(path, 'utf8');
  // Vercel-pulled .env files quote every value and use backslash-escaped
  // newlines (\n, \r) inside the quotes. Be strict about that format so
  // we don't mis-parse a JSON value containing escape sequences.
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    let value = line.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    // GMAIL creds in Vercel ended up with a trailing newline — strip it for
    // simple scalar credentials. Don't trim FIREBASE_SERVICE_ACCOUNT (the
    // JSON body legitimately starts/ends with braces and shouldn't be touched).
    if (key === 'GMAIL_USER' || key === 'GMAIL_APP_PASSWORD' || key === 'CRON_SECRET') {
      value = value.trim();
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

// Mirror eastern() from api/send-meal-prompt.js so the dateKey lines up
// with what the cron uses on Vercel.
function easternDateKey(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function main() {
  loadEnvLocal();
  const { to } = parseArgs();
  if (!to) throw new Error('Missing --to=<email>');

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set in .env.local');
  }
  if (getApps().length === 0) {
    let sa = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_SERVICE_ACCOUNT.trim() && process.env.FIREBASE_SERVICE_ACCOUNT.trim() !== '""') {
      sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    } else {
      // Fall back to the most recently downloaded admin SDK key.
      const fallback = 'C:/Users/Dan Baldauf/Downloads/sunday-routine-firebase-adminsdk-fbsvc-a399556612.json';
      sa = JSON.parse(readFileSync(fallback, 'utf8'));
      console.log(`(using service account at ${fallback})`);
    }
    initializeApp({ credential: cert(sa) });
  }
  const db = getFirestore();

  const user = await getAuth().getUserByEmail(to);
  console.log(`Looked up uid=${user.uid} for ${to}`);
  const logSnap = await db.doc(`users/${user.uid}/data/dailyLog`).get();
  const log = logSnap.exists ? (logSnap.data().log || {}) : {};

  const dateKey = easternDateKey();
  const day = log[dateKey] || {};
  const mainMeals = (day.entries || []).filter(e => ['breakfast','lunch','dinner'].includes(e.mealSlot)).length;
  const skipped = (day.skippedMeals || []).length;
  const remaining = Math.max(1, 3 - mainMeals - skipped);

  const { subject, text, html } = renderMealReminder({ remaining, log, dateKey });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const from = `Prep Day <${process.env.GMAIL_USER}>`;
  const info = await transporter.sendMail({ from, to, subject, text, html });
  console.log('Sent:', info.messageId);
  console.log(`Subject: ${subject}`);
  console.log(`Today (${dateKey}): remaining=${remaining} mealsLogged=${mainMeals} skipped=${skipped}`);
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
