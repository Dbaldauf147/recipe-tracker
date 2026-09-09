# Recipe Tracker — working notes

## Git workflow

**Every requested change ships as its own PR.** For each user request that produces code changes:

1. Create a fresh feature branch off the latest `master`. Use `claude/<short-kebab-slug>` for the name — pick a slug that describes the change (e.g. `claude/recipe-import-retry`, `claude/meal-prompt-time`).
2. Commit on that branch and push it with `git push -u origin <branch>`.
3. Open the PR. Prefer the GitHub API (`mcp__github__create_pull_request`) when it's available; if it fails, fall back to printing the compare URL: `https://github.com/Dbaldauf147/recipe-tracker/pull/new/<branch>`.
4. **Merge it yourself** (`mcp__github__merge_pull_request`) once the work is verified — the user asked for this rather than being handed a link each time. Report the merge commit instead. Verification doesn't get lighter for being faster: see below for what it means here. If CI is red, the branch conflicts, or the change turns out riskier than it looked, fix that first rather than merging and explaining afterwards. Still stop and ask on anything destructive or genuinely ambiguous.
5. Don't push directly to `master`. Everything lands through a PR.

Branches stay one-PR-per-change so each fix can be reviewed and merged independently — don't pile unrelated changes onto a previous branch.

## Verifying before you merge

`.github/workflows/ci.yml` runs on every PR and is the floor, not the ceiling: it installs, runs `npm run build` and `npm test`, and checks each `api/` entry point imports cleanly. Run the same three locally before you push, plus lint:

    npm run build     # vite build — a broken import fails here and nowhere earlier
    npm test          # node --test over src/**/*.test.js
    npm run lint      # eslint .

Then **check the actual behaviour**. Chromium and Playwright are available: serve the built app or the dev server, drive the page, and assert on what you changed. Watching `pageerror` while you do is worth as much as the assertion — this app catches a lot internally, and a broken panel can look merely empty.

An `api/` route can't be exercised by the static server; when you change one, at minimum import it in Node to prove it loads, and read the request/response shape against its caller rather than assuming.

## Deploys

Vercel builds `master` on every merge and ships the static site, the `api/` functions and the crons in `vercel.json`. So a merged PR is live within a couple of minutes — which is exactly why the verification above happens before the merge, not after.

**Two things that build does not ship**, both of which fail silently and late:

- `firestore.rules` — released with `firebase deploy --only firestore:rules`. A rule written and not published looks, on a fresh load, like a user with no data rather than a permission error.
- the `functions/` codebase — `firebase deploy --only functions`.

If either becomes a regular chore, hang it off a `prebuild` script that runs only when `VERCEL_ENV === "production"` and never fails the build: log loudly and carry on, because shipping with a stale side-artefact beats not shipping at all.
