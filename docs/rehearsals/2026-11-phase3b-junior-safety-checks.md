# Rehearsal: Phase 3b step 6, safety checks for people who work with juniors (`0018_junior_safety_checks`)

- **Change:** one new table, `junior_safety_checks`: that a coach or volunteer has a safety check, its kind, the club's own reference, the day it was done and the day it expires. Club-owned with row-level security from the first day. Nothing existing is altered. The app's database role can't delete a record (a check is withdrawn, never deleted).
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3b-junior-safety-checks.json` (and `.production.json` for the production run)
- **Number:** written as `0018`. Lane N's #223 also uses `0018`; lane T's queue gives the final number at merge.

## Result: passed locally. The run on a copy of production, and the production run, are lane T's and wait for the owner's go-ahead.

Local run, 26 Nov 2026, Postgres 18 (the version production and CI use):

| Check | Result |
|---|---|
| Migration `0018_junior_safety_checks` | Applied in 12 ms on a database built from migrations `0000` to `0017` |
| Schema drift suite | Passes: migrations, `packages/db/schema.ts` and `docs/schema/production.sql` describe the same schema. `production.sql` was regenerated from this run (36 lines added, none changed) |
| `tests/juniors-safety.test.ts` | Passes (7 of 7), including: rows visible only inside the club; a record can't be deleted |
| Whole web test suite | 818 passed, 0 failed |

**Still to do (lane T's queue):** the same run on a fresh Neon copy of production with the data guard before and after. The table is new and empty, so the guard should report no change for any account.

## Rollback

The table is new and empty while Juniors is hidden:

```sql
DROP TABLE junior_safety_checks;
```

Then remove the migration's row from the migrations table, if it is the last one applied.
