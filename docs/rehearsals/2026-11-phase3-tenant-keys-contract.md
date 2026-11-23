# Rehearsal: Phase 3 step 11 preparation, the old single-club keys go (`0011_tenant_keys_contract`)

- **Change:** the old keys that assumed one club are dropped and the per-club keys built in `0010` take their names: 5 unique indexes, 2 unique constraints, 13 primary keys. The foreign keys from `bookings` and `session_alert_state` to a play day carry the club. No row changes.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3-tenant-keys-contract.json`

## Result: passed

Branch `rehearsal-phase-3` of production (`three-wolves-sydney`, Postgres 18), 24 Nov 2026 (UTC 23 Nov), reset to a fresh copy of production before the run.

| Check | Result |
|---|---|
| Data guard, before and after | **18 accounts checked, 0 problems.** Nothing changed |
| Migration `0011_tenant_keys_contract` | Applied in 7.7 s |
| Characterisation, as today (owner) | 18 live accounts (12 views each) and 6 club views: **identical** to before the migration |
| Characterisation, **through row-level security** (`TENANT_SCOPE=enforce`) | **Identical.** The first attempt of this run stopped before writing its file (cause not captured); the second completed |
| `db:migrate --drift` | No schema drift. `docs/schema/production.sql` was regenerated from this branch |
| `scripts/tenants/verify.mjs` | Consistent |

## Rollback

Restoring the old keys is the reverse, per key: drop the per-club constraint or index and create the old one (`PRIMARY KEY (date)` and so on; the definitions are in `0000`–`0010`), then put the two foreign keys back on `(session_date)`. With one club in the database every old key still holds. Or restore the named branch `pre-phase-3-tenant-keys-contract`.

**The app version before #114 can't run on this schema** (its upserts name the old keys). Rolling the app back past #114 needs this migration rolled back first.
