# Rehearsal: 2026-11-phase3-user-id-links

- **Database:** ep-plain-glade-a74st6to-pooler.ap-southeast-2.aws.neon.tech/neondb
- **Command:** node scripts/db/migrate.mjs
- **Duration:** 7.0s
- **Expectations:** scripts/data-guard/expectations/2026-11-phase3-user-id-links.json

**Result:** ✔ passed

| Level | Check | Detail | Count |
|---|---|---|---|
| info | SUMMARY | 17 accounts checked, 0 problems. |  |

## Checks on the same branch

Branch `rehearsal-phase-3-user-id-links` of production (`three-wolves-sydney`, Postgres 18), 23 Nov 2026. The branch was reset to a fresh copy of production before this run (see below).

| Check | Result |
|---|---|
| Migration `0005_user_id_links` | Applied in 4.9 s |
| `scripts/tenants/verify.mjs` | 10 email-linked tables, 453 rows: 287 linked to an account, 166 for people without one. **No row where `user_id` and the email disagree.** All 11 triggers present. 1 club, 19 accounts, mirror drift 0 |
| `db:migrate --drift` | No schema drift (tables, functions and triggers) |
| Characterisation, two baseline runs before the change | Identical |
| **Characterisation, before vs after** | **Identical: 17 accounts, 12 views each, 6 club views** |

Before the change, all 10 active memberships belonged to a live account, so there was no `ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT` to resolve (test plan §4.5).

## What the first rehearsal found

The first run passed the data guard, but the characterisation check differed for one account, in "Download my data".

**Cause:** that member has two bookings on the same play day, and the export sorted bookings by date only. The backfill rewrites each linked row, which changes the order Postgres stores them in, so the two tied rows came out the other way round. Same rows, same content, different order.

**Fix:** every list in the export now has a full sort order, with the row's id as the tie-breaker (`lib/player-export.ts`). The export is then the same every time, whatever order rows are stored in.

**Proof:** the branch was reset to a fresh copy of production and the whole rehearsal run again with the fix in place: before and after are identical.

**On production** the migration runs before the app with the fix deploys (the typed queries need the columns first). In those few minutes that one member's export may list the two tied bookings in either order, as it always could.
