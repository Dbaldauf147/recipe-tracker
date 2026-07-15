---
name: verify
description: Run the Prep Day web app locally and drive a real flow in a browser to verify a change end-to-end.
---

# Verifying changes in the Prep Day web app

Vite + React. `npm run dev`. **Check the port** — 5173 is often taken by
another project on this machine, and Vite silently falls back to 5174:

```bash
netstat -ano | grep LISTENING | grep -E ":517[0-9]"
```

## Getting in without touching production data

The app is behind Firebase auth against **production Firestore** — there is
no emulator. Do not sign in to drive a test; you'd write into real user data.

Use **guest mode** instead: the login page has a "Continue without signing in"
button (→ warning modal → "Continue anyway"). Guest leaves `user` falsy, and
`saveDailyLog(log, user)` only writes to Firestore `if (user)` — so guest runs
are localStorage-only and safe.

Two gotchas:
- `continueAsGuest()` hardcodes `setOnboardingSteps(['recipe-setup'])`, so every
  guest entry is forced through onboarding. Fastest way out:
  "Don't have any yet" → "Continue" → "Continue to Homepage".
- `isGuest` is React state, not persisted. **Every page reload drops you back to
  the login page** and you must re-run the whole guest + onboarding dance.

## Seeding data

Seed localStorage after the first `goto` and before the app boots its state,
then reload. Keys:

| Data | Key |
|---|---|
| Recipes | `recipe-tracker-recipes` (legacy name — repo was `recipe-tracker`) |
| This Week's Menu | `sunday-weekly-plan` |
| Meal log | `sunday-daily-log` |
| Week meal plan | `sunday-week-meal-plan` |

Onboarding does not wipe seeded recipes.

## Driving

No Playwright in this repo — don't add it. Install `playwright-core` in a
scratch dir and point `executablePath` at the system Chrome
(`C:\Program Files\Google\Chrome\Application\chrome.exe`). HTML5 drag-and-drop
works with Playwright's `locator.dragTo()`.

Sidebar nav items render as `<button>` with a Material icon ligature in the
text, so the accessible name is e.g. `calendar_monthWeek Plan` —
`getByText('Week Plan', { exact: true })` will NOT match. Use
`getByRole('button', { name: /Week Plan/ })`.

## Week Plan page

`WeekPlanPage.jsx` is a thin wrapper; the real UI is `DailyTrackerPage.jsx`
rendered with `prepareOnly` (the `WeeklyView` component, `mode === 'prepare'`).
The Prepare grid is 4 slot rows × 7 days = 28 `weeklyGridCell` elements in DOM
order (breakfast, lunch, dinner, snack), so `cellIndex = slotIdx * 7 + dayIdx`.

## Verifying an `api/` cron endpoint

You cannot run these against real Firestore locally: `FIREBASE_SERVICE_ACCOUNT`
and `CRON_SECRET` are **sensitive** in Vercel, so `vercel env pull` writes them
to `.env.local` as `""`. There is no service-account key or gcloud ADC on the
machine, and the Firestore emulator needs Java, which isn't installed.
`vercel dev` also does not appear to load `.env.local` for these.

What works: serve the real handler over HTTP with firebase-admin stubbed via an
ESM loader hook, so all handler logic runs against seeded data.

```js
// hooks.mjs — map both admin subpaths to one stub module
export async function resolve(spec, ctx, next) {
  if (spec === 'firebase-admin/app' || spec === 'firebase-admin/firestore')
    return { url: STUB, shortCircuit: true };
  return next(spec, ctx);
}
// register.mjs: register(new URL('./hooks.mjs', import.meta.url))
// run: SEED_FILE=seed.json node --import ./register.mjs harness.mjs
```

The harness shims the bits of the Vercel req/res surface the handler uses
(`req.query`, `res.status().json()`). Stub the exact Firestore calls the handler
makes — `collection('users').get()`, `collection('users/{uid}/workouts').where().get()`,
`doc('users/{uid}/data/dailyLog').get()` (field `log`), `doc('users/{uid}/data/recipes').get()`.

Always drive `?dryRun=1` first — `sync-workout-calendar` returns before any
Google write on that path. Without it you will create real events on the user's
real calendar.

## Expected noise (not your bug)

Guest mode logs `Firestore loadUserData: Missing or insufficient permissions`
repeatedly, plus a 404 + `AI meals error` from `/api/` routes that the Vite dev
server doesn't serve. Harmless.
