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

## 4. Phase 2 PR 3 (no request-time DDL): nothing to do before merging

Production already has every table, because the baseline migration is production's schema, so nothing has to run first. After the deploy:
- `/admin/setup` → "Database schema" shows **warn: no migration history yet** until production is marked as at the baseline (folded into PR 4's run, §5). That's expected.
- Smoke test: sign in, Me, Arena, `/admin/play-days`, the shop, casual play.

Rollback: Vercel Instant Rollback. The previous version still creates tables only if they're missing, and they all exist.

## 5. Phase 2 PR 4: account foreign keys CASCADE / SET NULL → RESTRICT (production data change)

**What:** the eight foreign keys from account-owned tables (sessions, photos, messages, events, API keys, webhooks, shop orders, cancellation feedback) to `players` change to `ON DELETE RESTRICT`. Schema only, no rows change. In the same run, production is marked as at the baseline migration (additive: a `drizzle` schema with one table and one row).

**Already done (T−5, T−4):** rehearsal on a fresh Neon branch of production (`rehearsal-phase-2`, reset from production at 02:30 UTC on 23 Nov):
- `data-guard rehearse`: **15 accounts checked, 0 problems** (report in the PR);
- drift afterwards empty;
- a hard delete of an account with data is now refused (checked in a rolled-back transaction).

**Second sign-off (T−3):** Kelcee (or Timba) reads the PR's rehearsal report and says OK on the PR.

**Production run (T0), at a quiet time, not a play-day evening.** From a checkout of the PR branch, after `npm ci`:

```bash
# 1. Restore point (instant): Neon console → Branches → New branch from main, now → name pre-phase-2-pr4
#    (or ask the build session to create it through the Neon API).

export POSTGRES_URL='<production direct connection string>'      # SYD_POSTGRES_URL_NON_POOLING
export PRODUCTION_DATABASE_HOSTS='<production host(s)>'           # the runner refuses without --production

# 2. Snapshot, migrate, snapshot, diff
npm run data-guard -- snapshot --out .data-guard/pr4-before.json                  # read-only
npm run db:migrate -- --baseline --production    # checks production's schema = the frozen dump, then records the baseline
npm run db:migrate -- --production               # applies 0001_account_fks_restrict (one transaction, lock_timeout 3s)
npm run data-guard -- snapshot --out .data-guard/pr4-after.json
npm run data-guard -- diff .data-guard/pr4-before.json .data-guard/pr4-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase2-account-fks-restrict.production.json
npm run db:drift                                 # must say: No schema drift
```

**Done when:** the diff passes with 0 errors and the drift check is empty. Then merge PR 4 (the code doesn't depend on the new constraints, so the order doesn't matter for the app).

**If anything fails:** stop. The migration runs in one transaction, so a failure leaves nothing half-done. To undo a completed run, swap the constraints back. That's a schema-only change and no data is involved. `pre-phase-2-pr4` holds the exact state from before.

## 6. Phase 2 PR 5 (Next.js 16): nothing to do

After the deploy, smoke test: `/login`, sign in → Me, **`/admin` as an owner** (the admin check now runs in `proxy.ts`), `/studio` loads, and Arena works. Rollback: Vercel Instant Rollback.
