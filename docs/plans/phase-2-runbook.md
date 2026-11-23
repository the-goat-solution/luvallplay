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

## 5. Phase 2 PR 4 + PR 6: one production data run (needs your sign-off)

**What runs:** three migrations in order, in one sitting:
1. **Mark production as at the baseline.** Additive: a `drizzle` schema with one table and one row. It runs only after re-checking that production's schema equals the frozen dump.
2. **`0001_account_fks_restrict` (PR 4).** The eight foreign keys to `players` become `ON DELETE RESTRICT`. Schema only, no rows change.
3. **`0002_business_config` (PR 6).** Two new tables, `pricing_plans` and `club_settings`, filled with the published Sanity values (5 plans with their Stripe price ids; capacity unset; booking lock 14 days). Additive.

The site doesn't depend on any of this to keep working. Until 0002 has run, it keeps reading pricing from Sanity; afterwards it reads from the database, with the same values.

**Already done (T−5, T−4), on fresh Neon branches of production:**
- PR 4 alone: **15 accounts, 0 problems**, drift empty, and a hard delete of an account with data is refused (in a rolled-back transaction).
- PR 4 + PR 6 together, exactly as below: **15 accounts, 0 problems** (two tables added), drift empty, and `verify-business-config`: **matches Sanity exactly**.
- Reports: `docs/rehearsals/`.

**Second sign-off (T−3):** Kelcee (or Timba) reads the two reports and says OK on PR #86.

**Production run (T0)**, at a quiet time, not a play-day evening. From a checkout of the PR 6 branch, after `npm ci`:

```bash
# 1. Restore point (instant): Neon console → Branches → New branch from main, now → name pre-phase-2-data
#    (or ask the build session to create it through the Neon API).

export POSTGRES_URL='<production direct connection string>'      # the SYD_POSTGRES_URL_NON_POOLING value
export PRODUCTION_DATABASE_HOSTS='<production host(s)>'           # the runner then refuses without --production

# 2. Snapshot, migrate, snapshot, diff, verify
npm run data-guard -- snapshot --out .data-guard/prod-before.json      # read-only
npm run db:migrate -- --baseline --production   # re-checks production = frozen dump, records the baseline
npm run db:migrate -- --production              # 0001 then 0002, each in one transaction (lock_timeout 3s)
npm run data-guard -- snapshot --out .data-guard/prod-after.json
npm run data-guard -- diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase2-business-config.production.json
npm run db:drift                                 # must say: No schema drift
node scripts/verify-business-config.mjs          # must say: matches Sanity exactly
```

**Done when:** the diff passes with 0 errors, drift is empty and the business config matches. Then merge PR 4 and PR 6 and deploy.

**If anything fails:** stop. Each migration is one transaction, so a failure leaves nothing half-done. Undoing a completed run is schema-only: swap the constraints back, or drop the two new tables. `pre-phase-2-data` holds the exact state from before.

**After the run:** edit prices and plans in **Admin → Money → Pricing & settings**, not in Sanity.

## 6. Phase 2 PR 5 (Next.js 16): nothing to do

After the deploy, smoke test: `/login`, sign in → Me, **`/admin` as an owner** (the admin check now runs in `proxy.ts`), `/studio` loads, and Arena works. Rollback: Vercel Instant Rollback.

## 7. Moving Sanity Studio out of the web app (needs you, once)

The build plan moves the Studio out of the web app into its own deploy (`apps/studio`). The club's Sanity project (`c0v5j4dz`) isn't in the Sanity account connected to the build session, so one step needs you. Pick one:

- **A (simplest):** on your computer, in a checkout of the branch that adds `apps/studio`, run `npx sanity login`, then `npx sanity deploy` from `apps/studio`, and choose the hostname `threewolves`. The Studio is then at `https://threewolves.sanity.studio` (Sanity handles CORS for its own hosts). Tell the build session it's done.
- **B:** Sanity → manage → project `c0v5j4dz` → API → Tokens → add a token with **Deploy Studio** permission, and save it when the build session asks for it (a secure form; you never paste it in chat). The session then deploys it.

Then `/studio` on the site redirects to the hosted Studio, and `next-sanity` and the npm `overrides` entry can leave the web app.
