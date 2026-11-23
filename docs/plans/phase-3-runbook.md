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
| 4 | Settings replace constants (behind flags) | In progress. Parts 1 to 5 merged (#104, #105); **shadow reads for settings started 23 Nov, 09:50 UTC** (§4) |
| 5 | Module enforcement | Part 1 live (#106): route ownership, the proxy and admin menu checks, the owner's switch page (§5). The end-to-end journey S2 and the permission matrix rows for switching and locks are added |
| 6 | Second database driver, region routing | Built: the standard-Postgres driver, host routing (off until switched on), storage and scheduled-job interfaces (§6) |
| 7 | Money audit (minor units, VND) | Built: currency helpers, every conversion moved onto them, VND tests, two CI scans (§7) |
| 8 | Payments interface | Built: the interface, Stripe as the first provider, a shared contract suite; one-off payments and the webhook signature check use it (§8) |
| 9 | Entitlements and metering | **Done.** Production data run passed (23 Nov, 17:09 UTC); merged (#109) |
| 10 | `NOT NULL`, foreign keys, row-level security | **Done.** Production data run passed (23 Nov, 18:17 UTC); merged (#110). **Shadow reads through row-level security started 23 Nov, 19:06 UTC** |
| 11 | Reads switched to tenant-aware queries | After **7 clean days of shadow reads**: not before **1 Dec 2026** (§11) |
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

**Shadow reads are on (23 Nov 2026, 09:50 UTC).** `CLUB_SETTINGS_SOURCE=shadow` is set for Production (by the build session, under the owner's blanket approval), and #104's deploy picked it up. The earliest day to switch to `database` is **30 Nov**, if the logs and Admin → Setup check → Club settings show no difference. Rollback at any time is deleting the variable and redeploying.

**The record of shadow reads.** The hosting plan keeps server logs for one hour, so logs can't show seven clean days. Each result is a row in `admin_audit_log` (`action = shadow.settings`, `target` = `clean`, `differ` or `unavailable`): a difference is written when a request sees it, and the roster cron writes one result a day whether or not there is a play day (`lib/shadow-log.ts`). To read it: `node --import ./tests/register.mjs scripts/shadow-report.mjs` in `apps/web` with `POSTGRES_URL` set (read-only; exits 1 if any day has a difference). The gate for step 11 is seven days with a `clean` row and no `differ` row.

**Parts so far:**

| Part | What reads the club's settings | Where |
|---|---|---|
| 1 | The loader and the comparison | #104, live |
| 2 | Donation limits; how far ahead a membership start is searched, and how long an unpaid checkout holds a spot | #104, live |
| 3 | The time zone literal collected into one constant (16 files), with a scan that fails on new copies | #105, merged |
| 4 | Play-day capacity: courts → players, general capacity, the mini-game field, including the booking guard's SQL, which had its own typed copy of the table | #105, merged |
| 5 | The remaining server-side capacity uses: the casual-play courts change, the spots API's fallback, the admin play-days page | #105, merged |
| 6 | The durable record of shadow reads (audit-log rows, a daily result from the roster cron, a report script) | Built |
| 7 | The booking clock (time zone, booking window, cut-off hour): the date helpers take it; the booking rule and the Me page pass the club's | Built |
| 8 | Membership cycle lengths in the renewal SQL, the Stripe sync and the free month | Built |
| 9 | Client components read the club's public settings from a provider (capacity, mini-game cap, the booking clock) | Live (#107) |
| 10 | The club's clock passed at every call of the date helpers. The last 11 plain helpers now get it from their callers; the test's list of exceptions is empty | Merged (#112, #113) |
| 12 | The shop's end-of-day helper works in any time zone (it used to try New Zealand's two UTC offsets) | Merged (#113) |
| 13 | The club's terms typed into app code (emails, admin screens, the analyzer's and the home page's copy tables): 44 lines in 16 files now read the settings. The rank titles "Alpha Wolf" and "Silver Wolf" ("Sói Đầu Đàn", "Sói Bạc") are club terms too. Migration `0009_terms_seats` adds them to Three Wolves' row | **Done.** Production data run passed (23 Nov, 21:14 UTC): 18 accounts, 0 problems, no drift; restore point `rehearsal-phase-3`, reset just before. Merged (#113) |
| 11 | The club's own terms leave the shared dictionaries: "Wolf Points", "Wolf Vision" and the Vietnamese "Điểm Sói" are placeholders, filled per language from the club's settings. Migration `0008_terms_localized` adds the Vietnamese name to Three Wolves' row | **Done.** Production data run passed (23 Nov, 20:23 UTC): 17 accounts, 0 problems, no drift. The restore point was `rehearsal-phase-3`, reset to a fresh copy of production just before, because the Neon branch limit left no room for a new one. Merged (#112) |

**Still to build in step 4:** the time zone, booking window and cut-off read from the settings at run time (server and client); membership days and cycle lengths; the "Wolf" terms in the translated strings; capacity in the admin pages and client components; and the crons, emails, webhooks and API becoming club-scoped.

**A wording change you should know about.** Two Vietnamese sentences said "Wolf Points" where the rest of the Vietnamese text says "Điểm Sói" (the home page's leaderboard teaser and the Arena's line about ranks). They now say "Điểm Sói" like the rest. Every other string renders exactly as before; the snapshot test covers all of them.

**More wording changes in Vietnamese (round two).** The Arena's line about ranks and the home page's feature list said "Alpha Wolf" and "Silver Wolf" in Vietnamese sentences, while the rank badges say "Sói Đầu Đàn" and "Sói Bạc". They now use the Vietnamese titles throughout. In English, one admin sentence changed from "the next three are Silver Wolves" to "each of the next three is a Silver Wolf", so the title is never pluralised by code.

**Still built in, on purpose:** the club's name ("Three Wolves") in emails and page titles, the 🐺 in a few labels, and route names such as `/profile/wolf-vision`. They move with the brand work in Phase 6. A test now fails on any typed "Wolf Points", "Wolf Vision", "Alpha Wolf", "Silver Wolf" or their Vietnamese forms outside `lib/constants.ts`.

## 5. Step 5: module enforcement (no data run)

Step 5 changes no data: step 1 stored a row per module for Three Wolves, all on. With every module on, nothing is stopped, so behaviour is as today.

**Part 1 (#106):**
- `packages/modules/src/routes.ts` says who owns every page and API route: a module, the core, the account or the platform. A test reads the app's real route list and fails on a route without an owner.
- The request proxy answers 404 for a path whose module is off for the club. That covers the module's admin pages, app and site pages, API routes and cron routes in one place. The admin menu hides the same pages.
- **Admin → Settings → Modules** (linked from Pricing & settings): the list, and a switch for owners and platform admins. The registry's rules apply: the core never switches, a needed module comes first, a module others depend on stays, and a platform lock holds for owners. Every change is in the audit log.
- Switching off never deletes: the module's data stays and is back when it's switched on.
- If the club's modules can't be read, every module counts as on, and it is logged. `MODULE_ENFORCEMENT=off` is the escape hatch.

**Tests (journey S2 for every module):** for each of the 16 optional modules, at route level (off stops exactly its own routes) and against a real database (off, on again, data kept).

**Still to build in step 5:** the parts of a module that live inside another module's page (for example the membership card on Me, the Arena tab, site sections, payments-to-check), the emails each module sends, a confirmation when a module has live activity, and the platform console's lock and availability controls.

**Part 2 (after step 10):**

| What follows the switches now | How |
|---|---|
| Home page sections: gallery, leaderboard teaser, membership, donate | Rendered only when the module is on |
| Navigation and footer links to those sections | Hidden with the section |
| Profile tabs (Arena, Vision) and the menu's leaderboard link | Filtered by the route table |
| Me page: membership card or Join panel, shop | Hidden with the module; the data is kept |
| Cached pages | Refreshed when a module is switched |
| **The platform's lock** | Luvallplay staff can lock a module on or off for the club, with a reason the owners see, and unlock it (Admin → Settings → Modules). Locking puts the module in that state by the same rules as any switch; an owner can't undo it |

**Payments to check.** With that module off, the shop no longer offers "reserve now, pay cash at pickup" (the page hides it and the API refuses it). **Decision: what is already waiting can still be finished.** A reservation made before the switch can still be marked as paid, and the Members page keeps showing whether a bank transfer has been matched; otherwise switching the module off would strand money.

**Per-module emails. Decision: nothing more to switch.** A module that is off can't start the flows that send its emails, and its reminder cron answers 404. An email about a payment that was already taken (a webhook arriving after the switch) is still sent, for the same reason as above.

## 6. Step 6: second database driver and region routing (no data run)

Nothing here changes data, and nothing changes behaviour until a setting is switched.

| Piece | What it is | Setting | Default |
|---|---|---|---|
| Second driver | `lib/database-pg.ts`: standard Postgres over TCP, behind the same client as the Neon driver. The golden master runs every repository function on the old client, the Neon driver and this one, and requires identical results and identical rows afterwards | `DATABASE_DRIVER` = `neon` or `postgres` | `neon`. An unknown value stops the app at its first query |
| Host routing | Host → club → region (`@luvallplay/core/host-routing`, `lib/tenant-routing.ts`), checked in the request proxy for every page and API request | `TENANT_ROUTING` = `off`, `shadow` or `enforce`; `REGION` (default `syd`); `PLATFORM_DOMAINS`; `EDGE_CONFIG` | `off`. An unknown value counts as `enforce` |
| Storage | `lib/storage.ts`: one interface for public files; Vercel Blob is the first provider. Admin image uploads, profile pictures and their deletes go through it | `STORAGE_DRIVER` | `vercel-blob`. An unknown value throws |
| Scheduled jobs | `lib/cron.ts` is the list; `vercel.json` must match it (a test); `scripts/cron/k8s.mjs` prints Kubernetes CronJobs for a region not on Vercel. Every job checks the scheduler's secret the same way | `CRON_SECRET` | With no secret, nothing is authorised in production |

**How routing fails closed** (in `enforce`): an unregistered host gets 404; a club that lives in another region gets 421; a club whose row names a region the code doesn't know gets 404; if neither Edge Config nor the database can answer, 503. Until reads are tenant-aware (step 11) a deployment holds one club's data, so a host for a different club in the same region gets 404 too.

**The lookup:** Edge Config when `EDGE_CONFIG` is set (one small read per host, kept for a minute), then the `tenants` table. Edge Config is only a copy: a host missing from it is still found in the database. `scripts/tenants/hosts.mjs` prints the items for the copy, and with `--check` compares the copy with the database.

**Turning routing on, when you want it** (not needed while there is one club):

1. Set `REGION=syd` and `TENANT_ROUTING=shadow` for Production and redeploy. Requests are served as before; a host that would be refused is written to the shadow record (`shadow.routing`), and the daily heartbeat checks the club's own hosts through the same lookup.
2. After a week with no `differ` row for routing (`scripts/shadow-report.mjs`), set `TENANT_ROUTING=enforce`.
3. Rollback at any time: delete `TENANT_ROUTING` and redeploy.

**Finding, handled:** the site is served on `www.threewolvesbadminton.org` while the club's row holds `threewolvesbadminton.org`. Hosts are normalised before lookup (lower case, no port, no leading `www.`), so both resolve.

**Finding:** two scheduled jobs (the roster email and the membership reminders) ran without checking the scheduler's secret when `CRON_SECRET` wasn't set; the other three refused. All five now use one check, which refuses in production when no secret is set. `CRON_SECRET` must be set in Production (the three jobs that already required it are working, so it is).

**Finding in the tests, fixed:** the golden master's stand-in for "work after the response" started that work at once, so a history backfill could rewrite rows while the function under test was still reading them, and which side won depended on the driver's speed. The stand-in now runs the work after the function returns, as production does.

**Still provider-specific** (listed in `lib/storage.ts`, enforced by a test): browser-direct photo uploads and finance receipts use Vercel Blob's own protocol. They move with the S3-compatible provider for the Hanoi region.

## 7. Step 7: money audit (no data run)

**What was audited.** Every multiply or divide by 100 in the app and every typed currency code.

| Found | Count | Now |
|---|---|---|
| Money converted by hand (`cents / 100`, `Math.round(amount * 100)`, `toFixed(2)` with a typed `$`) | 41 lines | `toMinor`, `fromMinor`, `roundToMinor`, `minorToDecimal`, `formatMoney` in `@luvallplay/core/money`, with the currency as a parameter |
| `currency: "nzd"` typed into payment calls | 12 lines (payment calls, a balance filter, two defaults) | The club's currency |
| Percentages, progress bars, rounding of measurements | 25 lines in 16 files | Left alone, and listed in the scan with what each number is |

**How VND is handled.** A currency's decimal places come from one table (NZD 2, AUD 2, VND 0). 50,000 dong is stored as `50000` and shown as `50.000 ₫`; it is never divided by 100, and `50000.5` is refused as an amount. A currency that isn't in the table throws; it is never guessed.

**Two scans run in CI** (`tests/money-scan.test.ts`): a new `/ 100` or `* 100` outside the money helpers fails unless its file is listed with what the number is, and a typed currency code fails outside four listed files.

**Unchanged for Three Wolves.** A test compares the new formatting with the old expression for a range of amounts, and the ledger's parsing and formatting with their old results.

**Decisions.**
- The `*_cents` columns keep their names. They hold minor units; for VND a "cents" column holds whole dong. Renaming them (12 columns) is a contract step for a later release.
- A row's currency is its club's currency (`tenants.currency`); rows don't carry their own. A club has one currency.
- Until reads are tenant-aware (step 11), conversions that don't have the club's settings to hand use the built-in `CLUB_CURRENCY`, which a test keeps equal to the built-in `currency` setting. Property names such as `priceNzd` stay for now.

## 8. Step 8: payments interface (no data run)

| Piece | Where |
|---|---|
| The interface: create a payment, read it, refund, verify a webhook, list what succeeded (reconcile), payout status; and the provider's **capabilities** | `@luvallplay/core/payments` |
| Stripe, the first provider | `lib/payments/stripe-provider.ts` |
| A test provider that keeps real state and signs its webhooks; it also plays "a QR provider with no cards, recurring charges, refunds or webhooks" | `lib/payments/fake-provider.ts` |
| The provider this deployment uses | `PAYMENTS_PROVIDER` (default `stripe`; an unknown value throws) |

**The shared contract suite** (`tests/payments.test.ts`) runs on every provider: create, idempotency, refused amounts and currencies, full and partial refunds, never more than was paid, webhook signatures (real, altered, missing, forged), **events replayed twice and out of order**, reconcile, payout status, capability flags. Stripe runs it against a stand-in for its API with Stripe's own webhook signing.

**Events twice and out of order.** `applyPaymentEvent` folds events into a payment's state so the result is the same in any order and with any repeats: a seen event changes nothing, a status only moves forward, a refunded total only grows and never passes the amount. A test runs every ordering of four events, each delivered twice.

**What uses the interface now:** casual-play payments, one-off donations, shop orders, and the webhook's signature check. A test proves the request sent to Stripe is exactly what those routes sent before.

**Still on Stripe's own API** (16 files, pinned by a test so the list only shrinks): subscriptions and their self-service changes, offline (cash and bank) invoices, the Vision pass checkout page, the ledger sync and the webhook's handlers. They move as their modules are touched; the recurring ones need the interface's subscription operations, which arrive with the first provider that lacks them (Vietnam).

## 9. Step 9: plans, entitlements and usage (one production data run)

**The change (migration `0006_entitlements`, additive only):**

| Table | What it holds | After the migration |
|---|---|---|
| `plans` (platform) | What a plan includes (tiers), for which country and sport, and its price in minor units and a currency | One row: `nz-badminton-free`, New Zealand badminton, free for good |
| `club_plans` | Which plan a club is on and since when; one current row per club | One row: Three Wolves on `nz-badminton-free` |
| `usage_counters` | One number per club, metric and calendar month | Empty; fills as the club uses the app |

**In the app:**
- `can(db, "module")` or `can(db, "module.feature")` answers whether the club's plan includes a module's tier (`lib/entitlements.ts`, rules in `@luvallplay/core/entitlements`).
- **`BILLING_ENABLED` is off** (unset). With billing off, `can()` allows every real module without reading the plan. With it on, the free tier is allowed even with no plan, a late payment doesn't switch anything off, and a plan that can't be read allows the feature and logs an error.
- **Usage is counted per club from now on:** emails sent, sign-in texts sent, bytes uploaded to file storage, online payments started. A count that can't be written is dropped; it never fails the email, text, upload or payment.
- **Fair-use limits report, they never block** (§11.2). The plan's `limits` are empty until the cost model sets them (§11.3 gate 4), so no limit applies today.

**Rehearsal (23 Nov), on `rehearsal-phase-3`, reset to a fresh copy of production:** data guard 17 accounts, 0 problems; migration 3.5 s; characterisation identical before and after; no drift; verify consistent. Report: `docs/rehearsals/2026-11-phase3-entitlements.md`.

**Production run (T0):** approved in advance by the owner, on condition of green CI and a clean rehearsal. Migrate first, then merge.

```bash
# 1. Restore point: a Neon branch from main, now. Name: pre-phase-3-entitlements
cd apps/web
export POSTGRES_URL='<production direct connection string>'
export PRODUCTION_DATABASE_HOSTS='ep-shiny-rain-a76n3kg6.ap-southeast-2.aws.neon.tech'
pnpm data-guard snapshot --out .data-guard/prod-before.json
pnpm db:migrate --production                                      # 0006 (lock_timeout 3s)
pnpm data-guard snapshot --out .data-guard/prod-after.json
pnpm data-guard diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase3-entitlements.production.json
pnpm db:drift                                                     # must say: No schema drift
node --import ./tests/register.mjs scripts/tenants/verify.mjs     # must say: tenants tables are consistent
# 2. Merge the step 9 pull request. Wait for the production deployment to be Ready.
```

**Production run, done 23 Nov 2026, 17:09 UTC** (by the build session, approved in advance, after green CI and a clean rehearsal): restore point `pre-phase-3-entitlements`; the migration took 3.5 s; the data guard diff passed with 17 accounts and 0 problems; no drift; verify consistent; Three Wolves is on `nz-badminton-free`. #109 merged afterwards.

**Rollback:** `DROP TABLE usage_counters, club_plans, plans;` and remove the migration's row, or restore `pre-phase-3-entitlements`. Nothing else points at these tables.

**Not in this step:** the platform admin's usage dashboard with alerts, and the limits themselves. Both wait for the cost model (§11.3 gate 4).

## 10. Step 10: required club id, foreign keys, row-level security (one production data run)

**The change (migration `0007_tenant_rls`). No row changes; what changes is what the database accepts.**

| Part | What |
|---|---|
| Required | `tenant_id` is `NOT NULL` with a foreign key to `tenants` (`ON DELETE RESTRICT`) on every club-owned table (59). The `DEFAULT 1` stays until step 11, because the running app still writes without naming the club |
| The app's role | `luvallplay_app`: not the owner, no `BYPASSRLS`, no login. A connection switches to it with `SET LOCAL ROLE` |
| Row-level security | Enabled and **forced** on all 59 club-owned tables, one policy each: a row is visible and writable only when its `tenant_id` is the club named in the transaction setting `app.tenant_id` |
| Fails closed | With no club named, the app's role sees no rows and can write none. A value that isn't a number is an error |
| Accounts stay global | The trigger that links a new account to the person's earlier rows runs as its owner, so it links rows in every club |

**The live app is not affected by the migration.** It connects as the database owner, which has `BYPASSRLS` (checked on the copy of production). `TENANT_SCOPE` decides when the app starts using the role:

| `TENANT_SCOPE` | What happens | When |
|---|---|---|
| unset or `off` | As today: the owner's connection | Until shadow reads start |
| `shadow` | As today, **and** one read in ten is run a second time as the app's role for the club, in a read-only transaction; a read that answers differently is written to the shadow record (`shadow.tenant-reads`). The daily heartbeat also checks every club-owned table | The 7-day shadow period |
| `enforce` | Every statement runs as the app's role for the club. **This is step 11** | After 7 clean days |

An unknown value counts as `enforce`.

**Evidence that `enforce` gives the same answers:**
- The golden master runs every repository function a fourth time, as the app's role through row-level security, and requires identical results and identical rows afterwards.
- On the rehearsal copy of production, every account's views (17 accounts, 12 views each, and 6 club views) are identical through row-level security.
- **Finding, fixed:** three list queries had no tie-breaker in their `ORDER BY` (message threads and the ledger's known people), so their order depended on the query plan. They have one now.

**The tenant-isolation suite** (`tests/tenant-isolation.test.ts`) is generated from the table list: for every club-owned table it proves a second, synthetic club can't read, change, delete or take the first club's rows, that nothing is visible with no club named, and that the role can't alter tables or policies. A new table is covered as soon as it is classified.

**Plan change: natural keys keep their shape until step 11.** Many tables have keys that assume one club (a play day's date, a setting's name). Widening them to include `tenant_id` changes every `ON CONFLICT` that names them, so it goes with step 11, where those queries change anyway. Until then the keys are stricter than they need to be, which can't leak anything; it only means a second club couldn't share, say, a play-day date. There is no second club in production.

**Rehearsal (23 Nov), on `rehearsal-phase-3`, reset to a fresh copy of production:** data guard 17 accounts, 0 problems; migration 2.1 s; no drift; verify consistent. Report: `docs/rehearsals/2026-11-phase3-tenant-rls.md`.

**Production run (T0):** approved in advance by the owner, on condition of green CI and a clean rehearsal. Migrate first, then merge.

```bash
# 1. Restore point: a Neon branch from main, now. Name: pre-phase-3-tenant-rls
cd apps/web
export POSTGRES_URL='<production direct connection string>'
export PRODUCTION_DATABASE_HOSTS='ep-shiny-rain-a76n3kg6.ap-southeast-2.aws.neon.tech'
pnpm data-guard snapshot --out .data-guard/prod-before.json
pnpm db:migrate --production                                      # 0007 (lock_timeout 3s)
pnpm data-guard snapshot --out .data-guard/prod-after.json
pnpm data-guard diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase3-tenant-rls.production.json
pnpm db:drift                                                     # must say: No schema drift
node --import ./tests/register.mjs scripts/tenants/verify.mjs     # must say: tenants tables are consistent
# 2. Merge the step 10 pull request. Wait for the production deployment to be Ready.
# 3. Set TENANT_SCOPE=shadow for Production and redeploy: the 7-day shadow period for step 11 starts.
```

**Production run, done 23 Nov 2026, 18:17 UTC** (by the build session, approved in advance, after green CI and a clean rehearsal): restore point `pre-phase-3-tenant-rls`; the migration took 2.2 s; the data guard diff passed with 17 accounts and 0 problems; no drift; verify consistent, including row-level security on all 59 tables. The live site answered normally before and after. #110 merged afterwards.

**Shadow settings, set for Production on 23 Nov (19:05 UTC) and deployed:** `TENANT_SCOPE=shadow`, `TENANT_ROUTING=shadow`, `REGION=syd`. `CLUB_SETTINGS_SOURCE=shadow` was already set. The first daily heartbeat row is written by the roster cron at 03:00 UTC.

**Rollback:** in the rehearsal report. The quick one is deleting `TENANT_SCOPE` and redeploying: the app is back on the owner's connection and the policies don't apply to it.

## 11. Step 11: the switch (after 7 clean days)

1. `node --import ./tests/register.mjs scripts/shadow-report.mjs` on production: seven days with `clean` rows for `settings`, `routing` and `tenant-reads`, and no `differ` row.
2. Set `CLUB_SETTINGS_SOURCE=database` and `TENANT_SCOPE=enforce` for Production, one at a time, a day apart, redeploying each time. Watch the error log for an hour after each.
3. Rollback for either: set it back to `shadow` and redeploy.
4. Still to build before or with the switch: natural keys widened with `tenant_id`, the `DEFAULT 1` dropped, a login for the app's role (so the app can't connect as the owner at all), and the route-level isolation suite, which needs requests for two clubs.

**Before step 9's tables are relied on for add-ons** (a note from the planning session, decision AK): the Xero accounting sync will be a paid add-on that any club can hold, including one on the free plan. Today `club_plans` allows one current row per club. Add-ons need either a `kind` on `plans` (`base` or `addon`) with the one-current-row rule applied to base plans only, or a separate table. Nothing is built for this yet, and nothing built so far blocks it.

## 12. Housekeeping that needs you

- **Rehearsal branch.** One reusable branch, `rehearsal-phase-3`, is kept for the rest of the phase and reset to a fresh copy of production before each rehearsal, so its host needs approving only once. It holds real data: delete it when Phase 3 is done.
- **Branch limit: reached.** The Neon free plan allows 10 branches per project, and there are 10: main, the reusable `rehearsal-phase-3`, and eight restore points (`pre-phase-1`, `pre-phase-2-data`, `pre-phase-2-data-run`, `pre-phase-3-tenants`, `pre-phase-3-tenant-id`, `pre-phase-3-user-id-links`, `pre-phase-3-entitlements`, `pre-phase-3-tenant-rls`). Before the next data step (step 11's key changes), delete the oldest restore points you no longer need; the Phase 1 and Phase 2 ones are the candidates. I haven't deleted any: they are your backups.
- **Point-in-time restore covers 6 hours, not 7 days.** The project's history retention is 21,600 seconds (the free plan's limit). Test plan §4.4 asks for a window that covers the next 7 days. Until the plan changes, the named `pre-<step>` branch is the restore point for each step, and it's kept until the step's watch period ends.
- **Each new Neon branch has a new host**, and the build session's network only allows named hosts. Expect one approval card per rehearsal (two hosts: direct and pooled).
- **One branch, one step at a time.** The build session pushes only to `claude/luvallplay-phase-3`, so each step's pull request opens after the previous one is merged.
- **Previews build again.** The nine stale `preview/claude/*` branches in the old US Neon project were deleted on 23 Nov. That project fills up again after about nine more previews; option A in the Phase 2 runbook §1 stops it recurring.
