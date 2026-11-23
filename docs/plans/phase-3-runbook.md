# Phase 3 runbook: the steps that need you

Phase 3 (multi-tenant core, build plan §6) ships as twelve small steps. The code for each is built and tested in its pull request. This file lists what needs your decision or sign-off, and records every data-guard result. Each step says what "done" looks like.

---

## Status (23 Nov 2026)

| Step | What | State |
|---|---|---|
| 0 | Plan documents to `main` (#100, docs only) | Done: merged 23 Nov |
| 1 | Tenants schema, Three Wolves as club #1 (#101) | **Done.** Production data run passed (23 Nov, 07:36 UTC); merged and live (07:48 UTC) |
| 2 | `tenant_id` on every club-owned table (#102) | **Done.** Production data run passed (23 Nov, 08:25 UTC); live (08:28 UTC) |
| 3 | Email links → `user_id` (#103) | **Production data run done and passed** (23 Nov, 09:09 UTC). Merged 09:11 UTC |
| 4 | Settings replace constants (behind flags) | In progress. First part built: the settings loader and the shadow comparison (§4) |
| 5 | Module enforcement | Not started |
| 6 | Second database driver, region routing | Not started |
| 7 | Money audit (minor units, VND) | Not started |
| 8 | Payments interface | Not started |
| 9 | Entitlements and metering | Not started |
| 10 | `NOT NULL`, foreign keys, row-level security | Not started |
| 11 | Reads switched to tenant-aware queries | After **7 clean days of shadow reads** |
| 12 | Old email joins dropped | A later release, after a quiet week |

**Timeline.** Step 11 can't happen sooner than 7 days after shadow reads start (they start with step 4, once steps 2 and 3 have run on production). Step 12 follows at least a week after step 11. So Phase 3 finishes about two to three weeks after step 3 reaches production, however fast the code is written.

## 0. Merge the plan documents (#100)

The updated plans (decisions L to AF, §6.2.1 to §6.9, §11, test plan §3.16 to §3.18) are on `claude/magical-carson-1c6poj`, and the Phase 3 branch is cut from it. Merge #100 first, so the Phase 3 pull requests show only code.

**Done when:** #100 is merged, and #101's diff no longer lists `docs/plans/luvallplay-*.md`.

## 1. Step 1: tenants schema (#101), one production data run

**Done (23 Nov 2026, 07:36 UTC), run by the build session at the owner's request, after CI went green on #101:**
- Restore point: `pre-phase-3-tenants` (`br-still-sound-a7oqk653`, 07:32 UTC).
- Before: 17 live accounts, 17 signed in, access checks passed.
- `0003_tenants` applied in 5.5 s.
- Diff against `2026-11-phase3-tenants.production.json`: **passed**. 17 accounts checked, 0 problems; the only changes are the five new tables.
- Drift: none. `verify.mjs`: 1 club, 22 modules on, 19 accounts and 19 club members (2 owners, 17 members), 2 `club_roles` rows and 2 platform admins unchanged, mirror drift 0.
- The live site answers (`/`, `/login`). It runs the previous app version until #101 is merged, which ignores the new tables.
- #101 merged and deployed at 07:48 UTC. After the deploy: `/` and `/login` answer, and `verify.mjs` still reports 19 accounts, 19 club members and mirror drift 0.

What follows is the record of how the run was prepared.

**What runs:** migration `0003_tenants`. Additive: five new tables (`tenants`, `tenant_modules`, `club_members`, `junior_profiles`, `guardianships`), then three inserts: Three Wolves' row, its 22 module rows, and one `club_members` row per account. No existing table, row or role changes. The site doesn't read the new tables yet.

**Already done (23 Nov), on a fresh Neon branch of production (`rehearsal-phase-3-tenants`):**
- Data guard rehearsal: **17 accounts checked, 0 problems**. The migration took 5.5 s.
- 1 club; 22 modules, all on; 19 accounts and 19 club members (2 owners, 17 members); `club_roles` and `platform_admins` unchanged; reconcile writes 0 rows.
- Schema drift: none. Access check: 17 live accounts, 17 signed in.
- Report: `docs/rehearsals/2026-11-phase3-tenants.md`.

**Second sign-off:** Kelcee (or Timba) reads the report and says OK on #101.

**Production run (T0)**, at a quiet time, not a play-day evening. Say **"run step 1 on production"** in the build thread and the session runs it, or run it yourself from an up-to-date checkout of the branch (`pnpm install` at the root, then from `apps/web`):

```bash
# 1. Restore point: Neon console → three-wolves-sydney → Branches → New branch from main, now.
#    Name: pre-phase-3-tenants

cd apps/web
export POSTGRES_URL='<production direct connection string>'      # the SYD_POSTGRES_URL_NON_POOLING value
export PRODUCTION_DATABASE_HOSTS='ep-shiny-rain-a76n3kg6.ap-southeast-2.aws.neon.tech'

# 2. Snapshot, migrate, snapshot, diff, verify
pnpm data-guard snapshot --out .data-guard/prod-before.json      # read-only
pnpm db:migrate --production                                      # 0003_tenants, one transaction (lock_timeout 3s)
pnpm data-guard snapshot --out .data-guard/prod-after.json
pnpm data-guard diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase3-tenants.production.json
pnpm db:drift                                                     # must say: No schema drift
node --import ./tests/register.mjs scripts/tenants/verify.mjs     # must say: tenants tables are consistent
```

**Done when:** the diff passes with 0 errors, drift is empty and `verify.mjs` reports one club, 22 modules on, as many club members as accounts, and no mirror drift. Then merge #101; Vercel deploys `main`. Smoke test: `/login`, sign in → Me, Arena, `/admin` as an owner, **Admin → People → Admins** (add and remove a coach on a test account, then run `verify.mjs` again: still no drift).

**If anything fails:** stop. The migration is one transaction, so a failure leaves nothing behind. Undoing a completed run is dropping the five new tables (nothing else references them). `pre-phase-3-tenants` holds the exact state from before.

**Rollback of the app:** Vercel Instant Rollback. The previous version ignores the new tables. If it runs for a while, role changes made meanwhile aren't mirrored; `node --import ./tests/register.mjs scripts/tenants/verify.mjs --reconcile` brings `club_members` back in line.

## 2. Step 2: `tenant_id` columns (#102), one production data run

**What runs:** migration `0004_tenant_id_columns`. Additive: a nullable `tenant_id` on the 54 club-owned tables, with a constant default of Three Wolves' id. Postgres keeps the default in the catalog, so no row is rewritten, every existing row reads as Three Wolves' at once, and rows written by either app version get it. The site doesn't read the column yet.

**Done (23 Nov 2026, 08:25 UTC), run by the build session at the owner's request:**
- **The order below turned out to be wrong, and was reversed.** #102 was merged first, and its production build failed: the app's typed queries name every column in the schema, so the new version asks for `tenant_id` and can't build until the column exists. The failed build never went live; the site kept serving the previous version. The migration then ran, and `main` was redeployed.
- Restore point: `pre-phase-3-tenant-id` (`br-muddy-hall-a7w9kpe3`, 08:24 UTC).
- `0004_tenant_id_columns` applied in 1.4 s.
- Diff against `2026-11-phase3-tenant-id.production.json`: **passed**. 17 accounts checked, 0 problems.
- Drift: none. `verify.mjs`: 57 club-owned tables, 1,441 rows, every row with the club's `tenant_id`.
- Redeploy Ready at 08:28 UTC; `/` and `/login` answer.
- **Rule from now on: migrate first, then merge.** A version that adds a column to the schema can't deploy before the column exists. The previous version always works with the new column in place.

What follows is the record of how the run was prepared (its "merge first" order is the part that was wrong).

**Order as first planned: merge and deploy #102 first, then run the migration.** The rehearsal's characterisation check found that "Download my data" would show a new `tenant_id` field for members who have played in a pair. #102 fixes that query. Deployed first, nobody sees the field.

**Already done (23 Nov), on a fresh Neon branch of production (`rehearsal-phase-3-tenant-id`):**
- Data guard rehearsal: **17 accounts checked, 0 problems**. The migration took 1.5 s.
- 57 club-owned tables, 1,441 rows: every row has the club's `tenant_id`.
- Characterisation: **identical** for 17 accounts (12 views each) and 6 club views, after the export fix.
- Schema drift: none.
- Report: `docs/rehearsals/2026-11-phase3-tenant-id.md`.

**Production run (T0)**, at a quiet time. Say **"merge #102 and run step 2 on production"** and the session does both in that order, or:

```bash
# 0. Merge #102. Wait for the production deployment to be Ready.
# 1. Restore point: Neon console → three-wolves-sydney → Branches → New branch from main, now.
#    Name: pre-phase-3-tenant-id

cd apps/web
export POSTGRES_URL='<production direct connection string>'
export PRODUCTION_DATABASE_HOSTS='ep-shiny-rain-a76n3kg6.ap-southeast-2.aws.neon.tech'

pnpm data-guard snapshot --out .data-guard/prod-before.json
pnpm db:migrate --production                                      # 0004, one statement (lock_timeout 3s)
pnpm data-guard snapshot --out .data-guard/prod-after.json
pnpm data-guard diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase3-tenant-id.production.json
pnpm db:drift                                                     # must say: No schema drift
node --import ./tests/register.mjs scripts/tenants/verify.mjs     # must say: tenants tables are consistent
```

**Done when:** the diff passes with 0 errors, drift is empty, and `verify.mjs` reports every row of every club-owned table with the club's `tenant_id`. Smoke test: sign in → Me, Arena, book or cancel a play day on a test account, `/admin`.

**If the migration fails:** it changes nothing (one transaction). A `lock timeout` means a long query was in the way; run it again.

**Rollback of the app:** Vercel Instant Rollback. The previous version ignores the column, and its writes still get the club from the default. One visible effect: the data export shows the `tenant_id` field again for members with a pair, until the fix is redeployed.

## 3. Step 3: email links → `user_id` (#103), one production data run

**What runs:** migration `0005_user_id_links`. Ten email-keyed tables gain a nullable `user_id` (foreign key to the account, `ON DELETE RESTRICT`, indexed), filled with the live account whose email matches. Two trigger functions keep the link in step for every writer. The email stays as the contact field, and the site doesn't read `user_id` yet.

**Done (23 Nov 2026, 09:09 UTC), run by the build session; approved in advance by the owner, after green CI and a clean rehearsal:**
- Restore point: `pre-phase-3-user-id-links` (`br-mute-pine-a71jdjeh`, 09:09 UTC).
- `0005_user_id_links` applied in 4.4 s.
- Diff against `2026-11-phase3-user-id-links.production.json`: **passed**. 17 accounts checked, 0 problems.
- Drift: none. `verify.mjs`: 453 rows in the ten tables, 287 linked to an account, 166 for people without one, no disagreement with the email; all triggers present.
- #103 merged at 09:11 UTC. The rehearsal branch was deleted.
- CI failed once before the run, on a test that sorted mixed-case emails without fixing the sort rules (CI's database sorts them differently). The test was fixed; nothing in the migration changed.

**Order: migrate first, then merge #103** (the rule from step 2).

**Already done (23 Nov), on a fresh Neon branch of production (`rehearsal-phase-3-user-id-links`):**
- Data guard rehearsal: **17 accounts checked, 0 problems**. The migration took 4.9 s.
- 453 rows in the ten tables: 287 linked to an account, 166 for people without one. No row where `user_id` and the email disagree.
- Characterisation: **identical** for 17 accounts and 6 club views.
- Schema drift: none (functions and triggers included).
- The first rehearsal found one member's data export listing two same-day bookings in a different order. The export now has a full sort order, and the rehearsal was repeated from a fresh copy. Report: `docs/rehearsals/2026-11-phase3-user-id-links.md`.

**Production run (T0):** approved in advance by the owner ("run step 3 on production once it's rehearsed"), on condition of green CI and a clean rehearsal.

```bash
# 1. Restore point: Neon → three-wolves-sydney → Branches → New branch from main, now.
#    Name: pre-phase-3-user-id-links

cd apps/web
export POSTGRES_URL='<production direct connection string>'
export PRODUCTION_DATABASE_HOSTS='ep-shiny-rain-a76n3kg6.ap-southeast-2.aws.neon.tech'

pnpm data-guard snapshot --out .data-guard/prod-before.json
pnpm db:migrate --production                                      # 0005 (lock_timeout 3s)
pnpm data-guard snapshot --out .data-guard/prod-after.json
pnpm data-guard diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase3-user-id-links.production.json
pnpm db:drift                                                     # must say: No schema drift
node --import ./tests/register.mjs scripts/tenants/verify.mjs     # must say: tenants tables are consistent
# 2. Merge #103. Wait for the production deployment to be Ready.
```

**Done when:** the diff passes with 0 errors, drift is empty, `verify.mjs` reports no disagreement between `user_id` and the email, and the deploy is Ready. Smoke test: sign in → Me (membership and calendar), Stats, book and cancel a play day on a test account, then `verify.mjs` again (the new booking is linked).

**If the migration fails:** it changes nothing (one transaction).

**Rollback of the app:** Vercel Instant Rollback. The previous version ignores the column, and the triggers keep linking its writes.

## 4. Step 4: settings replace constants (no data run)

Step 4 changes no data: the settings were stored by step 1. It ships in parts.

**Part 1 (built):** `lib/club-config.ts` is the one place the app asks for the club's settings. The environment variable `CLUB_SETTINGS_SOURCE` decides which copy answers:

| Value | What answers | Use |
|---|---|---|
| `constants` (default, also when unset) | The values built into the code, as today | Until shadow reads start |
| `shadow` | The built-in values, with the stored ones read beside them and any difference logged as `[shadow] club settings …` | The 7-day shadow period |
| `database` | The stored values. A missing or malformed one falls back to the built-in value for that field, with a warning | After 7 clean days |

**Admin → Setup check → Club settings** shows the comparison at any time, whatever the source.

**Needs you, once part 1 is deployed:** set `CLUB_SETTINGS_SOURCE=shadow` for Production in Vercel → Settings → Environment Variables, and redeploy. That starts the 7-day clock for settings. Rollback is deleting the variable.

**Still to build in step 4:** the app's code reading its settings through this loader instead of the constants (time zone, courts → players, booking window and cut-off, membership days and cycles, donation limits, the "Wolf" terms), and the crons, emails, webhooks and API becoming club-scoped.

## 5. Housekeeping that needs you

- **Rehearsal branches.** `rehearsal-phase-2` and `rehearsal-phase-3-tenants` were deleted on 23 Nov, at the owner's request. From now on the session deletes each rehearsal branch once its step has run on production.
- **Branch limit.** The Neon free plan allows 10 branches per project. Today there are 7: main and six restore points (`pre-phase-1`, `pre-phase-2-data`, `pre-phase-2-data-run`, `pre-phase-3-tenants`, `pre-phase-3-tenant-id`, `pre-phase-3-user-id-links`). The three from Phase 1 and 2 can go once you're happy with those phases; say the word. Each Phase 3 data step adds a restore point and a rehearsal branch. The older `pre-phase-*` restore points can go once you're happy with Phase 1 and 2.
- **Point-in-time restore covers 6 hours, not 7 days.** The project's history retention is 21,600 seconds (the free plan's limit). Test plan §4.4 asks for a window that covers the next 7 days. Until the plan changes, the named `pre-<step>` branch is the restore point for each step, and it's kept until the step's watch period ends.
- **Each new Neon branch has a new host**, and the build session's network only allows named hosts. Expect one approval card per rehearsal (two hosts: direct and pooled).
- **One branch, one step at a time.** The build session pushes only to `claude/luvallplay-phase-3`, so each step's pull request opens after the previous one is merged.
- **Previews build again.** The nine stale `preview/claude/*` branches in the old US Neon project were deleted on 23 Nov. That project fills up again after about nine more previews; option A in the Phase 2 runbook §1 stops it recurring.
