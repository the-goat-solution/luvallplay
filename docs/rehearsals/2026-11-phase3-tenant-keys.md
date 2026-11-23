# Rehearsal: Phase 3 step 11 preparation, keys and defaults per club (`0010_tenant_keys`)

- **Change:** `tenant_id`'s default on the 54 club-owned tables that have one becomes `COALESCE(app_tenant_id(), 1)`; 20 natural keys that assumed one club get a second unique index that starts with `tenant_id`. Expand only: nothing is dropped. No row changes.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3-tenant-keys.json`

## Result: passed

Branch `rehearsal-phase-3` of production (`three-wolves-sydney`, Postgres 18), 23 Nov 2026, reset to a fresh copy of production before the run.

| Check | Result |
|---|---|
| Data guard, before and after | **18 accounts checked, 0 problems.** Nothing changed |
| Migration `0010_tenant_keys` | Applied in 6.0 s (20 small index builds) |
| The version live today, on the migrated copy | 18 live accounts (12 views each) and 6 club views: works, which is what "expand only" promises |
| The new version, on the migrated copy | **Identical** to the version live today |
| The new version, **through row-level security** (`TENANT_SCOPE=enforce`) | **Identical** |
| `db:migrate --drift` | No schema drift. `docs/schema/production.sql` was regenerated from this branch |
| `scripts/tenants/verify.mjs` | Consistent |

**Finding, and why the order matters:** the new version against the copy *before* the migration fails on the calendar view for every account, because its upserts name keys that don't exist yet. This is the rule already in the runbook: migrate first, then merge.

## Rollback

```sql
-- Per key (the list is in the migration):
DROP INDEX <name>;
-- Per table (the 54 in the migration's list):
ALTER TABLE <table> ALTER COLUMN tenant_id SET DEFAULT 1;
```

Only after the app is back on the previous version, which doesn't name the new keys. Or restore the copy taken before the run.
