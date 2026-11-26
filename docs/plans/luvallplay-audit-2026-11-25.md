# Audit: what's built, what's not, and the holes (25 Nov 2026)

Read-only review of `main` at `d7bd02d` (#150), plus the unmerged Track A plan (`claude/magical-carson-1c6poj`) and the club-paths branch (`claude/clever-lovelace-f8ywij`). Four reviews ran side by side, each with an installed skill as its checklist:

| Review | Checklist used |
|---|---|
| Security: the app API, sign-in, money, tenancy | `backend-design:security-reviewer` |
| Multi-tenant core, migrations, step 11 readiness | `backend-design:audit`, `migration-safety`, `data-modeling-discipline` |
| Players' app (`apps/app`, `packages/api`) and Phase 5 readiness | `ui-ux-behaves:ui-ux`, `ui-design-review:ui-review`, `mobile-app-design:ios-review` |
| Admin, modules, tests and CI, ops | `engineering:tech-debt`, `engineering:testing-strategy` |

Nothing was run against production. Findings marked **(test)** are plausible from the code but not yet proven by a test. The fixes are scheduled in build plan §9 (lane H, "Hardening") and in the lanes they block.

---

## 1. What's built and what's not

| Phase / track | State | What's left |
|---|---|---|
| 0 Safety net | **Done** | CI can't be *required* on `main`: the repo is private under a personal account and GitHub refuses rulesets (gate 2) |
| 1 Tidy Three Wolves | **Done** (#79) | — |
| 2 Foundations | **Done** (PRs 1–8, Next 16, monorepo, Studio moved, break-glass gone, lint clean) | Contract step: remove the Sanity pricing fallback after a quiet week |
| 3 Multi-tenant core | **Steps 1–10 done** and run on production; `0010`/`0011` keys run | **The step 11 evidence is failing (C0), so the 7-day clock has to restart once fixed.** Settings switch to `database` (earliest 30 Nov); **step 11** `enforce` (not before 1 Dec, after 7 clean shadow days); **step 12** email joins dropped (≥ a week later); the app's own database login (`APP_DATABASE_URL`) is an owner step |
| 3b Junior accounts | **Step 1 merged** (#119, tables `0012`) | Confirm `0012` ran on production (the build thread was still asking at 03:28 UTC on 25 Nov, after the merge); steps 2–8 not started |
| 4 Players' app | **Done**: steps 0–8, parity, photos, Vision 1–3, offline, fonts, #150 Home/My profile. Live at `app.luvallplay.com` | **Cutover not started** (members still use the website's `/profile`); migration `0013` waits for an OK; Vision-for-badminton not enforced on the website/admin |
| 5 Capacitor and stores | **Not started** | Everything in §4.2–4.5; needs the organisation developer accounts (gate 2 / D-U-N-S) for TestFlight and Play |
| 6 Brand, sites, wizard | **Stage A done and live** (luvallplay.com) | DNS for .vn/.org/.nz, Sanity organisation, forms database, Resend DNS, Vietnamese copy review; **Stage B not started** |
| A White-label admin | **Planned** (§6.2.4, now on this branch) | A1–A6; no thread yet |
| 7 Global modules | Not started | Find a club, global ratings; social and marketplace gated |
| I Integrations (NZ) | Not started | Framework, Xero, direct debit, Windcave, Shopify, MYOB |
| V Vietnam | Discovery only (no engineering) | VietQR, MoMo, Zalo, Hanoi region, legal |
| B Business foundations | Owner track; not tracked in the repo | All four gates in §11.3 |
| Club paths (`/{club}` on the app host) | Built behind `CLUB_PATHS` (off) on `clever-lovelace`, **unmerged**, 142 commits behind | Rebase (one conflict in `scripts/vercel-ignore.sh`) and merge with step 11 |

---

## 2. Holes and gaps, ranked

### Critical (fix before step 11 or before any outside club)

| # | Finding | Evidence | Fix | Blocks |
|---|---|---|---|---|
| C0 | **The step 11 evidence is failing now.** Main added three built-in club words (`playerName`, `playersName`, `pairName`) that production's stored settings only get from migration `0013`, which hasn't run, so the settings shadow writes `differ` every day. If `0012` hasn't run either, the row-level security heartbeat (one query over every club table, junior tables included) is `unavailable` every day. `shadow-report.mjs` counts a day as clean if *any* check was clean and ignores `unavailable`, so it can't see the second problem. `db:migrate` has no `--to`, so running `0013` also runs `0012` | `lib/constants.ts:18-21`, `lib/club-config.ts:46`, `lib/shadow-log.ts:42-45,70`, `scripts/shadow-report.mjs:23-24`, `scripts/db/migrate.mjs:91,118-124` | Decide `0012` and `0013` together (or add `--to`); the probe skips missing tables; "clean" means every check clean that day, `unavailable` counts as a failure; **restart the 7-day clock** after that | Step 11 |
| C0b | **Shadow reads don't cover most of the app.** In shadow mode `orm()` (every Drizzle repository) and `sql.connect()` (every transaction) aren't compared; and with one club in the database, owner-versus-app-role comparison can't show a missing club condition anyway | `lib/database.ts:283-286,308-311` | Shadow `orm()` and `connect()` too; make the two-club route suite (T1) against a copy of production the real step 11 gate | Step 11 |
| C1 | **Platform-wide player lists with no club condition.** The Arena world, the Vision player picker and the `club_members` mirror read or enrol *every* account. Club B would see club A's names and avatars, and the mirror would make every account a member of every club, so the admin's `club_members` filter stops filtering | `lib/arena-db.ts:347-353`, `lib/repos/players.ts:42-54`, `lib/tenant-members.ts:33-39`, `player-db.ts:413` | Join to `club_members` for the club; enrol a person only when they join a club | Step 11, 6B |
| C2 | **Most journeys never run in CI.** `tests/e2e/journeys.mjs` (A1–A7, M1–M5, G1–G2, T1 route isolation, API1–23, S2) is run by hand only. S2 covers one module of 16 | `.github/workflows/ci.yml`, `journeys.mjs:1625`, `phase-4-handoff.md:72` | A CI job for the web journeys; S2 generated for every module | Every gate |
| C3 | **CI can't be required on `main`** (private repo on a personal account) | GitHub API refuses rulesets | Move the repo to a GitHub organisation on a paid plan (gate 2) | Every gate |
| C4 | **Club-specific values are far wider than "19 lines in 9 files".** Admin has ~18 lines in 9 files plus `en-NZ` ×8, "$0" ×2 and weekday values; **emails, receipts, Stripe descriptions and XLSX exports have 93 lines in 37 files**; the schema itself fixes Three Wolves' plan ids (`pricing_plans` CHECK) and `memberships.day DEFAULT 'friday'` | `components/admin/shell/AdminShell.tsx:66`, `lib/email.ts`, `stripe.ts:256,305`, `packages/db/schema.ts:545,1327`, `lib/constants.ts:29,79-81,136` | Track A2 widened to emails/exports; a schema migration (data-change protocol) for plans and days; the literal scan covering `lib/` and `app/api/` | A2, 6B, V |
| C5 | **Sign-in code brute force through a race** **(test)**. Attempts are read, compared, then incremented; the per-IP limit is in memory per instance | `lib/player-auth.ts:180-196`, `api/v1/app/auth/email/verify/route.ts:20` | `UPDATE … attempts=attempts+1 WHERE attempts<5 RETURNING` before comparing; a per-email limit in the database | Now |

| C6 | **Platform tables changed with no club condition** (second-club blockers): a club admin's **account merge** can retire any account on the platform and wipe its phone and Stripe customer; round-robin names are unique platform-wide and match other clubs' people; the welcome-email list spans every club; `grant-role.mjs` mirrors **every account into the club with roles from other clubs**; `club_roles` inserts land in club 1 by default; `verify.mjs` assumes one club | `lib/player-merge.ts:56-63,304-311`, `lib/stats-db.ts:184-216`, `lib/player-db.ts:458-470`, `scripts/grant-role.mjs:76`, `lib/admin-roles.ts:104,268`, `lib/tenant-members.ts:33-52` | Club conditions on each; round-robin names unique per club; scripts and the mirror take a club; drop the `COALESCE(app_tenant_id(), 1)` defaults on 54 tables after enforce so an unscoped write fails loudly | Second club |
| C7 | **One club per process is assumed everywhere**: `TENANT_SLUG` silently falls back to `three-wolves`; club config, module switches and entitlements are cached per process without the club in the key; terms are set to Three Wolves' at import; the leaderboard cache key has no club; `CLUB_SETTINGS_SOURCE` fails open to Three Wolves' name, time zone and currency | `lib/tenant-members.ts:25-27`, `lib/database.ts:174-192`, `lib/club-config.ts:68-71,116,150-163`, `lib/club-modules.ts:59`, `lib/entitlements.ts:24`, `lib/club-terms.ts:13`, `lib/leaderboard-data.ts:22` | Fail closed; club in every cache key. **Rule: no second club's rows in the shared database until `enforce` and `APP_DATABASE_URL` are live and quiet** | Second club |

### High

| # | Finding | Evidence | Fix | Blocks |
|---|---|---|---|---|
| H1 | **Row-level security is off unless an env var says so** (`TENANT_SCOPE` defaults to `off`) | `lib/database.ts:99,114-117` | Fail start-up in production when unset; `enforce` becomes the default at step 11 | Step 11 |
| H2 | **Crons run for one club** and don't check modules; webhook retries ride on the membership-reminders cron, so a club with Memberships off loses integration retries | `app/api/cron/*`, `membership-reminders/route.ts:78` | Crons loop over the region's clubs with each club's scope and switches; webhook retries get their own job | Step 11, 6B |
| H3 | **A replayed Stripe event double-counts a booking** (`booked_spots+1` runs before the idempotent insert; no event-id dedupe) | `lib/db.ts:263-295`, `api/stripe-webhook/route.ts:62` | Insert first, increment only when a row was inserted, one transaction; store processed event ids | Now |
| H4 | **Any signed-in player can overwrite another game's final match stats** or fake its "live" flag | `lib/match-stats-db.ts:90-128`, `lib/app-vision.ts:111-130` | Recorder must be a player in the challenge; never overwrite a `final` row | Now |
| H5 | **Stripe Connect not started**: 15 files call Stripe directly, 6 use `lib/payments`, no `stripeAccount` anywhere | `lib/payments/*`, `lib/stripe.ts` | Move all card flows behind the payments interface, then add the connected account | 6B Payments, I, V |
| H6 | **No error reporting anywhere** (no Sentry, no `onRequestError`, no app error boundary); logs last 1 hour; rate limits in memory per instance; 6-hour restore window; no restore-drill script; Vercel Hobby (not for commercial use) | `instrumentation.ts`, `lib/security.ts:7-23`, `apps/app/src/router.tsx:221` | Sentry on web and app; a shared rate limiter; paid Neon (7-day PITR, more branches) and Vercel Pro under company accounts | First outside club |
| H7 ✅ #182 | **The audit log is thin and can leak**: one generic row per admin POST, written before the action, no outcome; exports (GET) not logged; up to 20 form fields copied in plain text (Phase 3b medical notes would land there) | `proxy.ts:144-151`, `lib/admin-roles.ts:415-424` | Per-action audit rows with outcome; log exports; allow-list fields instead of copying them | 3b, A6 |
| H8 | **Step-up is a blanket 12-hour window**; nothing asks for a fresh code at the sensitive moment (module switches, removing admins, refunds, exports, platform grants) | `packages/auth/src/index.ts:14`, `lib/admin-access.ts:72` | Per-action step-up (a fresh code within ~5 minutes) | 3b step 2, A6 |
| H9 | **The session token is written into the app's offline cache** (query keys contain it), so it sits in `lp.cache` as well as `lp.token` | `apps/app/src/lib/hooks.tsx:22,27`, `me/data.ts:13` | Key queries by the session's hash (already in `offline.ts`) | Now, Phase 5 |
| H10 | **An app update or a captive-portal page can break screens**: saved offline data has no build id; a non-JSON 200 is stored as `null`; no error screen | `apps/app/src/lib/offline.ts:77-90`, `packages/api/src/client.ts:87-100` | Build id on saved data; `bad_response` error; a default error component | Now |

### Medium

- **Under `enforce` the heartbeat will report a false alarm daily** **(test)**: the roster cron passes the scoped pool, so the "no club named" probe sees the club's rows (`app/api/cron/send-roster/route.ts:21`, `lib/tenant-scope.ts:77-81,134-140`). Give the probe the raw pool.
- **A session advisory lock through the transaction pooler** **(test)**: lock and unlock can land on different server connections and leak, hanging later sign-ups for the same email and day (`lib/db.ts:380,510`). Use `pg_advisory_xact_lock` in one transaction. True today.
- **`enforce` adds latency** **(test)**: five round trips per pooled statement; the Arena fires 9 queries at once on a pool of 10 (`lib/tenant-scope.ts:88-93`, `lib/arena-db.ts:343`). One `set_config` statement; load-test before switching.
- **Migration `0012` details**: `junior_attendance` has no foreign key to its play day and no CHECK on `source`; nothing ties `booked_by_user_id` to a guardianship; `junior_profiles.guardian_user_id` duplicates `guardianships`; a duplicate `(tenant_id, id)` index; `guardianships` is platform-wide, so the app role can insert one for any club; the data guard counts a soft-deleted guardian as a guardian (`scripts/data-guard/core.ts:359-363,394-396`). Fix in lane J's next migration.
- **Restore points**: 6-hour history; branch counts disagree between the runbook (10 of 10, then one more) and the plan (6 of 10); `0010`'s restore point was a rehearsal branch later reset. Step 12 is destructive: free a slot and take a fresh restore point first.
- **Stats-email relay**: any account can send club-branded stats emails to any address (`lib/wolf-vision-share.ts:55-90`, `app-vision.ts:154`, in-memory 12/day cap). Send only to registered players; database cap.
- **Webhook SSRF filter is hostname-only** (`lib/webhooks.ts:86-97,139-182`): `localhost.` or a public name resolving to 10.x/169.254.x passes, and the stored error text is an oracle. Resolve and block private ranges at delivery.
- **Photos**: any `*.public.blob.vercel-storage.com` host is accepted (`photos-service.ts:85-92`); unregistered uploads are unlimited; avatars skip SafeSearch (`app-account.ts:34-48`). Pin our store id; count upload tokens.
- **"Can't make it" can end in the wrong state**: an online choice doesn't clear an older queued one; refetch races the queue; 408/409/429 drop silently (`apps/app/src/screens/me/data.ts:45-52`, `lib/queue.ts`).
- **A stale 401 signs out a new session** (`apps/app/src/app.ts:22`); **no fetch timeouts** in the client or the service worker (`client.ts:76`, `sw/sw.js:35-46`).
- **Three Wolves words and NZ$ leak to other clubs in the app**: "NZ$5 a match", "Pack Leader", NZD fallbacks; Vision passes priced as fixed minor units, so a VND club gets a 500 ₫ pass below Stripe's minimum (`packages/i18n/src/arena.ts:81,90`, `lib/wolf-vision-db.ts:25`).
- **Arena scoring is badminton-only** but the Arena isn't limited by sport (`packages/core/src/ranks.ts:242`). Per-sport scoring (§6.7) or limit the module.
- **Vision-for-badminton is enforced only in the app**; `packages/modules` has no sport field, so Admin → Modules lets any club switch Vision on.
- **Module registry gaps**: `card-payments` gates nothing in the card flows; manifest emails aren't enforced; `membership.changed` is subscribable but never emitted; Today is filtered by role, not module.
- **Club website content is one Sanity dataset per deployment** with no club in its queries: 6B needs the per-club content model (decision D).
- **No admin i18n** (54 files, ~10k lines inline English).
- **Two UIs for the same features** (website `/profile` and the app) with no parity checklist or retirement date, so every 3b/6 feature would be built twice. `lib/app-membership.ts` has already drifted from `create-subscription` (Stripe description in 4 places).
- **Contract check is blind inside unions** (29 shapes "unknown"), bumping `API_VERSION` turns it off, and the client sends no app version, so old store builds can't be detected or forced to upgrade.
- **Accessibility**: route changes don't move focus or change the title (WCAG 2.4.2, 4.1.3).

### Low

Idempotency keys with `Date.now()` (`app-membership.ts:164`, `create-payment-intent/route.ts:82`, `create-donation-intent/route.ts:49`); raw `e.message` returned to the client; non-constant-time secret compares and `?secret=` on `/api/revalidate`; fail-open defaults (Turnstile unset passes, Vision free without a Stripe key); shop stock hoarding (no per-player cap); Vision model merges open to any account; the 90-day session minted by the admin handoff; `https://localhost` in production CORS; one-tap key revoke without confirm; no "Resend code"; Inbox thread has no Try again; the Drizzle "nothing to migrate" check still compares nothing; the schema dump has no GRANTs, so a missing app-role grant doesn't show as drift; `bookings` lacks a `(tenant_id, session_date)` index; two rehearsal tests skip silently without `psql`; `packages/*` have no tests of their own; budget check counts only the entry script; `interactive-widget=resizes-content` missing from the app's viewport; `font-src` blocks a club's fonts from its own domain; `image-prep` copied in two places.

### Phase 5 rework risks (the players' app)

- Token storage is **synchronous** (`apps/app/src/lib/storage.ts:5-9`, router `beforeLoad`); Keychain/Keystore are async, so start-up must await the token.
- **Vision passes go through Stripe Checkout** inside the tracker (`packages/vision/src/ui/MatchAnalyzer.tsx:341`): iOS needs StoreKit (decision C) and **Google Play needs Play Billing** too; a per-platform payment path with server receipt checks.
- **Links built from the page's origin** (pairing QR, Stripe `return_url`, photo uploads) become `capacitor://localhost/…`: one public app URL plus universal/app links.
- `location.assign` and `target=_blank` leave the app: use `@capacitor/browser` with a deep link back.
- The **service worker** must be off in the native shell; the **Install card** must hide there (review risk).
- **Download my data** uses a `data:` link that WKWebView won't save: Filesystem + Share.
- **Delete account is more than two taps** and asks for the English word "DELETE" in Vietnamese too; sheets aren't in history, so Android back won't close them.

### What's solid (keep doing it)

Admin handoff (hashed single-use 60-second token, atomic consume, audited); the `appRoute` wrapper (club scope, CORS allow-list, origin check on cookie writes, answers parsed by the contract); server-side prices and idempotent Stripe writes elsewhere; cron secrets fail closed; hashed, scoped access keys; a contract-first API with a generated client; a strict build-time CSP; typed i18n where Vietnamese keys are required; per-account data guard and characterisation checks before every data step.
