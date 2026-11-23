# Rehearsal: Phase 3 step 9, plans and usage (`0006_entitlements`)

- **Change:** three new tables (`plans`, `club_plans`, `usage_counters`), one plan row (`nz-badminton-free`) and one `club_plans` row (Three Wolves). Additive only.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3-entitlements.json`

## Result: passed

Branch `rehearsal-phase-3` of production (`three-wolves-sydney`, Postgres 18), 23 Nov 2026, reset to a fresh copy of production before the run.

| Check | Result |
|---|---|
| Data guard, before and after | **17 accounts checked, 0 problems.** Three tables added; nothing else changed |
| Migration `0006_entitlements` | Applied in 3.5 s (5.6 s with the snapshots' connection time) |
| Characterisation check | 17 live accounts (12 views each) and 6 club views: baseline taken twice (identical), and **identical after the migration** |
| `db:migrate --drift` | No schema drift. `docs/schema/production.sql` was regenerated from this branch after the migration: 71 lines added, none removed |
| `scripts/tenants/verify.mjs` | Consistent: 453 email-linked rows, 287 linked, 166 without an account, no disagreement; mirror drift 0 |

## Rollback

The change adds tables nothing else points at. Rollback is `DROP TABLE usage_counters, club_plans, plans;` and removing the migration's row from the migrations table, or restoring the named branch `pre-phase-3-entitlements`. The app reads these tables only through `lib/entitlements.ts`, which allows everything when it can't read them.
