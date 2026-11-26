# Rehearsal: Phase 3b step 7, deletion requests and anonymous payment records (`0020_junior_deletion`)

- **Change:** two new tables. `junior_deletion_requests`: a guardian's request to delete a child's information, waiting for an owner or admin of the club; once confirmed the row no longer points at a child. `junior_payment_records`: for each paid booking of a deleted child, the payment's id, amount, currency and club, and nothing else. Both club-owned with row-level security from the first day. Nothing existing is altered. The app's database role can't delete a request, and can't change or delete a payment record.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3b-junior-deletion.json` (and `.production.json` for the production run)
- **Number:** `0020`, as the coordinator asked; lane T rehearses and runs it.

## Result: passed locally. The run on a copy of production, and the production run, are lane T's and wait for the owner's go-ahead.

Local run, 26 Nov 2026, Postgres 18 (the version production and CI use):

| Check | Result |
|---|---|
| Migration `0020_junior_deletion` | Applied in 13 ms on a database built from migrations `0000` to `0019` |
| Schema drift suite | Passes: migrations, `packages/db/schema.ts` and `docs/schema/production.sql` describe the same schema. `production.sql` was regenerated from this run (47 lines added, none changed) |
| `tests/juniors-rights.test.ts` | Passes (6 of 6), including: after a confirmed deletion no row about the child remains in any junior table; the surviving request points at no child; the payment record has no child, guardian or day column; the app's database role can't delete a request or change a payment record |
| Whole web test suite | 848 passed, 0 failed |

**Still to do (lane T's queue):** the same run on a fresh Neon copy of production with the data guard before and after. Both tables are new and empty, so the guard should report no change for any account.

## A note for the data guard once Juniors is on

A confirmed deletion removes a child's rows on purpose, at run time (not in a migration). When Juniors is on for a real club, a data-guard comparison across such a deletion will report that child as gone. That is correct; the comparison needs the per-person allowance (`allowRowDecrease` with `people`) for that child's id. Nothing to do while Juniors is hidden.

## Rollback

Both tables are new and empty while Juniors is hidden:

```sql
DROP TABLE junior_payment_records;
DROP TABLE junior_deletion_requests;
```

Then remove the migration's row from the migrations table, if `0020` is the last one applied.
