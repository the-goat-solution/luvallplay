# Rehearsal: Phase 3 step 10, required club id and row-level security (`0007_tenant_rls`)

- **Change:** `tenant_id` becomes `NOT NULL` with a foreign key to `tenants` (`ON DELETE RESTRICT`) on the 54 club-owned tables that got the column in step 2; the role `luvallplay_app` is created (no login, no `BYPASSRLS`); row-level security is enabled and forced, with one policy, on all 59 club-owned tables. No row changes.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3-tenant-rls.json`

## Result: passed

Branch `rehearsal-phase-3` of production (`three-wolves-sydney`, Postgres 18), 23 Nov 2026, reset to a fresh copy of production before the run.

| Check | Result |
|---|---|
| Data guard, before and after | **17 accounts checked, 0 problems.** Nothing changed |
| Migration `0007_tenant_rls` | Applied in 2.1 s |
| The owner role | `neondb_owner` has `BYPASSRLS`, so the live app (which connects as the owner) is not affected by the policies |
| Characterisation, as today (owner) | 17 live accounts (12 views each) and 6 club views: **identical** to the baseline |
| Characterisation, **through row-level security** (`TENANT_SCOPE=enforce`) | **Identical** to the baseline: on real data, every account sees exactly what it sees today |
| Shadow reads (`TENANT_SCOPE=shadow`, every read run twice) | First run: one statement reported, the same rows in a different order (it has no `ORDER BY`). Shadow reads now compare rows as a set; second run: **no difference recorded** |
| `db:migrate --drift` | No schema drift. `docs/schema/production.sql` was regenerated from this branch; it now includes a row-level security section |
| `scripts/tenants/verify.mjs` | Consistent, including the new check: the app's role sees exactly the club's rows in all 59 tables, and none with no club named |

## Rollback

```sql
-- Per table (the list is CLUB_OWNED_TABLES):
DROP POLICY tenant_isolation ON <table>;
ALTER TABLE <table> NO FORCE ROW LEVEL SECURITY;
ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;
ALTER TABLE <table> DROP CONSTRAINT <table>_tenant_id_tenants_id_fk;   -- the 54 added here
ALTER TABLE <table> ALTER COLUMN tenant_id DROP NOT NULL;              -- the same 54
-- Then:
ALTER FUNCTION link_account_to_rows() SECURITY INVOKER;
DROP FUNCTION app_tenant_id();
```

Or restore the named branch `pre-phase-3-tenant-rls`. The live app doesn't depend on any of it until `TENANT_SCOPE` is set.
