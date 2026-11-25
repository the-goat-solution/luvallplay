# Test plan: shipping Luvallplay without anyone losing access or data

Status: **draft for review** (23 Nov 2026). Companion to [`luvallplay-build-plan.md`](./luvallplay-build-plan.md). Every phase of the build plan has to pass the gates here before it reaches production.

**Already built on this branch:** the **data guard** (`scripts/data-guard/`), with 33 tests and a copy of the real schema as a fixture (about 1,350 lines in all). It proves, person by person, that a data change didn't sign anyone out, lock anyone out or lose anyone's rows. See §4.3. Everything else in this document is the plan.

---

## 0. The ten rules (non-negotiable)

1. **Previews never touch production data.** Each preview gets its own database branch (§2). Today previews *share* the production database. That's the single biggest risk in the repo and gets fixed first.
2. **No schema change happens at request time.** Today `ensureTables()` creates and alters tables when a page loads (36 call sites). Schema changes become reviewed migration files, run by a deliberate step.
3. **Expand → migrate → contract.**
   - Add the new thing alongside the old.
   - Move the data.
   - Switch reads.
   - Remove the old thing only in a *later* release, after a quiet week.
   - The database therefore always works with both the current and the previous app version, so rolling back the app never needs a database rollback.
4. **Every data change is rehearsed on a copy of production first.** The data guard has to report zero problems, and its report is attached to the pull request.
5. **Every allowed change is written down with a reason.** The expectations file is part of the code review. "Data may change" without a reason is rejected by the tool itself.
6. **A restore point exists before every production data change, and restores are drilled.** A backup you have never restored is a hope, not a backup.
7. **Two people sign off production data changes.** Timba and Kelcee: one runs it, the other reviews the rehearsal report and watches the result.
8. **Nobody loses access, and that is checked by machine:** every live account can still sign in, sessions survive, admins keep admin, and active members still see their membership (§5).
9. **Old clients keep working.** Installed web apps, old bookmarks, emailed links, and the last **two** versions of the store app (people don't update straight away).
10. **Real personal data stays in production.** Tests use synthetic data. Debugging uses an anonymised branch. Data guard snapshots hold hashes, not emails.

---

## 1. What "ready to deploy" means

A change can go to production only when **all** of these are green:

| Gate | Checked by | Applies to |
|---|---|---|
| Types, lint, unit tests | CI (required check on `main`) | every change |
| Database integration tests + data guard scenarios | CI with a real Postgres | every change |
| Tenant-isolation and permission matrix | CI | every change from Phase 3 on |
| End-to-end critical journeys (§3.8) | CI against the preview | every change touching UI or API |
| Visual + accessibility checks per window size | CI against the preview | UI changes |
| **Rehearsal report: 0 problems** | data guard on a production branch | any change to data or schema |
| Second-person review of the rehearsal report | Timba / Kelcee | any change to data or schema |
| Restore point taken and recorded | Neon branch + dump (§4.4) | any change to data or schema |
| Manual check on real devices (§3.10) | release checklist | app releases |
| Store pre-submission checklist | release checklist | store builds |

---

## 2. Environments (fix first, Phase 0)

| Environment | Database | Payments | Email / SMS / push | Calendar sync, crons |
|---|---|---|---|---|
| **Local** | Docker or local Postgres, loaded with synthetic fixtures | Stripe test mode | Captured locally (never sent) | Off |
| **CI** | Fresh Postgres per run | Stripe test mode (mocks for unit tests) | Captured | Off |
| **Preview** (every pull request) | **Its own Neon branch**, copied from an **anonymised** staging branch | Stripe test mode | Captured: every email goes to a test inbox, SMS off, push to test devices only | Off (manual trigger only) |
| **Staging** | Neon branch of production, refreshed weekly and **anonymised** (names, emails, phones, photos replaced) | Stripe test mode | Captured | On, against a test calendar |
| **Rehearsal** | A fresh, *not* anonymised branch of production, created for one data change and deleted afterwards. Only Timba and Kelcee have access | none | none | none |
| **Production** | Neon main | Live | Live | On |

**Actions:**
- Turn on the **Vercel–Neon integration's "branch per preview"**, so a preview never sees production data.
- Remove the `pv_` table-prefix workaround once previews have their own branch.
- Move every outbound side effect (email, SMS, push, Stripe live keys, calendar writes, Akahu) behind an environment check that defaults to **off** outside production. Write one test per side effect that proves it's off on previews.

---

## 3. Test layers

### 3.1 Static checks
- TypeScript `strict`.
- ESLint, with warnings fixed down to zero and then enforced.
- zod validation at every API and form boundary, with tests that malformed input is rejected with a 400, never a 500.

### 3.2 Unit tests (`node:test`, fast, no network)
Pure logic, aiming for full coverage of the risky parts:
- **Dates and time zones:** NZ daylight-saving changeovers, play-day mapping, booking cut-offs at 17:00, membership cycles of 28/84 days, end dates including free weeks. Every club time zone gets property-based tests once clubs can pick one.
- **Money:** integer **minor units plus a currency**, never floating point. Each currency has its own exponent (NZD and AUD 2, **VND 0**), so tests run the same cases in NZD and VND (formatting, rounding, GST and VAT, refunds, offline payments). A scan fails CI on any new hard-coded `/ 100` or `* 100` on a money value.
- **Ranks, points, streaks, the leaderboard:** golden tests on recorded real-world sequences.
- **Capacity:** courts → players, mini-game cap, waitlist promotion.
- **i18n:** every English key has a Vietnamese key, and vice versa.
- **Module dependency resolution** (Phase 6): enabling a module enables what it requires; disabling one that others need is refused.
- **Payment modes:** for each mode (free, offline, online) the set of visible modules, prices and checkout steps is exactly what build plan §6.2.1 says. Mode switches obey the guards (paid → free blocked while paid subscriptions are active).
- **Colour schemes:** every scheme in `docs/plans/assets/club-color-schemes.json` (and any added later) passes the contrast floors in light and dark: text on primary and accent ≥ 4.5:1, primary on the light background ≥ 4.5:1, fills on the dark background ≥ 3:1. Runs in CI, so a new scheme can't ship without passing.
- **Imported brand colours:** the automatic contrast adjustment always returns a shade that passes, keeps the hue, changes lightness as little as possible, and leaves the original for logo use. Property-based tests over random colours.

### 3.3 Database integration tests (real Postgres)
- Every repository function runs against a real database loaded with the fixture.
- **Migrations:**
  - Apply every migration to an empty database.
  - Apply every migration to the production-shaped fixture.
  - **Schema drift check:** the schema after migrations must equal a production schema dump (`pg_dump --schema-only`, committed and refreshed), so code never assumes a column that production doesn't have.
- Constraints: unique emails, unique verified phones, foreign keys, check constraints, and `NOT NULL tenant_id`.

### 3.4 Data guard (built, see §4.3)
Runs in CI on the fixture scenarios, and on a production branch for every real data change.

### 3.5 Tenant isolation (Phase 3 onwards; the most important new suite)
"Club A sees club B's data" would end the product. The tests:
- Every repository function and every API route is called as club A against seeded clubs A and B. The suite asserts **zero** rows from B.
- It's generated from the route list, so a new endpoint without isolation coverage **fails CI**.
- **Row-level security tests:** connect as the app's database role, set `app.tenant_id` to A, and try to `SELECT/UPDATE/DELETE` B's rows, which must return or affect nothing. Then run *without* a tenant set, which must return nothing (fail closed).
- Search, leaderboards, exports, emails, crons and webhooks all get the same check. Crons are the classic leak: a job that loops over all clubs must set the tenant for each one.
- Global modules (directory, global leaderboard, social, marketplace) only expose what each club and player opted into. The tests cover opt-out, club opt-out and disabled players.

### 3.6 Permission matrix
One table drives an automated test. Every row is a role and every column a route or action, with the expected answer (allow / deny / redirect to sign-in):

| Role → | Anonymous | Player (no club) | Member | Disabled member | Coach | Club admin | Club owner | Other club's admin | Platform admin |
|---|---|---|---|---|---|---|---|---|---|
| Me page | sign-in | ✔ | ✔ | limited | ✔ | ✔ | ✔ | ✔ (own club) | ✔ |
| Club admin pages | sign-in | ✖ | ✖ | ✖ | partial | ✔ | ✔ | **✖** | ✔ |
| Add/remove admins | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✔ |
| Turn club modules on/off | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ (sees them) | ✔ (unless locked) | ✖ | ✔ (incl. lock) |
| Module availability platform-wide | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ |
| Refund / free month | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ (+step-up) | ✔ (+step-up) | ✖ | ✔ |
| Platform admin | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ |

The full matrix lives next to the tests, and every new route must add a row. Extra cases:
- Step-up: admin actions with a sign-in older than 12 hours ask for a fresh code.
- The single-use admin handoff link expires after 60 seconds and can't be replayed.
- **The last owner can't be removed or demoted.**

### 3.7 API contract and backward compatibility
- The typed API contract (`packages/api`) is snapshot-tested. Removing or renaming a field fails CI unless the API version is bumped.
- **Old-app test:** CI keeps the previous two released app bundles and runs their smoke suite against the new API, because the store app can't be updated for everyone at once.
- Webhooks and the MCP server keep their existing response shapes; integration tests replay recorded calls.

### 3.8 End-to-end critical journeys (Playwright, against the preview)

Each journey has an ID, runs in CI on phone and desktop sizes, and is also on the manual release checklist.

| ID | Journey |
|---|---|
| A1 | Sign in with an email code: new device, existing account, mixed-case email |
| A2 | Sign in with an SMS code (sandbox), and the fallback once the daily SMS cap is reached |
| A3 | Stay signed in across a deploy, a browser restart and 89 days (clock mocked) |
| A4 | Sign out of this device / sign out everywhere |
| A5 | Admin opens the admin area from the profile; non-admin can't; step-up prompt |
| A6 | Owner adds and removes an admin; last-owner protection |
| M1 | Join as monthly / quarterly member (Stripe test card), see it on Me |
| M2 | Book and pay a casual day; guest checkout; waitlist |
| M3 | "I can't make it" toggle; play calendar shows included days |
| M4 | Cancel / downgrade flow; renewal; failed payment → retry |
| M5 | Offline payment (cash / bank transfer) recorded by admin, seen by member |
| G1 | Arena challenge: post → accept → codes → score → confirm; dispute |
| G2 | Leaderboard inside Arena: filters, player card, challenge from card, opt-out hides you |
| G3 | Wolf Vision pass purchase (web: Stripe; app: in-app purchase sandbox) and session |
| P1 | Photo upload → moderation → gallery |
| P2 | Shop order (card + cash), stock decrements, cancel, collect |
| P3 | Data export; **account deletion** (and what is kept) |
| S1 | Setup wizard: create a club, pick a colour scheme, choose online payments, pick modules, launch (Phase 6) |
| S3 | **Free-play club:** set up with *Free play*. The club site says "Free to play", players join and sign up for a play day with no checkout, waitlist and "I can't make it" work, and **no price, "$0", checkout, receipt or Stripe call appears anywhere** (asserted on every page and by a Stripe mock that fails the test if called). Admin has no Money group. Later switch to cash payments and back, checking the guards |
| S5 | **Unincorporated club:** answer *Yes, we charge* → *Not incorporated*. The club is set to cash and bank transfer only. Then:<ul><li>Setup collects bank details.</li><li>A player books and sees the bank details, amount and a unique reference.</li><li>The booking shows "Awaiting payment" until an admin marks it paid, or a test bank feed matches it.</li><li>**No card form, saved card, auto-renew or Stripe call appears anywhere** (Stripe mock fails the test if called), and the card-payment API returns an error.</li><li>Admin shows Payments to check, Bank matching and Finance, but no Stripe payouts, card refunds or retries.</li></ul>Repeat for *Incorporated, no Stripe* (same result). Then *Incorporated + Stripe* connects a test-mode account and shows card checkout. Finally, "Turn on card payments" on a cash club carries prices and history over |
| S4 | **Look & feel:** pick each of the 12 schemes and confirm the club site, Me page and an email render in it, light and dark. Then import a brand: SVG logo, uploaded font, palette from the logo and from a test website. Confirm the automatic contrast fix, the generated favicon/avatar, and a revert to a preset |
| S2 | Disable a module → its screens, admin pages, API and crons disappear; data is kept and comes back on re-enable. Runs for **every** module. Also covers dependency and payment-mode blocks, the "live activity" confirmation, a platform admin locking a module (the owner can't change it and sees the reason), and a module set to *hidden* platform-wide |
| S6 | **Core-only club:** a free club with no modules runs a full month: schedule play days, members join (with approval), sign up, waitlist, a day is cancelled (members notified), attendance ticked, an announcement and an inbox reply, a second admin added. Admin shows exactly **Home · Play days · People · Messages · Website · Settings**, and no module's screen, API route, cron or email exists for this club |
| J1 | **Junior and guardian** (Phase 3b): a guardian adds two children, joins them to a club, signs a waiver, pays, and the children appear on the junior roster. A coach without a recorded safety check can't be assigned to juniors. A junior has no login, can't be messaged directly, doesn't appear on any public board, and has no social or marketplace access. The guardian exports and deletes a child's data. At 16 the profile moves to the young person's own account |
| V1 | **Vietnam club end to end** (Vietnam launch pack): a club in the Vietnam region is set up in Vietnamese; members sign up with +84 numbers and names typed with and without accents (search finds "Nguyễn" from "nguyen"); a membership in **VND** shows a VietQR code with amount and reference; a test bank-feed event matches it and marks it paid; a test gateway payment settles with a payout delay handled; no Stripe call is made; every screen and email reads correctly in Vietnamese |
| R1 | **Region routing:** a club's host name resolves to its region, requests are served only by that region's deployment, and a request for a club in another region is refused. A player in one region can't see another region's clubs or data |
| X1 | Marketplace (Phase 7): list an item, public question and answer, buyer commits, seller confirms, contact details released by email only to the two parties |

### 3.9 Visual, accessibility and performance
- Playwright screenshots of every main screen at each window class (320, 375, 600, 840, 1200, plus foldable split and tablet split).
- From Phase 6: the key club screens (site home, Me, Arena, a play-day card, an email) are snapshotted **in every colour scheme, light and dark**, plus the Three Wolves imported brand. A scheme that breaks a layout or fails axe contrast fails CI.
- Diffs are reviewed in the pull request.
- axe accessibility scan: zero serious issues.
- Lighthouse budgets for the club site (≥ 95) and app shell (≤ 150 KB JS, interactive < 1.5s on mid-range Android).

### 3.10 Native app (Phase 5)
- **Maestro** flows on the iOS Simulator and Android emulator for A1, A3, M1, G1, push open, deep link open, Android back button, and rotation or fold mid-flow with state kept.
- **Upgrade test:** install the previous store build, sign in, upgrade to the new build. The user must still be signed in (Keychain/Keystore token survives) and their data must be intact.
- **Live-update rollback:** push a broken web bundle to the beta channel and confirm the app rolls back to the last good bundle.
- **Offline:** airplane mode → cached Me/Arena show; queued "I can't make it" syncs when back online.
- **Real devices before each store release:**
  - iPhone SE, a recent Pro Max, iPad (split view and Stage Manager).
  - Galaxy Z Fold (cover and inner screens) and Z Flip.
  - Pixel phone and tablet, and one low-end Android.

### 3.11 Payments
- Stripe test mode everywhere except production.
- Webhook tests replay recorded events **twice and out of order**: the outcome must be the same (idempotency).
- **Stripe test clocks** run subscription renewals, failures and cancellations through months in minutes.
- **Stripe Connect migration** (Phase 3): rehearsed in a Stripe sandbox. A reconciliation script must show every active Stripe subscription matched to exactly one membership row before and after.
- **In-app purchase:** StoreKit testing in Xcode, Play licence testers, the RevenueCat sandbox, plus refund and restore-purchase cases.

### 3.12 Email, SMS and push
- Templates are snapshot-tested in English and Vietnamese.
- On previews every message is captured, and a test fails if anything tries to send for real.
- Each push notification type has an end-to-end test on a test device.

### 3.13 Security
- `npm audit` / Dependabot.
- Secret scanning.
- OWASP ZAP baseline scan against the preview.
- Tests for code brute force (5 tries, rate limits), session fixation, cross-origin request protection, CSP and CORS allow-lists.
- Insecure direct object references are covered by the tenant suite.
- **Brand uploads** (Phase 6):
  - SVG logos with scripts, event handlers, external references or embedded HTML must come out clean, and none of it can run.
  - Fonts and images over the size limit, with the wrong file type or malformed are refused.
  - A club's assets can't be read or replaced by another club.
- **"Import from website"** fetches only public addresses (no private, local or cloud-metadata IPs, no redirects into them), with time and size limits.
- An external penetration test before public launch of multi-club.

### 3.14 Load
k6 scripts for:
- the booking rush when a popular play day opens;
- a leaderboard storm right after scores are confirmed;
- 50 clubs' crons firing together.

Watch database CPU, connection count and p95 latency.

### 3.15 People testing
- **Bug bash** before each phase release: Timba, Kelcee and two members, 1 hour, scripted journeys plus free exploration.
- **Beta group:** the first Three Wolves members on TestFlight / Play closed testing.
- **User acceptance sign-off** (a checklist) by Timba and Kelcee before production.

---

### 3.16 Regions and country packs
- **Region isolation:** the tenant suite (§3.5) runs **per region**, and a separate suite proves a club in region A can't be read, written or even looked up from region B's deployment.
- **Routing:** the host → tenant → region lookup is tested for every host type (platform, app, admin, club subdomain, custom domain) and fails closed if the region is unknown.
- **Per-region operations:** migrations, the data guard, backups and the restore drill each run for every region before a release, with the report per region.
- **Country packs:** every pack passes the same checklist (currency exponent, tax, phone format, time zone, search collation, legal documents present, payment provider capabilities). A pack without the full checklist can't be selected in the wizard.
- **Payments interface:** every provider passes one shared contract suite (create, refund, webhook verification, **replay twice and out of order**, reconcile, capability flags). VietQR reference generation and matching, wallet payout delays and recurring-billing absence have their own cases.
- **Hanoi region:**
  - The **same migration and golden-master suites run on plain Postgres** with the standard driver, and must match the Neon driver's results.
  - The **rehearsal protocol without branches** (restore the latest backup into a scratch Postgres, run the data guard there) is drilled before the first Vietnamese club, with the report attached.
  - The **regional services matrix is enforced in CI**: a build for a region fails if it imports a provider that isn't approved for that region.
  - Storage and cron adapters pass the same contract tests as the Sydney ones.
- **MoMo:** contract tests against MoMo's sandbox: payment notifications (IPN) replayed twice and out of order, refunds, a settlement delay, a failed payment, and signature verification. Each club's own merchant credentials are isolated (the tenant suite covers them).
- **Zalo:** tests for webhook verification, the chat-window and template rules once confirmed, inbound chat becoming a linked inbox thread, member channel opt-out, account linking by phone, and a booking made from the mini app appearing in the club's admin. The mini app runs the same API contract tests as the PWA.
- **Vision revenue and consent:** a ledger test splits every pass sale by channel (web, in-app, MoMo) with GST where it applies; a cutover test proves Three Wolves' account stops taking new passes while existing passes still work; a consent test proves training footage without consent is excluded and an opt-out removes it.
- **Vietnamese quality:** an automated check finds no missing or machine-flagged Vietnamese strings, diacritics render in every font, and a Vietnamese speaker reviews the key journeys before launch.

### 3.17 Juniors and safeguarding
- **Permission matrix rows** for guardian, junior profile, junior-programme coach (with and without a recorded safety check), other clubs' admins and platform admins. Every junior-data endpoint is covered by the tenant suite.
- **Hard rules, tested:** juniors have no login, no direct messages, no social or marketplace access, no public photos or boards unless a guardian opted in (and then first name and initial only), and no Vision footage without consent.
- **Sensitive data:** medical and emergency notes are encrypted, visible only to named roles, excluded from exports to other roles, and appear in the audit log when read.
- **Data rights:** a guardian's export and deletion for a child work and leave other children and the guardian intact (the data guard checks per account).
- **Store policy review:** a written check against the Apple and Google policies on apps used by or about children before each store submission.

### 3.18 Readiness gates (release checklist)
The four hard gates and the Vietnam gate in build plan §11.3 are items on the release checklist, each with named evidence. **No outside club can be added in production while any gate item is open**, and the platform console refuses to create a non-Three-Wolves club until a platform admin has ticked each gate with a link to the evidence. Also checked automatically:
- **Metering:** every billable resource (email, SMS, storage, API calls, active players) is counted per club, and the counts reconcile with the provider invoices within a tolerance.
- **Free-tier limits:** reaching a limit shows a warning and never blocks sessions, sign-ups or admin work (tests for every limit).
- **Licences:** the CI licence report fails on any dependency outside the approved list.
- **Accounts:** an automated check lists the owners of every production account from the ownership table and fails if any has fewer than two.

### 3.19 Integrations (Track I)
- **Sandboxes:** a Xero demo company, a Shopify development store, Stripe test mode (including NZ BECS direct debit) and Windcave's test environment. CI runs recorded-response tests; a nightly job runs against the live sandboxes.
- **Contract tests per connector:** connect, reconnect, token rotation, revoke and disconnect (tokens deleted, audit written), and permission checks (only owners and admins, with step-up).
- **Credential isolation:** one club's tokens can't be read, used or replaced by another (the tenant suite, §3.5), they never appear in logs, errors or exports, and a data-guard run proves a disconnect leaves everything else intact.
- **Sync correctness (Xero and MYOB, the shared suite):**
  - **Idempotency:** replay every job twice and out of order and get one result.
  - **No deletes:** a voided payment posts a credit note, and nothing is ever deleted in the external system.
  - **Settlement:** a payout with sales, fees and refunds nets to the bank line, and the clearing account ends at zero.
  - **Rejections:** lock dates, archived accounts and rate limits end up in the error queue with the right message, and a retry succeeds once fixed.
  - **Edited externally:** a changed item is flagged, not overwritten.
  - **Totals:** the daily reconciliation report matches to the cent, in NZD.
- **NZ tax:** GST 15%, a non-GST-registered club, and donations outside GST, each against fixtures an accountant has reviewed.
- **Shopify:** products show, checkout opens on Shopify, order, payment and refund webhooks (with signature checks) create read-only orders, and **no sale is posted to Xero by default** when both connectors are on.
- **Direct debit:** authority capture with the scheme wording, notification emails (English and Vietnamese) within the required time, a delayed settlement, a failed debit, a dispute, a cancelled authority, and renewal behaviour for each.
- **Windcave:** the shared payments-provider contract suite (§3.16).
- **Entitlements and metering:** a club without the add-on can't connect or call the sync (the API refuses), a paid add-on lapsing turns the sync off without deleting mappings, and API calls, egress and connections are metered per club and reconcile with the provider's usage.

### 3.20 White-label admin (Track A)
- **Demo clubs:** synthetic clubs for each country (NZ, Australia, Vietnam when its pack exists), sport and payment mode (free, cash and bank transfer, online). Every admin page is loaded as each Demo club and must show that club's name, logo, theme, terms, currency, membership days and language, and **none of Three Wolves'**.
- **Literal scan:** CI fails on the club name, "Wolf", "NZD", weekday literals and fixed prices in admin code (fixtures and tests exempt).
- **Registry agreement:** the generated menu, the real routes, the route-ownership table and the permission matrix agree (a missing owner, an unreachable item or a path no role can open fails the build).
- **Module contract:** each module's admin passes the contract checks (manifest complete, settings schema, translations, loading, empty and error states, isolation and permission tests), and the scaffold's output passes them once the placeholders are filled.
- **On and off (S2):** for every module, switching it off removes its menu items, Today widgets, badges, search entries, settings panels and routes for that club only.
- **Capabilities:** the permission matrix is generated from module capabilities, and a role without a capability can't open the page, call the action or see the search result.
- **Presentation:** visual snapshots at 320, 375, 600, 840 and 1200 px for **two different club themes** (including Three Wolves, identical to today), light and dark, and printed report letterhead.
- **Translations:** English and Vietnamese parity for the admin namespaces, and the ratchet (untranslated strings can only go down).
- **Setup checklist:** a brand-new club shows only checklist items for its enabled modules and clears them as it completes them.

## 4. Data change protocol (the heart of this plan)

### 4.1 Classify every change

| Class | Examples | Extra steps required |
|---|---|---|
| **Additive** | New table, new nullable column, new index (`CREATE INDEX CONCURRENTLY`) | Rehearsal + data guard |
| **Transforming** | Backfill `tenant_id`, link email → `user_id`, normalise emails | Batched, idempotent backfill; rehearsal; data guard with written expectations |
| **Identity-affecting** | Anything touching accounts, emails, phones, sessions, roles, account merges | All of the above + **access checks on every account** + two-person sign-off + restore point |
| **Destructive** | Drop a column or table, delete rows, change a type | Only in a *later* release than the change that stopped using it; restore point; expectations with reasons; announced |

### 4.2 Rules for writing migrations
- One migration file per change, **forward-only**, reviewed like code, with a matching expectations file (`scripts/data-guard/expectations/<id>.json`).
- `SET lock_timeout = '3s'` and a `statement_timeout`, so a migration fails fast instead of freezing the app.
- Backfills run in batches of about 1,000 rows by primary key. They're resumable and idempotent (safe to run twice) and log their progress.
- **Never hard-delete accounts.** Use `deleted_at` + anonymisation.
- New foreign keys to accounts use `ON DELETE RESTRICT`. The existing `ON DELETE CASCADE` links get changed in Phase 2: today a single accidental `DELETE FROM players` would wipe that person's sessions, photos, messages and integrations (the data guard test "deleting an account" shows exactly this).
- No data change inside request handlers or `ensureTables()`.

### 4.3 The data guard (built)

```
npm run data-guard -- snapshot --out .data-guard/before.json      # read-only, safe on production
npm run data-guard -- check .data-guard/before.json               # access health of one snapshot
npm run data-guard -- diff before.json after.json --expect scripts/data-guard/expectations/<id>.json
npm run data-guard -- rehearse --expect <file> --run "<migration command>"   # on a branch; refuses production
```

**What it records**, inside one read-only `REPEATABLE READ` transaction:

- **Every table:** row count, the set of primary keys, and a hash of every column. Money and points columns also get their totals.
- **Every account:**
  - Sign-in identity (email hash, verified-phone hash, deleted or not).
  - Live sessions, with their latest expiry.
  - Rows of their data in every table that points at them. These are found automatically through foreign keys to the accounts table and through any `email` column, plus configured columns like Arena players.
  - Counts split by status, such as memberships by status, orders by status and roles.

**What it reports** (any error fails the run and blocks the deploy):

| Check | Meaning |
|---|---|
| `ACCOUNT_MISSING`, `ACCOUNT_DELETED` | Someone's account is gone or was deleted |
| `EMAIL_CHANGED`, `PHONE_SIGNIN_LOST` | Their sign-in code would go elsewhere or nowhere |
| `SIGNED_OUT` | They were signed in before and aren't after (natural expiry is told apart) |
| `DATA_LOST` | A person has fewer rows of something than before (attendance, bookings, active memberships, photos, orders, …) |
| `ROWS_LOST`, `ROWS_REPLACED`, `TABLE_DROPPED`, `COLUMN_DROPPED` | Data gone at table level, including rows swapped out under the same count |
| `VALUES_CHANGED`, `SUM_CHANGED` | Existing values rewritten (shows money totals before → after) |
| `AFTER_DUPLICATE_EMAIL`, `AFTER_DUPLICATE_VERIFIED_PHONE` | The change made sign-in ambiguous |
| `AFTER_NO_ADMIN` | Nobody can reach admin any more |
| `ROWS_UNLINKED` (warning) | Rows that now point at no account |
| `ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT` (warning) | A paying member who can't see their membership in the app |

- **Allowed changes** are declared per change, each with a reason of at least 10 characters: renamed tables or columns, columns allowed to change, specific account ids (a reviewed duplicate merge), or a deliberate sign-out of everyone (e.g. rotating a leaked secret).
- **Safety:** snapshots run in a read-only transaction, so Postgres itself refuses writes. Snapshots contain hashed identities only (a test checks that no email appears in the file). `rehearse` refuses to run when the target is the production database.
- **Tested** (`tests/data-guard.test.ts`, 33 tests) on a copy of the real schema with 200 accounts. Scenarios include the actual migrations this plan needs:
  - **Must pass:** the Phase 1 roles table (Timba and Kelcee as owners), the Phase 3 `tenant_id` backfill, the players → users rename, email normalisation, and a properly reviewed duplicate merge.
  - **Must be caught:** a deleted account (and its cascade), soft deletes, wiped sessions, a changed email, two accounts merged onto one email, a dropped phone column, cancelled memberships, lost attendance, rewritten money, swapped rows, a careless merge, unlinked orders, an empty roles table, and a table without a primary key losing a row.

### 4.4 Runbook for one production data change

| When | Step | Who |
|---|---|---|
| T−7 days | Migration + expectations file + tests in a pull request. CI green (fixture scenarios). | Builder |
| T−5 | **Rehearsal 1:** create a Neon branch of production → `data-guard rehearse`. Attach `report.md` to the PR. Record duration and any lock waits. | Builder |
| T−5 | Point a preview at the rehearsal branch. Run E2E journeys A1–A6, M1–M5 and G1–G2 with test accounts per role. | Builder |
| T−4 | **Characterisation check:** for every account, compare its API view (Me, membership, stats, leaderboard rank) before vs after on the branch. It must be identical except for the declared changes. | Builder |
| T−3 | Review the reports. Second sign-off. | Reviewer |
| T−2 | **Restore drill** (first change of each phase): restore yesterday's point-in-time copy to a scratch branch and run `data-guard check` on it. | Builder |
| T−1 | Tell members if anything is visible (e.g. "please sign in again in the app"). Pick a quiet time (not a play-day evening). | Timba / Kelcee |
| T0 | **Restore point:** create a named Neon branch `pre-<change>` (instant) and an encrypted `pg_dump` kept off-site. Confirm the point-in-time window covers the next 7 days. | Builder |
| T0 | `data-guard snapshot` on production (read-only) → run the migration → `snapshot` again → `diff --expect`. The production expectations list live-traffic tables as volatile (sessions' `last_seen_at`, rate-limit logs). | Builder, reviewer watching |
| T0 | Deploy the app version that uses the new structure (old structure still in place). Smoke test sign-in, Me, booking and admin with test accounts. | Builder |
| T0 + 1h | Watch sign-in success rate, 401/403 rate, error rate, and webhook failures. | Both |
| T+1…T+7 | Nightly `data-guard check` on production with alerts. Stripe reconciliation stays clean. Watch the support inbox. | Automated |
| T+7 or later | *Contract* step (remove old columns/tables) as its own change, with its own rehearsal. | Builder |

**When to roll back:**
- Any data-guard error.
- Sign-in success drops by more than 2 percentage points.
- Any report of a missing membership, booking or history.

**How to roll back:**
1. **App:** Vercel instant rollback. This always works because of expand/contract.
2. **Data:** if data itself is wrong, fix it forward from the `pre-<change>` branch for the affected rows only. Do a full point-in-time restore only as a last resort, with a plan to replay the writes made since.

### 4.5 High-risk changes in this programme, and their specific tests

| Change (phase) | Specific risk | Extra tests |
|---|---|---|
| Admin by account roles (1) | Admins locked out; non-admins let in | Rehearsal: roles table + owners. `AFTER_NO_ADMIN` check. Permission matrix. Break-glass grant script tested on a branch. Password login kept 2 weeks |
| Profile route merge (1) | Bookmarks, home-screen icon and emailed links break | Redirect test for every old URL (`/profile/account`, `/profile/membership`, `/leaderboard`, manifest shortcuts, links in sent emails) |
| Database driver swap and Drizzle (2) | A query quietly returns different results | **Golden master tests:** old and new repository functions run on the same fixture and must return identical results for every function |
| `ensureTables()` → migrations (2) | Migrated schema differs from production | Schema drift check (§3.3) must be empty before the switch |
| Cascade → restrict foreign keys (2) | An account deletion that used to work now errors | Deletion journey P3; data guard confirms nothing else changed |
| Multi-tenant backfill (3) | Rows without a club; wrong club; email links broken | Data guard (all accounts' data counts unchanged). Every row has `tenant_id`. **Shadow reads for a week:** new club-aware queries run beside the old ones and log any difference. Isolation suite. Characterisation check |
| Email → user id links (3) | History detaches from people | `DATA_LOST` per person; `ROWS_UNLINKED` must not grow. Resolve every `ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT` *before* the change |
| Moving to luvallplay domains (4–6) | Cookies are per domain: **everyone signed out** | Planned: a signed-in visit to threewolvesbadminton.org hands the session over to app.luvallplay.com with a one-time link. The rest sign in once with a code. Declared `allowSignOut` only for unvisited sessions; members told in advance |
| Stripe Connect (3) | Subscriptions charged twice, or not at all | Sandbox rehearsal. Reconciliation (every active subscription ↔ one membership) before and after. Test clocks across a renewal |
| Account merge / deletion tools (all) | Wrong person's data moved or wiped | Expectations name the exact account ids. Finance records are kept on deletion (anonymised, not removed) |
| Store app launch (5) | People can't sign in on the new app | Review demo account. Upgrade test. Sign-in journey on every device in the matrix |
| Three Wolves theme → imported brand (6) | The live club's look changes, or a member sees another club's colours | Characterisation screenshots of Three Wolves before and after must match. Tenant suite covers theme and assets |
| Switching a club's payment mode (6) | Paying members lose paid-for access, or get charged after going free | Mode-switch guard tests. Data guard: memberships by status unchanged. Stripe reconciliation after the switch |

---

## 5. Access guarantees ("no one loses access")

Each guarantee has an automatic check:

| Guarantee | Checked by |
|---|---|
| Every live account has exactly one, non-empty, unique email (ignoring case and spaces) | `check` → `EMPTY_EMAIL`, `DUPLICATE_EMAIL`; nightly on production |
| Verified phones are unique | `DUPLICATE_VERIFIED_PHONE` |
| Signed-in people stay signed in across deploys and migrations | `SIGNED_OUT` diff; journey A3 |
| Every club has at least one owner, and the last owner can't be removed | `AFTER_NO_ADMIN`; permission matrix |
| Timba and Kelcee always keep platform-admin access | Granted by script with an audit log entry. A break-glass script run from a trusted machine with production credentials is tested on a branch each phase |
| Active members see their membership in the app | `ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT` resolved before Phase 3; journey M1 |
| Old links and installed apps still open | Redirect tests; manifest `start_url` test; old-app contract tests |
| Disabled players (club decision) lose club access but keep their account and data, and can be re-enabled | Journey S2-style test for player disable/enable |

---

## 6. CI pipeline (Phase 0)

On every pull request, and required before merging to `main`:

1. `npm ci` → `tsc --noEmit` → `eslint` → unit tests.
2. Postgres service → integration tests + **data guard scenarios** (`DATA_GUARD_REQUIRE_DB=1`, so they can't be skipped silently).
3. Build.
4. Preview deploy on its own Neon branch → Playwright journeys, visual diffs, axe scan, Lighthouse.
5. From Phase 3: tenant-isolation suite and permission matrix. From Phase 5: Maestro flows on emulators (nightly plus before a release).

**Branch protection on `main`:**
- Required checks.
- One review.
- No direct pushes.
- Vercel production deploys only from `main`.

---

## 7. Test data and privacy

- **Synthetic fixtures only** in tests (`tests/fixtures/`). They include the awkward cases on purpose: mixed-case emails, deleted accounts, expired sessions, members without accounts, guests.
- **Anonymised staging:** names, emails and phones replaced; photos swapped for placeholders; Stripe ids kept as fake strings.
- **Real data** only in production and short-lived rehearsal branches, which are deleted after use and accessible only to Timba and Kelcee.
- **Production test accounts:** one per role, flagged `is_test`, hidden from leaderboards, emails and reports. Used for smoke tests after deploys. The Apple review demo account is one of these.
- **Data guard files** hold hashed identities only, and are git-ignored (`/.data-guard`).

---

## 8. Monitoring after release

- **Sentry** on web, server and the native apps, with release tracking, so errors are tied to a deploy.
- **Uptime checks** every 5 minutes on the health endpoint, the sign-in page and the API.
- **Dashboards:**
  - sign-in codes sent vs completed;
  - 401/403 rate;
  - webhook failures;
  - cron failures;
  - push delivery.
- **Nightly jobs:** `data-guard check` on production (duplicates, orphaned memberships, missing owners) and the existing Stripe sync; alerts go to the admins.

---

## 9. Phase gates

| Phase | Must pass before production |
|---|---|
| 0 Environments + CI | Previews on their own branches (proved by a test that a preview write never reaches production). CI required on `main`. Restore drill done once |
| 1 Tidy Three Wolves | Journeys A1–A6, M1–M5, G1–G2. Redirect tests. Roles rehearsal report clean. Bug bash |
| 2 Foundations | Golden master tests. Schema drift empty. All Phase 1 journeys still green |
| 3 Multi-tenant | Isolation suite, permission matrix, shadow reads clean for 7 days, data guard clean, Stripe reconciliation, characterisation check, **region routing R1 (one region live)**, minor-unit money audit with VND tests, guardianship tables in place |
| 4 API-driven app | Contract tests, old-client tests, offline tests, **club theming (decision AM):** the club's look fills the app after sign-in, switching clubs changes it at once, a club's invite link applies that club's look first, and Three Wolves looks identical to today's app |
| 5 Store apps | Device matrix, upgrade test, in-app purchase sandbox, store checklist, beta feedback, **the Luvallplay frame (decision AM):** the store icon, splash and sign-in screens stay Luvallplay for every club, the "on Luvallplay" footer is present, and a **Club admin** tap opens the web admin through the handoff link without a second sign-in |
| R Intro website | Every page complete in English and Vietnamese (an automated check finds no missing translation, alt text or meta tag), `hreflang` correct, language switch remembered. Visual snapshots of both languages at every width in light and dark. Lighthouse ≥ 95, axe clean. Waitlist: Turnstile, double opt-in, consent stored, duplicates handled, nothing sent from previews. No tracking cookies. Motion checks:<ul><li>With `prefers-reduced-motion` the page has no movement.</li><li>With scroll-driven animations and view transitions turned off, everything still shows complete.</li><li>Nothing loops.</li><li>The rotating sport word pauses on hover and focus and is read as plain text.</li></ul>Performance budgets: LCP < 2.0s on throttled 4G mid-range Android, home-page JS < 80 KB, page < 1 MB. Interactive demos (scheme picker, build your club, sport switch) work by keyboard and touch |
| 6 Brand, sites, wizard | S1–S6, the payment-mode × admin-area table in build plan §6.2.2 as an automated test, every colour scheme passes contrast and visual checks, brand upload security tests, Lighthouse ≥ 95, accessibility clean, custom-domain tests |
| 3b Junior accounts | J1, the junior permission matrix (§3.17), the data guard per account for guardian export and deletion, store-policy review, a safeguarding review with someone experienced in junior sport |
| B Business foundations | All four hard gates ticked with evidence (§3.18). Gate checks pass |
| V Vietnam launch | V1, R1, the Vietnam region isolation, **the Hanoi restore drill and the no-branch rehearsal**, the regional services matrix check, MoMo and Zalo contract tests, payments contract suite for the Vietnamese providers, Vietnamese quality review, **Vietnamese counsel sign-off**, Vietnam trademark filed |
| A White-label admin | §3.20 complete; the literal scan green; steps A1 to A3 done before any outside club is created; Three Wolves' admin visually identical to today |
| I Integrations (NZ) | §3.19 complete for each connector shipped, live NZ billing in place, the Xero security self-assessment started, direct-debit scheme checks reviewed, and the accountant's review of the GST and mapping fixtures |
| 7 Global modules | Opt-in/out tests, **the §8 gate evidence** (thresholds, moderation owner, the country's legal checks), moderation and safeguarding flows (adults only), marketplace X1, abuse reports |

---

## 10. Best-practice advice in short

- **The cheapest outage is the one rehearsed on a copy.** Neon branches make full-size rehearsals instant and free, so rehearse every data change, not just the scary ones.
- **Make the database tolerant, not the deploy perfect.** Expand/contract means every step can be rolled back by redeploying the previous app, without touching data.
- **Test people, not totals.** Row counts can match while one member's history moved to someone else. That's why the data guard counts *per account*.
- **Write the reasons down.** An expectations file with reasons turns "I think this is fine" into something a second person can check.
- **Watch the first hour.** Most migration problems show up as sign-in failures and support messages within minutes. Be ready, and know your rollback before you start.
- **Never test with real people's data outside production.** Anonymise, and treat rehearsal branches as production.
