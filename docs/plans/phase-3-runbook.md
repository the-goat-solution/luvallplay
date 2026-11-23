# Phase 3 runbook: the steps that need you

Phase 3 (multi-tenant core, build plan §6) ships as twelve small steps. The code for each is built and tested in its pull request. This file lists what needs your decision or sign-off, and records every data-guard result. Each step says what "done" looks like.

---

## Status (23 Nov 2026)

| Step | What | State |
|---|---|---|
| 0 | Plan documents to `main` (#100, docs only) | **Needs you: merge #100** |
| 1 | Tenants schema, Three Wolves as club #1 (#101) | Built. Rehearsal passed (0 problems). **Needs you: sign-off and the OK for the production run** (§1) |
| 2 | `tenant_id` columns, nullable, backfilled in batches | Not started |
| 3 | Email links → `user_id` | Not started. Precondition met today: no `ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT` on the 23 Nov branch |
| 4 | Settings replace constants (behind flags) | Not started |
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

## 2. Housekeeping that needs you

- **Stale rehearsal branches hold real data.** `rehearsal-phase-2` (23 Nov, 00:54 UTC) is still in the Neon project, and this phase adds `rehearsal-phase-3-tenants`. The test plan says to delete rehearsal branches after use. Say the word and the session deletes both once #101 has run on production, or delete them in the Neon console.
- **Branch limit.** The Neon free plan allows 10 branches per project. Today there are 6 (main, `pre-phase-1`, `pre-phase-2-data`, `pre-phase-2-data-run`, and the two rehearsal branches). Each Phase 3 data step adds a restore point and a rehearsal branch. The older `pre-phase-*` restore points can go once you're happy with Phase 1 and 2.
- **Point-in-time restore covers 6 hours, not 7 days.** The project's history retention is 21,600 seconds (the free plan's limit). Test plan §4.4 asks for a window that covers the next 7 days. Until the plan changes, the named `pre-<step>` branch is the restore point for each step, and it's kept until the step's watch period ends.
- **Each new Neon branch has a new host**, and the build session's network only allows named hosts. Expect one approval card per rehearsal (two hosts: direct and pooled).
- **One branch per step.** The build session may only push to `claude/luvallplay-phase-3`. Small, separately revertable pull requests need a branch each. Until you allow more branches (for example `claude/luvallplay-phase-3-*`), each step waits for the previous pull request to merge.
