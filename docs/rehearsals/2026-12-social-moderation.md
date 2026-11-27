# Rehearsal: the Social tables, blocks and suspensions (`0022_social_moderation`), then reports, actions and evidence (`0023_moderation_reports`)

Three migrations, one note. `0022` first; `0023` is under "The second migration" below, and `0024_player_photos_purpose` (lane H's column on `player_photos`) under "The third migration".

- **Change:** eight new, empty tables and two functions. Nothing existing is altered.
  - `social_profiles`, `social_follows`, `social_posts`, `social_comments`, `social_kudos`, `social_club_bans`: Social's own. `user_blocks`: one person blocks another (shared with the Marketplace).
  - `player_suspensions`: a moderator's decisions about a person. Insert only: the app's role can add and read rows and can't update or delete them, and can't choose a row's `id` or `created_at` (the id is `GENERATED ALWAYS`, and the role's `INSERT` right is on the other columns only). Every suspension stands on its own until a later `unsuspend` row for the same account covers it. It names the account by id **without a foreign key** and keeps keyed indexes of the email and the verified phone the account had (never the values), so a row stands when the account is deleted and the same email or phone signing up again is found.
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
| The app's role on `player_suspensions` | `SELECT` yes; `INSERT` on every column but `id` and `created_at`; `UPDATE` and `DELETE` no |
| The two functions | Both `SECURITY DEFINER`, `search_path=public, pg_temp`; the app's role may call them, `PUBLIC` may not. Called as the app's role scoped to club 1 with Social's module row on: `social_clubs_of(3)` gives `{1}`, `shares_social_club(3, 4)` is true |
| Rollback (below), then a schema dump | The schema equals the one before `0022` (95 tables); the migrator applies `0022` again afterwards |
| `tests/moderation.test.ts` | Passes (48 of 48, after the review fixes below) on Postgres 16, each database test once as the owner and once under `TENANT_SCOPE=enforce` with two clubs |
| `packages/db/schema.ts` against the migrations (tables and indexes, on Postgres 16) | No difference |
| Schema drift suite, and `db:drift` | **Not run here**: they need Postgres 18 (CI runs them). `docs/schema/production.sql` was extended from this run's dump (195 lines added, none changed): on Postgres 16 the dump after `0022` equals the new `production.sql` once the `NOT NULL` constraint lines that only Postgres 18 lists are set aside. Those lines for the eight new tables were written to the pattern of the existing tables and have not been checked against a real Postgres 18 |

### The step from `0021` to `0022`, with the plain command

