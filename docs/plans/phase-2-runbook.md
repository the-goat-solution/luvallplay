# Phase 2 runbook: the steps that need you

The code for each Phase 2 pull request is built and tested in its PR. These steps need dashboard access or a production decision. Each says what "done" looks like.

---

## 1. Make Vercel previews work again (any time, the sooner the better)

**What's wrong:** every preview fails in about a second with "Resource provisioning failed". The project's Neon integration still makes a database branch per preview in the **old US Neon project** (`neon-almond-button`, project id `cold-mud-10922679`). That project already has 10 branches (main + 9 old `preview/claude/*` branches from 16–19 Nov), and 10 is the Neon free plan's limit, so the branch for each new preview can't be created. Production deploys don't need a branch, so they still work.

**Fix (pick A, recommended, or B):**

A. **Stop using the old US databases for previews, and give previews Sydney branches.**
   1. Vercel → Project `three-wolves-badminton` → **Storage**. For each Neon database that is **not** the Sydney one (`three-wolves-sydney`, env prefix `SYD_`): open it → **Projects** → disconnect `three-wolves-badminton`, or turn off "Create database branch for deployment → Preview". The site uses only the `SYD_` database (`DATABASE_URL_VAR=SYD_POSTGRES_URL`).
   2. Open the Sydney database → **Settings** → turn on **"Create a database branch for each preview deployment"** (Preview only, never Production).
   3. Neon console → project `neon-almond-button` → **Branches**: delete the nine `preview/claude/…` branches (they belong to old, finished pull requests).

B. Only do step A.3 (delete the 9 stale branches). Previews build again, but each still takes a branch in the old US project and hits the limit again after ~9 more previews.

**Done when:** the next push to a pull request branch gets a green Vercel preview. `/api/health/db` on that preview either shows its own branch (A) or says `Database switched off on this preview` (the guard refusing a production database, which is safe).

`PRODUCTION_DATABASE_HOSTS` is already set correctly (it lists every production and old host), so a preview can never use the Sydney production database.

## 2. Phase 2 PR 1 (Drizzle schema + baseline migration): nothing to do

PR 1 changes no runtime behaviour: the app still uses `@vercel/postgres` and `ensureTables()`. Merge when CI is green.

Once, before the first real migration runs on production (PR 4), production is marked as "already at the baseline". That's an additive change: it creates a `drizzle` schema with one table and one row, and nothing in `public` changes. It's folded into PR 4's production run (§4 below), so there's no separate step.

## 3. Phase 2 PR 2 (driver swap): nothing to do

The app now talks to Neon through `@neondatabase/serverless` (`lib/database.ts`) instead of `@vercel/postgres`. It uses the same environment variables (`POSTGRES_URL`, chosen by `DATABASE_URL_VAR`), and there are no schema or data changes. After the deploy, check that `/api/health/db` answers (round trips in milliseconds) and that sign-in, Me and Arena load.

Rollback: Vercel → Deployments → previous production deployment → **Instant Rollback**. Nothing in the database changed.
