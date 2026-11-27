# Rehearsal: the Social tables, blocks and suspensions (`0022_social_moderation`), then reports, actions and evidence (`0023_moderation_reports`)

Two migrations, one note. `0022` first; `0023` is under "The second migration" below.

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

### The step from `0021` to `0022`, with the plain command

The first run of this rehearsal could not use the plain command for this step: on the branch as it was, `0021`'s date in `meta/_journal.json` was in the future, and the migrator, which orders by that date, refused `0022` on a database already at `0021` ("was changed after it was applied"). That run moved `0021`'s date back in memory in a scratch script. The fix has since been merged (it moves `0021`'s date back in the journal and adds `tests/migration-journal.test.ts`), and the step was run again, 27 Nov 2026, with nothing worked around:

| Step | Result |
|---|---|
| A scratch database migrated to `0021` (`node scripts/db/migrate.mjs --to 0021`), then the fixture | 95 tables, 468 rows |
| `node scripts/db/migrate.mjs --to 0022` | `applied 0022_social_moderation (52 ms)`; 103 tables. (`--to` only because `0023` exists by now and has its own step below) |

## Still to do

1. The schema drift suite on Postgres 18 (CI), for both migrations.
2. A run on a copy of production on Postgres 18 with the data guard before and after (a Neon branch when one is booked with lane T; Neon is at 10 of 10 branches). All eleven tables are new and empty, so the guard should report no change for any account.
3. Lane T's agreement on the two `SECURITY DEFINER` functions before the migration merges (Social plan, Task 3 code review): **agreement pending**. They rely, as `link_account_to_rows` does, on the tables' owner not being bound by row-level security (`BYPASSRLS` on production's owner; checked there for `0007`).
4. The production run itself, with the owner's OK. Nothing depends on it until a pilot club is listed.

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
DELETE FROM drizzle.__drizzle_migrations WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1); -- only if 0022 is the last one applied (roll 0023 back first, below)
```

Once Social is on for anyone, `player_suspensions` is a record that must be kept: don't drop it then; roll forward instead.

## The second migration: `0023_moderation_reports`

- **Change:** three new, empty tables. Nothing existing is altered.
  - `content_reports`: a person reports a profile, a post or a comment (later a listing or a question). The row names the target by type and id and holds no content. What the reporter wrote is kept only sealed (`details_sealed`, `MODERATION_KEKS`, bound to the report's id); the column's check takes nothing but the sealed format. `queue` is `club` or `platform`; a serious report can't be in a club's queue, and a club's queue needs a club. One open report per reporter per target (a partial unique index). `reporter_id` is a foreign key to `players` (`RESTRICT`, as every key to `players` is) and is set to `NULL` when the reporter deletes their account. `alerted_at` remembers that the moderators were told a deadline was near.
  - `moderation_actions`: what a moderator did, one row each: ids, the action and a short reason. Insert only.
  - `moderation_evidence`: for a `child_safety` report, a sealed copy of the content and the author's account id. Insert only. One row per report.
  - `moderation_actions` and `moderation_evidence` name accounts by id **without a foreign key**, as `player_suspensions` does, so they stand when an account is deleted. A report can't be deleted while an action or evidence points at it (`RESTRICT`).
  - All three are platform-wide: no `tenant_id`, no row-level security. The club column is `club_id`.
- **Command:** `node scripts/db/migrate.mjs`
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-12-moderation-reports.json` (and `.production.json` for the live run)
- **Number:** written as `0023`; the migration queue gives the final number at merge.
- **Hidden:** nothing reads or writes these tables until a club is on the Social pilot list.

### Result: the local rehearsal passed on synthetic data. The run on a copy of production, the schema drift suite, and the production run are still to do (the list above covers both migrations).

**What this run was, said plainly:** 27 Nov 2026, the same scratch database as the `0021` to `0022` step above, on this machine's **Postgres 16.15**. Not a Neon branch, not Postgres 18, not a copy of production: the test fixture's 25 made-up accounts (468 rows). Nothing touched Neon, Vercel or any production system. The command was the plain one, from a database at `0022`.

| Step | Result |
|---|---|
| The database at `0022`, with the fixture | 103 tables, 468 rows |
| Data guard snapshot, before | Taken (exit 0) |
| `node scripts/db/migrate.mjs` | `applied 0023_moderation_reports (14 ms)`, exit 0 |
| Tables before and after | **103 before, 106 after.** New: `content_reports`, `moderation_actions`, `moderation_evidence`. Gone: none |
| The 103 existing tables, row count and a hash of every row, before against after | Identical |
| The three new tables | 0 rows each |
| Data guard, before against after, with the expectations | Passed: 24 live accounts checked, 0 problems. It reports the three new tables and nothing else; without the expectations file the result is the same |
| Migrating a second time | **A no-op:** "Nothing to migrate: the database is up to date."; the history has 24 rows |
| The app's role | `content_reports`: `SELECT`, `INSERT`, `UPDATE`, `DELETE`. `moderation_actions` and `moderation_evidence`: `SELECT` and `INSERT` yes; `UPDATE` and `DELETE` no (tried as the role: "permission denied for table moderation_actions"). `TRUNCATE` on none of the three |
| Rollback (below), then a schema dump | The schema equals the one before `0023` (103 tables); the migrator applies `0023` again afterwards (10 ms) |
| `tests/moderation-reports.test.ts` | Passes (35 of 35) on Postgres 16, each database test once as the owner and once under `TENANT_SCOPE=enforce` with two clubs |
| `packages/db/schema.ts` against the migration (the three tables, their indexes and sequences, on Postgres 16) | No difference |
| Schema drift suite, and `db:drift` | **Not run here**: they need Postgres 18 (CI runs them). `docs/schema/production.sql` was extended from this run's dump (81 lines added, none changed): on Postgres 16 the dump after `0023` equals the new `production.sql` once the `NOT NULL` constraint lines that only Postgres 18 lists are set aside. Those 17 lines for the three new tables were written to the pattern of the existing tables and have not been checked against a real Postgres 18 |

### Settings

`MODERATION_KEKS` (the encryption build's key list for reports; it already has its row in the System check). With no key a report is still taken: what the reporter wrote is not stored, and a `child_safety` report keeps **no copy of the content** (it is never stored plain). So the key has to be set before Social is switched on for anyone. Both sealed columns are in `lib/crypto-purposes.ts`: after a key rotation, `scripts/crypto/reseal.mjs` is run once for `content_reports.details_sealed` and once for `moderation_evidence.sealed`, as the database's owner (the app's role can't update the evidence), before the old key is removed.

### Rollback

All three tables are new and nothing writes to them until Social is switched on for a pilot club:

```sql
DROP TABLE moderation_evidence;
DROP TABLE moderation_actions;
DROP TABLE content_reports;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1); -- only if 0023 is the last one applied
```

Once a report has been filed, `moderation_actions` and `moderation_evidence` are records that must be kept: don't drop them then; roll forward instead.
