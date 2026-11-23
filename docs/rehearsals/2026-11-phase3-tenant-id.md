# Rehearsal: 2026-11-phase3-tenant-id

- **Database:** ep-raspy-dream-a7a4zi58-pooler.ap-southeast-2.aws.neon.tech/neondb
- **Command:** node scripts/db/migrate.mjs
- **Duration:** 3.5s
- **Expectations:** scripts/data-guard/expectations/2026-11-phase3-tenant-id.json

**Result:** ✔ passed

| Level | Check | Detail | Count |
|---|---|---|---|
| info | SUMMARY | 17 accounts checked, 0 problems. |  |

## Checks on the same branch

Branch `rehearsal-phase-3-tenant-id` of production (`three-wolves-sydney`, Postgres 18), created 23 Nov 2026.

| Check | Result |
|---|---|
| Migration `0004_tenant_id_columns` | Applied in 1.5 s (54 tables, one statement) |
| `scripts/tenants/verify.mjs` | 1 club. 57 club-owned tables, 1,441 rows checked: every row has the club's `tenant_id`. 19 accounts, 19 club members, mirror drift 0 |
| `db:migrate --drift` | No schema drift |
| Characterisation, two baseline runs before the change | Identical (the check is deterministic) |
| **Characterisation, before vs after** | **Identical: 17 accounts, 12 views each, 6 club views** |

## What the characterisation check caught

The first after-run differed for 4 accounts, in one view: "Download my data". Its Arena section selected every column of `arena_pairs`, so the export gained a `tenant_id` field for anyone who has played in a pair. The query now names its columns (`lib/arena-db.ts`, `arenaExport`), and the comparison is identical.

The data guard can't see this kind of change (no stored value changed), which is why the characterisation check runs beside it.

**Consequence for the production run:** deploy the app version with the fix first, then run the migration. In the other order, those 4 members' exports would show the extra field until the deploy.

Every other query that selects whole rows (`arena`, `jersey`, `bank`, `shop`, `photos`, Vision passes) passes its rows through a mapper that picks named fields, so its output doesn't change.
