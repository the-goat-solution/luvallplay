# Repositories

One place per table group for queries that used to sit inside pages and route
handlers (build plan §3.2). Typed Drizzle queries on `orm()` from
`lib/database.ts`; no SQL strings in `app/`.

| File | Tables | Used by |
|---|---|---|
| `donations.ts` | `donations` | `/api/create-donation-subscription`, `/api/stripe-webhook` |
| `memberships.ts` | `memberships` (subscription status from Stripe) | `/api/stripe-webhook` |
| `players.ts` | `players` (app-install flags, leaderboard opt-out, picker list) | `/api/profile/event`, `/api/profile/leaderboard-optout`, `/api/wolf-vision/players` |
| `waitlist.ts` | `waitlist` | `/api/waitlist` |
| `health.ts` | none (round trip) | `/api/health/db` |

Each function is checked against the SQL it replaced by the golden master
tests (`tests/golden-master.test.ts`, "routes → repositories"). With the
monorepo (Phase 2 PR 7) and modules (§6.2) these move to
`packages/modules/<module>/server/repo.ts`.
