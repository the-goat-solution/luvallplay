# Rehearsal: Phase 3b step 4, a club's forms and waivers (`0017_club_forms`)

- **Change:** two new tables, `club_forms` (a club's forms, one row per version of the words) and `form_signatures` (which guardian signed which version for which child). Both are club-owned with row-level security from the first day. Nothing existing is altered. The app's database role may not delete a form or edit a signature.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3b-club-forms.json`
- **Number:** written as `0017`; lane T's queue gives the final number at merge.

## Result: passed locally. The run on a copy of production, and the production run, are lane T's and wait for the owner's go-ahead.

Local run, 26 Nov 2026, Postgres 18 (the version production and CI use):

| Check | Result |
|---|---|
| Migration `0017_club_forms` | Applied in 21 ms on a database built from migrations `0000` to `0016` |
| Schema drift suite | Passes: migrations, `packages/db/schema.ts` and `docs/schema/production.sql` describe the same schema. `production.sql` was regenerated from this run (64 lines added, none changed) |
| `tests/juniors-forms.test.ts` | Passes (8 of 8), including: the app's database role sees the rows only inside the club, can't edit a signature and can't delete a form |
| Whole web test suite | 812 passed, 0 failed |

**Still to do (lane T's queue):** the same run on a fresh Neon copy of production with the data guard before and after. Both tables are new and empty, so the guard should report no change for any account.

## Rollback

Both tables are new and empty while Juniors and Forms & waivers are hidden:

```sql
DROP TABLE form_signatures;
DROP TABLE club_forms;
```

Then remove the migration's row from the migrations table, if `0017` is the last one applied.
