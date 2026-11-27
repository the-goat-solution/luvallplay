# Rehearsal: players' phone numbers sealed, with an index (`0020_players_contact_sealed`)

- **Change:** three new columns on `players`, all NULL: `phone_sealed` (the E.164 number, encrypted by the application for that one person), `phone_index` (a keyed fingerprint of the number, so it can still be looked up and kept unique) and `phone_index_kid` (which index key made it). Also a check that refuses anything in `phone_sealed` that isn't in the sealed format, a unique index on `phone_index` for verified live accounts (mirrors `players_phone_verified_idx`), and a trigger, `players_phone_sealed_follows_plain`, that clears the three columns whenever `phone_e164` changes without a new sealing in the same statement. Then a backfill seals the numbers already there. `phone`, `phone_e164` and `phone_verified_at` are not changed for anyone, and the app keeps reading them until `PII_READS` is switched.
- **Commands:** `node scripts/db/migrate.mjs`, then `node scripts/pii/backfill-phone.mjs` (dry run), then `node scripts/pii/backfill-phone.mjs --apply`
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-pii-phone-sealed.json` (and `.production.json` for the live run)
- **Number:** written as `0020`, the next free number today (`0019_junior_safety_checks` is the last); the migration queue gives the final number at merge.
- **What it does not do:** while the plain columns exist, sealing adds no secrecy; it prepares their removal, which is a later change. And phone numbers are few, so whoever holds `CONTACT_INDEX_KEYS` and a copy of the database can recover every number by trying them all: that key is as secret as the numbers.

## Result: the local rehearsal passed on synthetic data. The run on a copy of production, the schema drift suite, and every production step are still to do, and wait for the owner's OK.

**What this run was, said plainly:** 27 Nov 2026, a scratch database on this machine's Postgres 16 (there is no Postgres 18 here and no copy of production). The data was made up: the test fixture's 25 accounts plus 400 synthetic ones, with made-up numbers. The keys were throwaway keys made for the run, held only in the shell's environment and gone with it. Nothing touched Neon or any production system.

| Step | Result |
|---|---|
| Migrations `0000` to `0019`, then the synthetic accounts | 425 accounts: 228 with a phone number (218 different numbers: 10 unverified accounts hold a number a verified account also holds, which is allowed today), 104 verified, 22 deleted (no number, as the app leaves them) |
| Data guard snapshot, before | Passed (85 tables, 425 accounts) |
| Migration `0020_players_contact_sealed` | Applied in 9 ms. Sealed 0, indexed 0: the new columns start empty |
| Backfill, dry run | "228 account(s) have a phone number that isn't sealed yet." Nothing written |
| Backfill `--apply` with no keys set | Refused (exit 2), nothing written |
| Backfill `--apply` | 228 sealed, 0 failed, in two batches (200, then 28) |
| Backfill `--apply`, second time | 0 pending, 0 sealed; the sealed columns were byte-for-byte what the first run left |
| `count(*) WHERE phone_e164 IS NOT NULL` against `count(*) WHERE phone_index IS NOT NULL` | **228 and 228.** A number without an index: 0. An index or sealed text without a number: 0. A deleted account with anything sealed: 0 |
| The same number always has the same index | 218 different numbers, 218 different indexes; no number with two indexes |
| Verified live accounts | 104 different numbers, 104 different indexes (the new unique index holds what the old one holds) |
| Every sealed number opened for its own account and compared with the plain column | 228 matched, 0 wrong |
| `phone`, `phone_e164`, `phone_verified_at`, `email`, `deleted_at` of every account, before against after | Identical |
| Data guard, before `0020` against after the backfill, with the expectations | Passed: 403 live accounts checked, 0 problems |
| Data guard, after `0020` against after the backfill, with the expectations | Passed: 403 live accounts checked, 0 problems. Without the expectations it flags exactly the three new columns |
| The trigger: 5 accounts' numbers cleared with plain SQL | 5 rows cleared, nothing sealed left on them |
| Rollback (below), then a schema dump | The schema equals the one before `0020`; the migrator shows `0020` as pending again |
| `tests/pii-contact.test.ts` | Passes (20 of 20), on Postgres 16, including: every writer works as before on a database without the new columns while no key is set |
| Web journeys (`pnpm --filter web e2e`, local build, Postgres 16) | 51 of 51 pass with no contact key set (as CI runs them), and 51 of 51 again on the same build with throwaway `CONTACT_KEKS` and `CONTACT_INDEX_KEYS` set |
| `packages/db/schema.ts` against the migrations (tables and indexes, on Postgres 16) | No difference |
| Schema drift suite, and `db:drift` | **Not run here**: they need Postgres 18 (CI runs them). `docs/schema/production.sql` was extended by hand (18 lines added, none changed) from this run's dump: on Postgres 16 the dump after `0020` equals the new `production.sql` once the `NOT NULL` constraint lines that only Postgres 18 lists are set aside |

## Still to do

1. **CI on Postgres 18:** the schema drift suite against the new `docs/schema/production.sql`.
2. **The same run on a copy of production, on Postgres 18** (a local copy, or a Neon branch booked with lane T: the project is at 10 of 10 branches), with the data guard before and after, and real counts written here. The numbers above say the steps work; they say nothing about production's data.
3. **Production, in this order, each step only with the owner's OK, booked in the Phase 3 runbook's calendar.** The app names the new columns only once a key is set (or reads are switched), so this code can be deployed before the migration has run; a key set before the migration has run would break saving a profile, so the order matters:
   - `node scripts/db/migrate.mjs --production` for this migration: **PENDING**. Between the deploy and this step the admin System check shows "Migrations waiting to run". That is expected, and clears once the migration has run.
   - The two new settings, **the owner's to set** in the hosting environment's settings (never pasted into a chat, a ticket or a file): `CONTACT_KEKS` and `CONTACT_INDEX_KEYS`, each `id:base64key`, 32 bytes, newest first, their own keys (not a copy of any other purpose's), different per region: **PENDING**. Until both are set the app writes the plain columns only, as today.
   - `node scripts/pii/backfill-phone.mjs --apply --production`, with those two settings in the environment: **PENDING**. The settings in the operator's shell must be the deployed ones, bytes and all, not only the same key ids. Before it writes, the script checks them against rows already sealed and indexed under the same ids and refuses (exit 2, nothing written) when none agrees. On the very first run nothing is sealed yet, so it can't check: it says "No existing row could confirm CONTACT_KEKS and CONTACT_INDEX_KEYS" and goes ahead. **Then, once the servers have the keys, verify one sign-in by phone** (and, to be sure before `PII_READS=sealed`, have one account save its number through the app and run the backfill's dry run with the same shell: a later `--apply` now checks the shell's keys against that server-sealed row).
   - `PII_READS=sealed`, a week after the backfill: **PENDING**. Until then sign-in by phone reads the plain column exactly as before. **Right before switching, run the backfill's dry run again** (`node scripts/pii/backfill-phone.mjs`) and switch only when it reports 0: a number written or verified while the keys were unset (or whose sealing failed) has no index, and reading sealed wouldn't find it.
4. Dropping `phone` and `phone_e164` is not part of this plan. **A precondition for that later project, recorded here:** today "one verified account per number" is held by `players_phone_verified_idx` on the plain column, whichever index key is in use. Once that index is gone, the check `verifyPhone` makes across several index keys during a rotation is not safe against a race: two server instances with different key lists (mid-deploy) can each verify the same number for a different account, each under its own key's index, and the unique index on `phone_index` sees two different values. Before the plain columns are dropped, either `verifyPhone` takes a per-number advisory lock (in one transaction with its check and write), or verification is refused while more than one index key is listed.

## Rollback

Before `PII_READS=sealed`: nothing reads the new columns, so unset `CONTACT_KEKS` and `CONTACT_INDEX_KEYS` (the app goes back to writing the plain columns only) or leave everything as it is. After it: set `PII_READS=plain` (or remove it); the plain columns were never changed, so lookups work as before at once.

To remove the schema change as well (rehearsed above; the sealed copies are lost, the plain numbers are untouched, and the backfill can be run again later):

```sql
BEGIN;
DROP TRIGGER players_phone_sealed_follows_plain ON players;
DROP FUNCTION players_phone_sealed_follows_plain();
DROP INDEX players_phone_index_verified;
ALTER TABLE players DROP CONSTRAINT players_phone_sealed_check, DROP COLUMN phone_sealed, DROP COLUMN phone_index, DROP COLUMN phone_index_kid;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations); -- only if this migration is the last one applied
COMMIT;
```

Unset `CONTACT_KEKS`, `CONTACT_INDEX_KEYS` and `PII_READS` first: with any of them set the app names the three columns in its statements; with none set it doesn't, and runs on the schema as it was.
