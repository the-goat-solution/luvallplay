# Database: schema and migrations

The database schema is defined in two places that CI keeps identical:

| File | What it is |
|---|---|
| `db/migrations/*.sql` | **The source of truth.** Versioned, forward-only migrations (Drizzle Kit layout: `meta/_journal.json` + `<tag>.sql`). `0000_baseline.sql` is production's schema when Phase 2 started. |
| `db/schema.ts` | The same schema in TypeScript for Drizzle ORM (typed queries). Snake_case column names, as in SQL. |
| `docs/schema/production.sql` | What production looks like after every migration (the drift reference). Updated in the same pull request as each migration. |
| `docs/schema/production-2026-11.sql` | Production's real schema when the baseline was taken (frozen). |

Nothing changes the schema at request time (test plan §0 rule 2). Until Phase 2 PR 3 the old `ensureTables()` DDL still runs on cold starts; the drift check proves it changes nothing on a migrated database.

## Changing the schema

1. Edit `db/schema.ts`.
2. `npx drizzle-kit generate --name <what-it-does>` writes `db/migrations/<n>_<name>.sql`. Read it. Add `SET LOCAL lock_timeout`/`statement_timeout` if it needs more than the defaults (3 s / 60 s), and batch any backfill (test plan §4.2).
3. Apply it to a scratch database and refresh the reference dump:
   ```bash
   POSTGRES_URL=postgres://…/scratch npm run db:migrate
   POSTGRES_URL=postgres://…/scratch npm run db:dump > docs/schema/production.sql
   ```
4. Add the data guard expectations file (`scripts/data-guard/expectations/<id>.json`) and follow the data change protocol (test plan §4) before it touches production.

`npm test` (with `DATA_GUARD_TEST_URL` pointing at a Postgres 18) runs the drift check:

- migrations on an empty database give exactly `docs/schema/production.sql`;
- the baseline alone gives exactly the frozen production dump;
- a database built only from `db/schema.ts` gives the same schema, and Drizzle Kit sees nothing new to migrate;
- the runner refuses unsafe situations (below).

## Commands

```bash
npm run db:migrate                  # apply pending migrations to POSTGRES_URL
npm run db:migrate -- --status      # applied / pending, changes nothing
npm run db:drift                    # read-only: live schema vs docs/schema/production.sql
npm run db:dump                     # print the live schema (read-only)
npm run db:migrate -- --baseline    # once, on production: see below
```

`DB_DRIVER=neon-ws` connects over Neon's WebSocket on port 443 (machines behind an HTTPS proxy), as in the other operator scripts.

The runner (`scripts/db/migrate.mjs`):

- runs each migration in its own transaction with `lock_timeout = 3s` and `statement_timeout = 60s` (a file starting with `-- migrate: no-transaction` runs statement by statement, for `CREATE INDEX CONCURRENTLY`);
- records applied migrations in `drizzle.__drizzle_migrations`, with the same hash and timestamp as Drizzle's own migrator;
- **refuses** a database that has tables but no migration history, an applied migration whose file was edited, and a host in `PRODUCTION_DATABASE_HOSTS` without `--production`.

## Production and the baseline

Production already has the baseline schema; the baseline must never run there. Instead, once:

```bash
POSTGRES_URL=<production> npm run db:migrate -- --baseline --production
```

This re-reads production's schema, refuses if it differs from `docs/schema/production-2026-11.sql` in any way, and otherwise records `0000_baseline` as applied. That's additive: a `drizzle` schema with one table and one row. Nothing in `public` changes. Later migrations then run with `npm run db:migrate -- --production` after their rehearsal (test plan §4.4).
