# Rehearsal: lane H, shared rate limits and handled Stripe events (`0014_rate_limits_stripe_events`)

- **Change:** two new, empty platform tables. `rate_limits (key_hash, count, reset_at)` holds one counter per limited thing, keyed by a SHA-256, so a limit is the same on every server instance (audit H6). `stripe_events (event_id, type, processed_at)` holds the id of every Stripe event handled to the end, so one delivered again is skipped (audit H3). No existing table or row changes.
- **Command:** node scripts/db/migrate.mjs --to 0014
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-laneh-rate-limits-stripe-events.json` (production run: `…rate-limits-stripe-events.production.json`)

## Result: passed

Run by lane T on a fresh copy of production, 26 Nov 2026, and reported through the coordinating thread. Lane T holds the run's own output and adds the branch name and times here.

| Check | Result (as reported by lane T) |
|---|---|
| Data guard, before and after | **19 accounts checked, 0 problems** |
| Characterisation | Views **identical**, with this change's code and with `main`'s |
| `db:migrate --drift` | No schema drift |
| The app's role | `luvallplay_app` has SELECT, INSERT, UPDATE and DELETE on both tables |

## What changes for the running app

Nothing, until two later steps:

- **`rate_limits`** is read and written only when `RATE_LIMIT_STORE=database` is set. Without it the limiter counts in memory, as before. Setting it is a production settings change of its own, with the owner's OK.
- **`stripe_events`** is used as soon as the table exists: the Stripe webhook skips an event it has already handled to the end, and records each event after its handlers finish. Before the migration the app handles every event as before.

The app version on `main` before this change reads neither table.

## Rollback

```sql
DROP TABLE rate_limits;
DROP TABLE stripe_events;
```

and remove the migration's row. Unset `RATE_LIMIT_STORE` first if it was set. Neither table holds anything that can't be lost: counters restart, and an event id that is forgotten only means a replayed event is handled by the handlers' own guards.
