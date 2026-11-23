# Rehearsal: Phase 3 step 4, Three Wolves' seat titles in its settings (`0009_terms_seats`)

- **Change:** one row of `tenants`: `terms` gains `alpha_name`, `silver_name` and their Vietnamese forms under `localized.vi`. Nothing is removed.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3-terms-seats.json` (the change to `tenants.terms` and `tenants.updated_at` is declared, each with its reason)

## Result: passed

Branch `rehearsal-phase-3` of production, 23 Nov 2026, reset to a fresh copy of production before the run.

| Check | Result |
|---|---|
| Data guard | **18 accounts checked, 0 problems** (one more account than earlier today: someone signed up) |
| Characterisation | 18 live accounts (12 views each) and 6 club views: baseline taken twice, **identical after** |
| `db:migrate --drift` | No schema drift (the migration changes data only) |
| `scripts/tenants/verify.mjs` | Consistent |

## Rollback

`UPDATE tenants SET terms = (terms - 'alpha_name' - 'silver_name') #- '{localized,vi,alpha_name}' #- '{localized,vi,silver_name}' WHERE slug = 'three-wolves';` While `CLUB_SETTINGS_SOURCE` is `shadow` or unset the built-in names answer, so nothing visible changes either way.
