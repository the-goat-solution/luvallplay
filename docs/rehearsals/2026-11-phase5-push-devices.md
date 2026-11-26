# Rehearsal: Phase 5 step 6, where push notifications go (`0018_push_devices`)

- **Change:** two new tables, `push_devices` and `push_prefs`. Both are platform-wide like `player_sessions` (a device belongs to a person's account, not to a club), so they have no `tenant_id`; every query goes through the signed-in person's id (`apps/web/lib/push/devices.ts`). Nothing existing is altered. `push_devices` holds a device's address only sealed (encrypted), plus a SHA-256 of it; check constraints refuse anything that isn't in the sealed format.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase5-push-devices.json`
- **Number:** written as `0018` (lane J's club forms hold `0017`); lane T's queue gives the final number at merge.

## Result: the library's tests pass locally. The schema drift suite, the run on a copy of production, and the production run are CI's and lane T's, and wait for the owner's go-ahead.

Local run, 26 Nov 2026, Postgres 16 (this machine has no Postgres 18):

| Check | Result |
|---|---|
| Migration `0018_push_devices` | Applied on a database built from migrations `0000` to `0016` |
| `tests/push-devices.test.ts` | Passes (11 of 11), including: with no key nothing is stored; the database refuses a plain address; one person can't read or remove another's devices; a row copied under another person can't be opened; a phone that signs in as someone else stops receiving the first person's notifications; nothing is sent for a kind the person didn't turn on |
| Schema drift suite | **Not run here**: it needs Postgres 18 (CI runs it). `docs/schema/production.sql` was extended by hand-checked generation from this run (39 lines added, none changed) |

**Still to do (lane T's queue):** the same run on a fresh Neon copy of production with the data guard before and after. Both tables are new and empty, so the guard should report no change for any account.

## A new secret before the feature is used

A device's address is sealed with keys from `PUSH_KEKS` (the format of `INTEGRATIONS_KEKS`: `id:base64key`, 32 bytes, newest first; its own keys, so a leak of one purpose's key opens nothing else). With no key set, no device can be registered and nothing is stored. No deployment needs the key until a store app exists. Setting it is a production setting and the owner's decision; it is set in the hosting environment settings and never pasted into a chat.

## Rollback

Both tables are new and nothing registers until a store app exists:

```sql
DROP TABLE push_prefs;
DROP TABLE push_devices;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1); -- only if 0018 is the last one applied
```
