# Rehearsal: 2026-11-phase3-tenants

- **Database:** ep-small-mud-a7sgrphk-pooler.ap-southeast-2.aws.neon.tech/neondb
- **Command:** node scripts/db/migrate.mjs
- **Duration:** 7.7s
- **Expectations:** scripts/data-guard/expectations/2026-11-phase3-tenants.json

**Result:** ✔ passed

| Level | Check | Detail | Count |
|---|---|---|---|
| info | TABLE_ADDED | New table club_members. |  |
| info | TABLE_ADDED | New table guardianships. |  |
| info | TABLE_ADDED | New table junior_profiles. |  |
| info | TABLE_ADDED | New table tenant_modules. |  |
| info | TABLE_ADDED | New table tenants. |  |
| info | SUMMARY | 17 accounts checked, 0 problems. |  |

## Checks after the migration, on the same branch

Branch `rehearsal-phase-3-tenants` of production (`three-wolves-sydney`, Postgres 18), created 23 Nov 2026 07:35 UTC.

| Check | Result |
|---|---|
| `scripts/tenants/verify.mjs` | 1 club (`three-wolves`, NZ/syd, Pacific/Auckland, NZD, online). 22 module rows, 22 on. 19 accounts, 19 club members (2 owners, 17 members). 2 `club_roles` rows and 2 platform admins, unchanged. Mirror drift: 0 |
| `scripts/tenants/verify.mjs --reconcile` | 0 rows written (the backfill is idempotent) |
| `db:migrate --drift` | No schema drift: the branch matches `docs/schema/production.sql` |
| `data-guard check` on the after snapshot | Passed. 17 live accounts, 17 signed in on at least one device. No `ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT` |

The 19 accounts are the 17 live ones plus 2 soft-deleted. The data guard's summary counts live accounts.

**Characterisation:** this step adds tables that no page or API reads, so every account's Me, membership, stats and rank views are served by the same queries on the same rows as before. The data guard's per-account row counts and column hashes for every existing table are identical before and after.