The first run of this rehearsal could not use the plain command for this step: on the branch as it was, `0021`'s date in `meta/_journal.json` was in the future, and the migrator, which orders by that date, refused `0022` on a database already at `0021` ("was changed after it was applied"). That run moved `0021`'s date back in memory in a scratch script. The fix has since been merged (it moves `0021`'s date back in the journal and adds `tests/migration-journal.test.ts`), and the step was run again, 27 Nov 2026, with nothing worked around:

| Step | Result |
|---|---|
| A scratch database migrated to `0021` (`node scripts/db/migrate.mjs --to 0021`), then the fixture | 95 tables, 468 rows |
| `node scripts/db/migrate.mjs --to 0022` | `applied 0022_social_moderation (52 ms)`; 103 tables. (`--to` only because `0023` exists by now and has its own step below) |

## After the review: `0022` and `0023` edited in place

Neither migration has been applied anywhere but local scratch databases, so both were edited in place (their journal dates are unchanged). What changed, 27 Nov 2026:

- `player_suspensions.id` and `moderation_actions.id` are `bigint GENERATED ALWAYS AS IDENTITY` (they were `bigserial`). The app's role has `INSERT` on the other columns only, not on `id` or `created_at` (nor on `moderation_evidence.created_at`), and no right on the two id sequences. Before, the role could insert a row with any id or time, and rows are ordered by id: a lift with the largest possible id was accepted.
- `player_suspensions` has one more check, `player_suspensions_unsuspend_names_account_check`: a lift names an account and carries no index.
- Later the same day (the Task 4 review): `social_posts_match_ref_key`, a unique index on `social_posts (ref_key) WHERE kind = 'match'`. One post per side of a match, whichever of the pair writes it, also when two confirmations run at once. The table is new and empty; the rollback below already drops it with its indexes. Not rehearsed again step by step: the test databases are built from the migrations as they now are (`tests/social-feed.test.ts` reads the index back and is refused a second match post with the same key), and `schema.ts` and `production.sql` carry the same line. **A local database that ran the earlier `0022` will refuse to migrate**: recreate it.

| Step | Result |
|---|---|
| A scratch database at `0021` with the fixture, then `0022` as it now is (the plain migrator, nothing worked around) | Applied in 36 ms; 95 tables before, 103 after; the 95 existing tables' rows identical; the data guard passed with the expectations (24 accounts, 0 problems); a second run applied nothing |
| The app's role on `player_suspensions` | `has_table_privilege(…, 'INSERT')` is now false (the right is per column); `UPDATE`, `DELETE` false. In the tests, as the role: an insert naming `id` (with or without `OVERRIDING SYSTEM VALUE`) or `created_at` is "permission denied", as is `setval` on the sequence; an ordinary insert works |
| The same for `moderation_actions` and `moderation_evidence` | In `tests/moderation-reports.test.ts`, as the role: the same refusals; an ordinary insert works and gets the database's id and time |
| Rollback SQL (both blocks below, unchanged: dropping a table drops its identity sequence), then a schema dump | `0022`'s was run again: the schema equals the one before, and `0022` applies again. `0023`'s was not run again |
| `docs/schema/production.sql` | Three lines changed by hand (the two `id` columns no longer show a default; the new check): on Postgres 16 the dump after `0023` equals it once the `NOT NULL` lines are set aside, and a database built from `packages/db/schema.ts` gives the same tables. The dump does not show that a column is an identity column, so the drift suite can't tell `bigserial` from identity; the tests check `attidentity` instead |
| `tests/moderation.test.ts`, `tests/moderation-reports.test.ts` | 48 of 48 and 35 of 35, on fresh databases |

**A local database that ran the first `0022` or `0023` will refuse to migrate** ("changed after it was applied"). Roll both back with the SQL below and migrate again, or recreate the database. The tests make fresh databases and are not affected.

## Still to do

1. The schema drift suite on Postgres 18 (CI), for both migrations.
2. A run on a copy of production on Postgres 18 with the data guard before and after (a Neon branch when one is booked with lane T; Neon is at 10 of 10 branches). All eleven tables are new and empty, so the guard should report no change for any account.
3. Lane T's agreement on the two `SECURITY DEFINER` functions before the migration merges (Social plan, Task 3 code review): **agreement pending**. They rely, as `link_account_to_rows` does, on their owner **bypassing row-level security** on `club_members` and `tenant_modules`. Both tables have row-level security enabled **and forced**, so being the tables' owner is not enough: the functions' owner has to hold `BYPASSRLS` (or be a superuser). **The tests here can't show what happens otherwise:** the local owner is a superuser, so no test has run the functions as an owner that is bound by the policy. Such an owner would see only the club named in `app.tenant_id` (the functions don't change it), and `social_clubs_of` would quietly return one club instead of all of a person's. `0007` recorded that production's owner has `BYPASSRLS`; that was not checked again for this change. **Before Social is switched on anywhere, check it on the real owner role** (`SELECT rolbypassrls FROM pg_roles WHERE rolname = '<owner>'`, and that the functions are owned by that role), and call `social_clubs_of` as `luvallplay_app` scoped to one club for a person who is in two.
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
  - `moderation_evidence`: for a `child_safety` report, a sealed copy of the content and the author's account id. Insert only. One row per report. A trigger (`moderation_evidence_for_child_safety`, checked after the statement) refuses a row for any report that isn't a `child_safety` one.
  - The app's role may update a report only in `reason`, `severity`, `queue`, `due_at`, `details_sealed`, `reporter_id`, `status`, `handled_by`, `handled_at` and `alerted_at`: never its id, what it is about (`target_type`, `target_id`), its club, or when it was filed.
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
| The app's role | `content_reports`: `SELECT`, `INSERT`, `DELETE`, and `UPDATE` of the ten columns listed above only (after the second review's fixes: tried as the role, `UPDATE … SET target_id` and `SET created_at` give "permission denied for table content_reports", closing a report works, and evidence for a `spam` report is refused by the trigger). `moderation_actions` and `moderation_evidence`: `SELECT` yes; `INSERT` on every column but `moderation_actions.id` and the two `created_at` (after the review fixes below); `UPDATE` and `DELETE` no (tried as the role: "permission denied for table moderation_actions"). `TRUNCATE` on none of the three |
| Rollback (below), then a schema dump | The schema equals the one before `0023` (103 tables); the migrator applies `0023` again afterwards (13 ms). **Run again after the review fixes** (the migration was edited in place twice, its journal date unchanged), with the function's `DROP` added |
| `tests/moderation-reports.test.ts` | Passes (39 of 39, after the review fixes) on Postgres 16, each database test once as the owner and once under `TENANT_SCOPE=enforce` with two clubs |
| `packages/db/schema.ts` against the migration (the three tables, their indexes and sequences, on Postgres 16) | No difference |
| Schema drift suite, and `db:drift` | **Not run here**: they need Postgres 18 (CI runs them). `docs/schema/production.sql` was extended from this run's dump (81 lines added, none changed; 11 more for the trigger and its function after the review fixes, taken from a Postgres 16 dump in the same way): on Postgres 16 the dump after `0023` equals the new `production.sql` once the `NOT NULL` constraint lines that only Postgres 18 lists are set aside. Those 17 lines for the three new tables were written to the pattern of the existing tables and have not been checked against a real Postgres 18 |

### Settings

`MODERATION_KEKS` (the encryption build's key list for reports; it already has its row in the System check). With no key a report is still taken: what the reporter wrote is not stored, and a `child_safety` report keeps **no copy of the content** (it is never stored plain). So the key has to be set before Social is switched on for anyone. Both sealed columns are in `lib/crypto-purposes.ts`: after a key rotation, `scripts/crypto/reseal.mjs` is run once for `content_reports.details_sealed` and once for `moderation_evidence.sealed`, as the database's owner (the app's role can't update the evidence), before the old key is removed. The script proves the shell's key against rows of the column it is re-sealing, and after a rotation there is usually no evidence row on the new key yet: run the details first (that run proves the key), then the evidence with `--first-use-of-key`, in the same shell.

### Rollback

All three tables are new and nothing writes to them until Social is switched on for a pilot club:

```sql
DROP TABLE moderation_evidence;
DROP FUNCTION moderation_evidence_for_child_safety();
DROP TABLE moderation_actions;
DROP TABLE content_reports;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1); -- only if 0023 is the last one applied
```

Once a report has been filed, `moderation_actions` and `moderation_evidence` are records that must be kept: don't drop them then; roll forward instead.

## The third migration: `0024_player_photos_purpose`

- **Change:** one new column on an existing table, one constraint loosened, a trigger and two unique indexes. Lane H's table, changed for lane S (Social plan Task 4, the photo groundwork).
  - `player_photos.purpose text NOT NULL DEFAULT 'gallery'`, checked to be `gallery`, `social` or `market`. Every existing photo becomes a Gallery photo. A photo uploaded for a Social post or a Marketplace listing gets its own purpose, goes through the same image check and the same admin review, and never joins the Gallery, "My photos" or the Gallery's 20 a day.
  - `player_photos.consent_at` may now be empty. It is the "share this in the Gallery" tick, which isn't asked for a post's or a listing's photo. A new check, `player_photos_gallery_consent_check`, keeps it required for every Gallery photo, so nothing changes for the rows there are.
  - A photo's purpose never changes: the trigger `player_photos_purpose_is_fixed` (`BEFORE UPDATE OF purpose`) refuses an update that would, for every role. Without it one `UPDATE` would put a post's photo in the Gallery.
  - `player_photos_file_key`: a unique index on `display_url` over the rows that are **not** Gallery photos. One stored file is one photo for posts and listings, so deleting one photo can't remove another's file. It covers no existing row (they are all `gallery`), so existing data can't make it fail, and the Gallery is as before.
  - `social_posts_photo_id_idx` (from `0022`) is dropped and made again as the unique index `social_posts_photo_id_key`: one photo is in at most one post. `social_posts` is empty everywhere; nothing has written a post yet. This is the one statement here that removes something.
  - No new table, no new grant (`player_photos` is already granted to `luvallplay_app`). The table stays a club's table: `tenant_id`, row-level security enabled and forced, the `tenant_isolation` policy. None of that is touched.
- **Command:** `node scripts/db/migrate.mjs`
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-12-player-photos-purpose.json` (and `.production.json` for the live run). After the run every row of `player_photos` must have `purpose = 'gallery'`: `SELECT purpose, count(*) FROM player_photos GROUP BY 1`.
- **Number:** written as `0024`; the migration queue gives the final number at merge.
- **Order:** the migration first, then the code. The Gallery's queries name the new column from this change on (`purpose = 'gallery'`), so the code must not reach a database that hasn't had `0024`: the public Gallery would come up empty (its query fails quietly) and sharing a photo would fail. The other way round is safe: the code before this change runs unchanged on a database that has the column.
- **Hidden:** nothing writes a `social` or `market` photo until a club is on the Social pilot list. For the Gallery and its admin page nothing changes while every photo is a Gallery photo.

### Result: the local rehearsal passed on synthetic data. The run on a copy of production, the schema drift suite, and the production run are still to do.

**What this run was, said plainly:** 27 Nov 2026, a scratch database on this machine's **Postgres 16.15**. Not a Neon branch, not Postgres 18, not a copy of production: the test fixture's 25 made-up accounts (468 rows, 10 of them photos). Nothing touched Neon, Vercel or any production system. The command was the plain one, from a database at `0023`.

| Step | Result |
|---|---|
| A scratch database migrated to `0023` (`node scripts/db/migrate.mjs --to 0023`), then the fixture | 106 tables, 468 rows; `player_photos` has 10 rows |
| Data guard snapshot, before | Taken (exit 0) |
| `node scripts/db/migrate.mjs` | `applied 0024_player_photos_purpose (8 ms)`, exit 0 |
| Tables before and after | **106 before, 106 after.** None new, none gone |
| `player_photos`, before against after | **10 rows before, 10 after.** A hash of every row over the 18 columns it had before is identical. After: `purpose = 'gallery'` for all 10 |
| The other 105 tables, row count and a hash of every row, before against after | Identical |
| Data guard, before against after, with the expectations | Passed: 24 live accounts checked, 0 problems. Without the expectations file the result is the same |
| Migrating a second time | **A no-op:** "Nothing to migrate: the database is up to date."; the history has 25 rows |
| The trigger and the two indexes | As the owner: `UPDATE player_photos SET purpose = 'social' WHERE id = 1` is refused ("purpose cannot be changed"). As the app's role: a second `social` or `market` row with the same `display_url` is refused by `player_photos_file_key`. In the tests: two Gallery rows with one URL are still accepted, and a second post with the same photo is refused by `social_posts_photo_id_key` |
| The app's role, scoped to club 1 | Can store a `social` photo with no `consent_at` (the row gets club 1's `tenant_id`); tried in a transaction that was rolled back. In `tests/social-photos.test.ts`: a `gallery` photo without `consent_at` and a purpose outside the three are refused by the checks; under `TENANT_SCOPE=enforce` a photo for another club can't be registered or read |
| Rollback (below), then a schema dump | The schema (`pg_dump --schema-only`) equals the one before `0024`, and every table's rows hash as before; the migrator applies `0024` again afterwards (8 ms) |
| `tests/social-photos.test.ts` | Passes on Postgres 16, each database test once as the owner and once under `TENANT_SCOPE=enforce` with two clubs |
| `packages/db/schema.ts` against the migrations (tables and indexes, on Postgres 16) | No difference |
| Schema drift suite, and `db:drift` | **Not run here**: they need Postgres 18 (CI runs them). `docs/schema/production.sql` was changed by hand (in `player_photos`: the column, the two checks, `consent_at`, the file index; the post index; the trigger and its function): on Postgres 16 the dump after `0024` equals it once the `NOT NULL` constraint lines that only Postgres 18 lists are set aside. Of those, `player_photos_consent_at_not_null` was removed and `player_photos_purpose_not_null` added, to the pattern of the other lines; neither has been checked against a real Postgres 18 |

### Still to do

1. The schema drift suite on Postgres 18 (CI).
2. A run on a copy of production on Postgres 18 with the data guard before and after. `player_photos` has real rows, unlike the tables of `0022` and `0023`: check the count by purpose afterwards (all `gallery`), and that no row's status, files or consent time moved.
3. Lane H's OK for the change to its table (the column, `consent_at` no longer `NOT NULL`, the trigger, the file index), and lane T's for a club table gaining a column (its row-level security is untouched).
4. The production run itself, with the owner's OK, **before** the code that reads the column is deployed.

### Settings

None.

### Rollback

While no photo has been stored for a post or a listing (nothing writes one until Social is switched on for a pilot club):

```sql
DROP INDEX social_posts_photo_id_key;
CREATE INDEX social_posts_photo_id_idx ON social_posts (photo_id) WHERE photo_id IS NOT NULL;
DROP INDEX player_photos_file_key;
DROP TRIGGER player_photos_purpose_is_fixed ON player_photos;
DROP FUNCTION player_photos_purpose_is_fixed();
ALTER TABLE player_photos
  DROP CONSTRAINT player_photos_gallery_consent_check,
  DROP CONSTRAINT player_photos_purpose_check,
  ALTER COLUMN consent_at SET NOT NULL,
  DROP COLUMN purpose;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1); -- only if 0024 is the last one applied
```

Run it in one transaction (`psql -1`). Roll the code back first: the Gallery's queries name the column. Once a `social` or `market` photo exists, `SET NOT NULL` fails on purpose (those rows have no consent time), and dropping the column would turn them into Gallery photos: don't roll back then; roll forward instead.

### After the review: `0024` edited in place

`0024` had been applied nowhere but local scratch databases, so it was edited in place (its journal date is unchanged), 27 Nov 2026: the trigger, `player_photos_file_key` and `social_posts_photo_id_key` were added. The whole rehearsal above was run again from a fresh database at `0023` with the migration as it now is, and the table shows that run: the same counts and hashes, the data guard passed, a second run applied nothing, the rollback (with its five new lines) gives back the schema of before, and it is refused once a `social` row exists. **A local database that ran the first `0024` will refuse to migrate** ("changed after it was applied"): recreate it. The tests make fresh databases.
