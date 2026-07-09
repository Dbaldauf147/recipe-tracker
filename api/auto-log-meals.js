// GET /api/auto-log-meals — daily cron (declared in vercel.json crons).
//
// For each user who opted in (reminderSettings.autoLogMeals === true), on each
// of their scheduled weekdays (reminderSettings.autoLogDays, default Sun+Wed),
// appends a meal-history entry for every recipe currently in their weekly plan
// (i.e. the recipes on their shopping list). Two scheduled days per week ⇒ each
// weekly-plan recipe lands in the log twice a week.
//
// The cron runs once a day; the per-user autoLogDays gate decides which days
// actually log. Idempotent: entries are tagged { autoLogged: true } and a day
// that already holds an auto-logged entry is skipped, so a same-day re-run (or
// a reminderSettings save that wipes lastAutoLogDate) never double-logs.
//
// Storage mirrors the app: dailyLog lives at users/{uid}/data/dailyLog with a
// `log` map { [YYYY-MM-DD]: { entries: [...] } }; recipes at
// users/{uid}/data/recipes (`recipes` array); weeklyPlan on the main user doc.
//
// Auth: Vercel cron requests carry `Authorization: Bearer <CRON_SECRET>` when
// CRON_SECRET is set. Manual invocations need the same header or ?secret=...

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();

// Two scheduled days per week if the user hasn't customized them: Sun + Wed.
const DEFAULT_AUTO_LOG_DAYS = [0, 3];

// { dayOfWeek (0=Sun..6=Sat), dateKey 'YYYY-MM-DD' } in America/New_York, so the
// "today" we log under matches what the user sees in the app's Eastern clock.
function eastern(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { dayOfWeek: dow, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

// Mirror of DailyTrackerPage.categoryToSlot, minus the time-of-day branch (the
// cron has no meaningful "current hour"): lunch-dinner recipes log as dinner.
function categoryToSlot(category) {
  if (category === 'breakfast') return 'breakfast';
  if (category === 'lunch-dinner') return 'dinner';
  return 'snack';
}

// Scale a per-serving macro snapshot by a serving factor, rounding to 0.1.
// Only copies numeric keys so Firestore never sees an undefined value.
function scaleNutrition(perServing, factor) {
  const out = {};
  if (perServing && typeof perServing === 'object') {
    for (const [k, v] of Object.entries(perServing)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.round(v * factor * 10) / 10;
      }
    }
  }
  return out;
}

function makeId() {
  return `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const query = req.query?.secret;
    const ok = header === `Bearer ${secret}` || query === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }

  const { dayOfWeek, dateKey } = eastern();
  const summary = { scanned: 0, usersLogged: 0, entriesAdded: 0, skipped: 0, errors: [] };

  try {
    const snap = await db.collection('users').get();
    for (const docSnap of snap.docs) {
      summary.scanned++;
      const uid = docSnap.id;
      const data = docSnap.data() || {};
      const s = data.reminderSettings;

      // Opt-in only — never write into a user's history unless they enabled it.
      if (!s || !s.autoLogMeals) continue;
      const days = Array.isArray(s.autoLogDays) && s.autoLogDays.length > 0
        ? s.autoLogDays
        : DEFAULT_AUTO_LOG_DAYS;
      if (!days.includes(dayOfWeek)) continue;

      const weeklyPlan = Array.isArray(data.weeklyPlan) ? data.weeklyPlan : [];
      if (weeklyPlan.length === 0) continue;

      // Recipes live in their own subcollection doc.
      let recipes = [];
      try {
        const rSnap = await db.doc(`users/${uid}/data/recipes`).get();
        recipes = rSnap.exists ? (rSnap.data().recipes || []) : [];
      } catch { /* no recipes doc → nothing to log */ }
      const byId = new Map(recipes.map(r => [r.id, r]));

      // Daily log lives in its own subcollection doc to dodge the 1 MB user-doc cap.
      const logRef = db.doc(`users/${uid}/data/dailyLog`);
      let log = {};
      try {
        const lSnap = await logRef.get();
        log = lSnap.exists ? (lSnap.data().log || {}) : {};
      } catch { /* treat as empty */ }

      const day = log[dateKey] || { entries: [] };
      const entries = Array.isArray(day.entries) ? [...day.entries] : [];

      // Idempotency: today already auto-logged → leave it alone.
      if (entries.some(e => e && e.autoLogged)) { summary.skipped++; continue; }

      const ts = new Date().toISOString();
      let added = 0;
      for (const rid of weeklyPlan) {
        const recipe = byId.get(rid);
        if (!recipe) continue;
        const factor = 1; // one serving per scheduled day
        entries.push({
          id: makeId(),
          type: 'recipe',
          recipeId: rid,
          recipeName: recipe.title || '',
          servings: factor,
          mealSlot: categoryToSlot(recipe.category),
          timestamp: ts,
          nutrition: scaleNutrition(recipe.macrosPerServing, factor),
          autoLogged: true,
        });
        added++;
      }
      if (added === 0) continue;

      log[dateKey] = { ...day, entries };
      try {
        // merge:false matches the app's saveDailyLogToFirestore writer.
        await logRef.set({ log }, { merge: false });
        await docSnap.ref.update({ 'reminderSettings.lastAutoLogDate': dateKey });
        summary.usersLogged++;
        summary.entriesAdded += added;
      } catch (err) {
        summary.errors.push({ uid, err: err.message });
      }
    }
    return res.status(200).json({ ok: true, ...summary, dayOfWeek, dateKey });
  } catch (err) {
    console.error('auto-log-meals fatal:', err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}
