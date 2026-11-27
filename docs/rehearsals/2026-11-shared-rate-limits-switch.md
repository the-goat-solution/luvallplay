# Switch: shared rate limits (`RATE_LIMIT_STORE=database`)

- **Change:** a production setting, the owner's to set. No migration and no data step: the `rate_limits` table came with `0014_rate_limits_stripe_events` (`2026-11-laneh-rate-limits-stripe-events.md`). With the setting, sign-in and every write (anything but a GET) of the players' app API (`apps/web/lib/app-api.ts`) count in that table, one count for every server instance, instead of one count per instance. Without it nothing changes and no extra statement is sent.
- **Command:** none. Set `RATE_LIMIT_STORE=database` and `CRYPTO_CHECK_RATE_LIMIT=1` in the hosting environment's settings, in one change, then redeploy.
- **Expectations:** none (no data changes). `apps/web/tests/shared-rate-limit.test.ts` covers the behaviour on a real Postgres.

## Result: not switched. Every line below is PENDING.

Nothing was rehearsed for this note: it is the list of what must be true before the owner sets it, checked against the code on `claude/encryption-layers-build` on 27 Nov 2026.

## Before `RATE_LIMIT_STORE=database`

1. **The table is in production, and the app's role can write to it: PENDING (confirm).** `0014` must have run there, with its grant to `luvallplay_app`. If the table can't be reached the app doesn't fail: it warns once and counts per instance as today, so a missing table looks like "switched" while nothing is shared. (An endpoint that sets `failClosed` answers `503 rate_limit_unavailable` instead; none does yet.)

2. **The website's own routes still count in memory, on the same keys as the app's endpoints: PENDING (other lanes' routes).** Today both surfaces call into one in-memory map, so a key is one count per instance. After the switch the app's endpoint counts in the database and the website's route keeps counting in memory with `checkRateLimit`, so a person gets the web limit **plus** the app limit until the route moves to `rateLimit()`. That loosens these limits; it locks nobody out. The keys, and the website route that still uses `checkRateLimit`:

   | Key | Website route (`apps/web/app/api/…`) | App endpoint |
   |---|---|---|
   | `msg-new:<player>` | `profile/messages` | `messages.start` |
   | `msg:<player>` | `profile/messages/[id]` | `messages.reply` |
   | `shop:<player>` | `profile/shop/order` | `shop.order` |
   | `avatar:<player>` | `profile/avatar` | `account.photo`, `account.removePhoto` |
   | `membership-action:<player>` | `profile/membership/action` | `membership.action` |
   | `arena:<player>` | `arena` | `arena.action` |
   | `match-stats:<player>` | `arena/match-stats` (POST) | `vision.save` |
   | `match-live:<player>` | `arena/match-stats` (PUT) | `vision.beat` |
   | `wv-train:<player>` | `wolf-vision/model` | `vision.train` |
   | `wv-share:<player>` | `wolf-vision/share` | `vision.share` |
   | `wv-labels:<player>` | `wolf-vision/labels` | `vision.labels` |
   | `wv-pass:<player>` | `wolf-vision/pass` | `vision.buy` |
   | `pi:<address>` | `create-payment-intent` | `play.book`, `family.pay` |
   | `sub:<address>` | `create-subscription` | `membership.join` |

   Not on the list, because both surfaces already use `rateLimit()`: the four sign-in keys (`auth-sms`, `auth-sms-verify`, `auth-email`, `auth-verify`), and the two limits inside sharing match stats that matter most (`wv-share:sender:<player>` and `wv-share:to:<email>`, in `lib/wolf-vision-share.ts`). Only the outer `wv-share:<player>` count splits.

3. **Per-address keys on signed-in writes become one count per address for the whole deployment: PENDING (the owning lanes' change).** `pi:<address>` limits `play.book` (10 a minute) and `family.pay` (10 in 10 minutes); `sub:<address>` limits `membership.join` (10 a minute). All three need a signed-in person, yet count by address. Per instance that is loose enough for a club's shared wifi; as one global count, a busy evening at one club can reach it and the next person there gets `429 rate_limited` on paying. Key them by player id first (as every other signed-in write is). Also to know: `play.book` and `family.pay` share one counter with different windows, and a window is as long as the request that opened it asked for, so one `family.pay` makes that address's count run for 10 minutes for both.

4. **Every write of the app API costs one more statement: PENDING (accept, or measure first).** One `INSERT … ON CONFLICT` on `rate_limits` per non-GET request, before the handler; about one request in 200 also sends a small clean-up `DELETE`. Reads cost nothing more (no endpoint says `shared`). The website's four sign-in routes and the sharing limits above send theirs too.

5. **`CRYPTO_CHECK_RATE_LIMIT=1` goes in with it, in the same change: PENDING.** With it, a production build (and, as a backstop, start-up) refuses unless `RATE_LIMIT_STORE` is `database` (`lib/crypto-health.ts`), so the setting can't be dropped later without anyone noticing. Set the check without the store and the next production build fails; the previous deployment keeps serving.

6. **Social and Marketplace are not waiting on this note**, but they must not go to production before it is done: their caps rely on the shared count, and on `withPlayerLock` (`lib/player-lock.ts`), which needs no setting.

## Rollback

Unset both `RATE_LIMIT_STORE` and `CRYPTO_CHECK_RATE_LIMIT`, in one change, and redeploy. Unsetting only `RATE_LIMIT_STORE` fails the next production build. Counting goes back to one count per instance at once. The rows left in `rate_limits` are counters whose windows pass; nothing reads them, and nothing in them can't be lost.
