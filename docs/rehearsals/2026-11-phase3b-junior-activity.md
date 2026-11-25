# Rehearsal: Phase 3b step 1, where a junior's activity lives (`0012_junior_activity`)

- **Change:** two new, empty, club-owned tables (`junior_bookings`, `junior_attendance`) with row-level security, and a unique constraint on `junior_profiles (tenant_id, id)`, a table that is empty in production. No row changes.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3b-junior-activity.json`

## Result: passed

Branch `rehearsal-phase-3` of production (`three-wolves-sydney`, Postgres 18), 24 Nov 2026, reset to a fresh copy of production before the run.

| Check | Result |
|---|---|
| Data guard, before and after | **18 accounts checked, 0 problems.** Two tables added, nothing else changed |
| Migration `0012_junior_activity` | Applied in 3.3 s |
| Characterisation | 18 live accounts (12 views each) and 6 club views: **identical**. Existing adults see no change |
| `db:migrate --drift` | No schema drift. `docs/schema/production.sql` was regenerated from this branch |
| `scripts/tenants/verify.mjs` | Consistent, including row-level security on the two new tables (61 club-owned tables) |

## Rollback

```sql
DROP TABLE junior_attendance, junior_bookings;
ALTER TABLE junior_profiles DROP CONSTRAINT junior_profiles_tenant_id_id_key;
```

and remove the migration's row. Nothing else points at these tables, and nothing in the app reads them yet.
