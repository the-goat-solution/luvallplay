# Rehearsal: Phase 3b step 4, a child's emergency contacts and medical notes (`0016_junior_care`)

- **Change:** two new tables, `junior_emergency_contacts` and `junior_medical_notes`. Both are club-owned with row-level security from the first day, and every row must belong to a child in the same club. Nothing existing is altered. `junior_medical_notes` holds only sealed (encrypted) text; a check constraint refuses anything that isn't in the sealed format.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3b-junior-care.json`
- **Number:** written as `0016`; lane T's queue gives the final number at merge.

## Result: passed locally. The run on a copy of production, and the production run, are lane T's and wait for the owner's go-ahead.

Local run, 26 Nov 2026, Postgres 18 (the version production and CI use):

| Check | Result |
|---|---|
| Migration `0016_junior_care` | Applied in 32 ms on a database built from migrations `0000` to `0015` |
| Schema drift suite | Passes (10 of 10): migrations, `packages/db/schema.ts` and `docs/schema/production.sql` describe the same schema. `production.sql` was regenerated from this run (57 lines added, none changed) |
| `tests/juniors-care.test.ts` | Passes (10 of 10), including: the database refuses a plain-text note; a note copied to another child's row can't be opened; the app's database role sees the rows only inside the child's club |
| Whole web test suite | 804 passed, 0 failed |

**Still to do (lane T's queue):** the same run on a fresh Neon copy of production with the data guard before and after. Both tables are new and empty, so the guard should report no change for any account.

## A new secret before the feature is used

Medical notes are encrypted with keys from `JUNIORS_KEKS` (the format of `INTEGRATIONS_KEKS`: `id:base64key`, 32 bytes, newest first). With no key set, a note can't be saved or read and nothing is stored in plain text. No deployment needs the key while Juniors is hidden. Setting it for a real club is a production setting and the owner's decision.

## Rollback

Both tables are new and empty while Juniors is hidden:

```sql
DROP TABLE junior_medical_notes;
DROP TABLE junior_emergency_contacts;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1); -- only if 0016 is the last one applied
```
