# Rehearsal: Phase 3 step 4, Three Wolves' Vietnamese term in its settings (`0008_terms_localized`)

- **Change:** one row of `tenants`: `terms` gains `localized.vi.points_name = "Điểm Sói"`. Nothing is removed.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3-terms-localized.json`

## Result: passed

Branch `rehearsal-phase-3` of production, 23 Nov 2026, reset to a fresh copy of production before the run.

| Check | Result |
|---|---|
| Data guard, first run | **Failed, as it should:** `tenants.terms` and `tenants.updated_at` changed and the expectations didn't say so. Both are now declared, each with its reason |
| Data guard, second run (fresh copy) | **17 accounts checked, 0 problems** |
| Migration | Applied in under 4 s |
| Characterisation | 17 live accounts (12 views each) and 6 club views: baseline taken twice, **identical after** |
| `db:migrate --drift` | No schema drift (the migration changes data only) |
| `scripts/tenants/verify.mjs` | Consistent |

## Rollback

`UPDATE tenants SET terms = terms - 'localized' WHERE slug = 'three-wolves';` The app then uses the club's single name in Vietnamese ("Wolf Points") until the key is back; while `CLUB_SETTINGS_SOURCE` is `shadow` or unset the built-in names answer and nothing visible changes.
