# Rehearsal: the Social tables, blocks and suspensions (`0022_social_moderation`)

- **Change:** eight new, empty tables and two functions. Nothing existing is altered.
  - `social_profiles`, `social_follows`, `social_posts`, `social_comments`, `social_kudos`, `social_club_bans`: Social's own. `user_blocks`: one person blocks another (shared with the Marketplace).
  - `player_suspensions`: a moderator's decisions about a person. Insert only: the app's role can add and read rows and can't update or delete them; a lift or a change is a new row and the latest row wins. It names the account by id **without a foreign key** and keeps keyed indexes of the email and phone the account had (never the values), so a row stands when the account is deleted and the same email or phone signing up again is found.
  - `social_clubs_of(player_id)` and `shares_social_club(a, b)`: `SECURITY DEFINER` with a fixed search path, as `link_account_to_rows` is (`0007`), callable by `luvallplay_app` only. They read `club_members` and `tenant_modules` across clubs, which row-level security otherwise hides from the app's role.
  - All eight tables are platform-wide, like `player_sessions`: no `tenant_id`, no row-level security. Where a row sits in one club's space the column is `club_id`.
- **Command:** `node scripts/db/migrate.mjs`
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-12-social-moderation.json` (and `.production.json` for the live run)
- **Number:** written as `0022`; the migration queue gives the final number at merge.
- **Hidden:** nothing reads or writes these tables until a club is on the Social pilot list (`SOCIAL_PILOT_TENANTS`, empty). Applying the migration switches nothing on.
- **Not in this migration:** `content_reports`, `moderation_actions`, `moderation_evidence` (Task 2b, the next migration) and `player_photos.purpose` (Task 4, lane H).

## Result: the local rehearsal passed on synthetic data. The run on a copy of production, the schema drift suite, and the production run are still to do.

**What this run was, said plainly:** 27 Nov 2026, a scratch database on this machine's **Postgres 16.15**. It was **not** a Neon branch, **not** Postgres 18, and **not** a copy of production: the data was the test fixture's 25 made-up accounts (468 rows in all). Nothing touched Neon, Vercel or any production system.

| Step | Result |
|---|---|
| Migrations `0000` to `0021`, then the fixture | 95 tables, 468 rows |
| Data guard snapshot, before | Taken (exit 0) |
| Migration `0022_social_moderation` | Applied in 42 ms |
| Tables before and after | **95 before, 103 after.** New: `player_suspensions`, `social_club_bans`, `social_comments`, `social_follows`, `social_kudos`, `social_posts`, `social_profiles`, `user_blocks`. Gone: none |
| The 95 existing tables, row count and a hash of every row, before against after | Identical |
| The eight new tables | 0 rows each |
| Data guard, before against after, with the expectations | Passed: 24 live accounts checked, 0 problems. It reports the eight new tables and nothing else; without the expectations file the result is the same |
| Migrating a second time | **A no-op:** nothing applied, 103 tables, the history still has 23 rows |
| The app's role on `player_suspensions` | `SELECT` and `INSERT` yes; `UPDATE` and `DELETE` no |
| The two functions | Both `SECURITY DEFINER`, `search_path=public, pg_temp`; the app's role may call them, `PUBLIC` may not. Called as the app's role scoped to club 1 with Social's module row on: `social_clubs_of(3)` gives `{1}`, `shares_social_club(3, 4)` is true |
| Rollback (below), then a schema dump | The schema equals the one before `0022` (95 tables); the migrator applies `0022` again afterwards |
| `tests/moderation.test.ts` | Passes (42 of 42) on Postgres 16, each database test once as the owner and once under `TENANT_SCOPE=enforce` with two clubs |
| `packages/db/schema.ts` against the migrations (tables and indexes, on Postgres 16) | No difference |
| Schema drift suite, and `db:drift` | **Not run here**: they need Postgres 18 (CI runs them). `docs/schema/production.sql` was extended from this run's dump (195 lines added, none changed): on Postgres 16 the dump after `0022` equals the new `production.sql` once the `NOT NULL` constraint lines that only Postgres 18 lists are set aside. Those lines for the eight new tables were written to the pattern of the existing tables and have not been checked against a real Postgres 18 |

### One thing the rehearsal had to work around

On this branch, `0021`'s date in `meta/_journal.json` is in the future (1795784505209; the run was at about 1795770290000). The migrator orders by that date, so on a database already at `0021` it refuses `0022` ("was changed after it was applied"): tried here, and it does. A database migrated from empty is not affected, which is why the tests pass. The fix is on the base branch (it moves `0021`'s date back and adds `tests/migration-journal.test.ts`) and is merged in after this task. For this rehearsal only, `0021`'s date was moved back **in memory** in a scratch script; no committed file was changed for it. `0022`'s own date is the real time it was written. **Run the `0021` to `0022` step again with the plain command once that fix is merged.**

## Still to do

1. The same run with the plain `node scripts/db/migrate.mjs` after the journal fix is merged (above).
2. The schema drift suite on Postgres 18 (CI).
3. A run on a copy of production on Postgres 18 with the data guard before and after (a Neon branch when one is booked with lane T; Neon is at 10 of 10 branches). All eight tables are new and empty, so the guard should report no change for any account.
4. Lane T's agreement on the two `SECURITY DEFINER` functions before the migration merges (Social plan, Task 3 code review): **agreement pending**. They rely, as `link_account_to_rows` does, on the tables' owner not being bound by row-level security (`BYPASSRLS` on production's owner; checked there for `0007`).
5. The production run itself, with the owner's OK. Nothing depends on it until a pilot club is listed.

## Settings

No new setting. Suspensions use `CONTACT_INDEX_KEYS` (the encryption build's index keys) with their own purposes, `suspension.email` and `suspension.phone`. With no key set a suspension is still written and holds for the account only. **An index key that made suspension rows has to stay in the list** for as long as those rows should match by email or phone: the rows can't be re-indexed (nothing may update them, and after a deletion the email is gone). `index_kid` on each row says which key that is.

## Rollback

All eight tables are new and nothing writes to them until Social is switched on for a pilot club:

```sql
DROP FUNCTION shares_social_club(integer, integer);
DROP FUNCTION social_clubs_of(integer);
DROP TABLE social_kudos;
DROP TABLE social_comments;
DROP TABLE social_posts;
DROP TABLE social_follows;
DROP TABLE social_club_bans;
DROP TABLE user_blocks;
DROP TABLE social_profiles;
DROP TABLE player_suspensions;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1); -- only if 0022 is the last one applied
```

Once Social is on for anyone, `player_suspensions` is a record that must be kept: don't drop it then; roll forward instead.
