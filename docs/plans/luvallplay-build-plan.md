# Build plan: from Three Wolves to Luvallplay

Status: **draft for review** (22 Nov 2026). Items marked **🟡 Decision** need your answer before that phase starts. Each has my recommendation, so you can just say "go with the recommendation".

**Decided (22 Nov):**
- **A:** one **Luvallplay** store app, with Three Wolves as a club inside it (its own theme and terms).
- **B:** store launch **after** the multi-tenant core (Phase 3). Members use the PWA until then.
- **C:** Wolf Vision passes are sold by **in-app purchase** (RevenueCat) in the store apps, and by Stripe on the web.
- **D:** club website content lives in a **built-in editor** in Luvallplay Admin. Sanity is kept for Luvallplay's own marketing, blog and help content.

**Decided (23 Nov):**
- **E:** **free for every club for now**, with paid plans built in but switched off (§6.5). *Refined by U (§11.2): free for NZ badminton for good, paid elsewhere.*
- **F:** the brand is **Luvallplay**. The domain to buy is **luvallplay.org** (not luvplayall.org), ideally with luvallplay.com and luvallplay.nz. The brand concept is in §7.1.
- **G:** the marketplace has **both club/shop storefronts and player-to-player listings**, with the scope set in the research thread (§8).
- **H:** ~~no under-16s~~. **Superseded by V:** junior accounts are built early, managed by a guardian (§6.8).
- **I:** **Timba and Kelcee are both Three Wolves owners and Luvallplay platform admins.** Owners can add and remove admins from the admin pages (§2.4).
- **J:** English and Vietnamese only for now.
- **K:** developer accounts and D-U-N-S are registered under **The GOAT Solution (TGS, Vietnam)**. *The Stripe platform account moves to the NZ company (S).*

**Added (23 Nov):**
- **L: free-play clubs.** Some clubs charge nothing at all. Every club picks a **payment mode**: *Free play* (no payments anywhere, no Stripe), *Cash or bank transfer*, or *Online payments*. A free-play club gets the full product without a single price on screen (§6.2.1).
- **M: 12 ready-made colour schemes** for new clubs, each tested for contrast in light and dark mode (§6.3.1, preview in `docs/plans/assets/club-color-schemes.png`).
- **N: bring your own brand.** Clubs can import their own logo, font and colour palette, or pull them from their existing website (§6.3.2).
- **O: online payments only for incorporated clubs with their own Stripe account.** Setup asks both questions; every other paying club is set up for cash and bank transfer only, with an admin area built for that (§6.2.2). Three Wolves never collects or passes on money for other clubs (Stripe forbids it, and it would make the collector a regulated money-transfer business under NZ's AML/CFT Act).
- **P: a small core admin; everything else is a module.** The core is only what a free, no-money club needs to run play days. Every other admin area is a module that can be turned on or off during setup, by the club's owners, or by Luvallplay's platform admins (§6.2.3).
- **Q: Luvallplay is about sport in general, not just badminton.** Badminton is the first sport, not the limit. Product and marketing words are sport-neutral ("session", "game", "court or field"). Every club lists its sports. Vocabulary, scoring and leaderboards come per sport, and badminton-only features (Vision) are modules other sports can gain later (§6.7). The brand book is updated to match.
- **R: a Luvallplay introduction website** in English and Vietnamese, multi-sport, following the brand system (§7.4). It can be built now, in parallel with the app work.

**Decided (23 Nov, plan review).** Reasoning and open points are in [`luvallplay-plan-review.md`](./luvallplay-plan-review.md); the detail is in §11.
- **S: who operates what.** TGS is registered in **Vietnam**. A **NZ company owned by TGS** runs the platform for NZ and Australia: it contracts with clubs, holds the Stripe Connect platform account and is accountable under NZ privacy law (it needs a NZ-resident director). TGS owns the IP and brand, licenses it to the NZ company, and runs the **Vietnam** business (§11.1).
- **T: "white-label" means a shared Luvallplay app with club branding** (decision A stands). Own-branded apps and reselling aren't planned, but nothing in the design should block them later.
- **U: commercial model.** **NZ badminton clubs are free for good.** Other sports and other markets pay. The **first paid market is Vietnam**, then other sports in NZ through the NZ company. Paid plans therefore become real, not just hidden, before the first paid club (§11.2).
- **V: junior accounts are built early.** Guardian-managed profiles, right after Phase 3 and before the first paid market (§6.8).
- **W: four hard gates before the first outside club:** a lawyer-reviewed legal pack, accounts/domains/trademark in company ownership, an IP and licence audit, and a cost model with usage metering and free-tier limits (§11.3).
- **X: Vietnam launch scope.** Club tools with VietQR bank transfer, local online payments, and Zalo support. **Social and marketplace are in Vietnam's roadmap, but gated by Z.** A discovery round with 5 to 10 Vietnamese clubs starts now, with no engineering needed (§11.4).
- **Y: region-aware from the start.** Every club has a region and the platform can run separate regional deployments. Sydney is live first; where Vietnam's data lives is decided with Vietnamese counsel (§6.9).
- **Z: social and marketplace are gated** by real thresholds and each country's legal checks. **Find a club** and per-sport ratings come first (§8).
- **AA: Kelcee** is President of Three Wolves, unpaid, with no equity or fee. Kelcee stays a platform admin, but only after signing a confidentiality and data-handling agreement with the NZ company (§11.1).
- **AB: Timba is the NZ company's resident director**, while also TGS's CEO and Three Wolves' Treasurer. Rules to manage the three roles are in §11.1.
- **AC: Vietnam's online payments use MoMo**, with **each club connecting its own MoMo merchant account** (Luvallplay never holds club money). VietQR bank transfer is the default for clubs that can't. MoMo's own rules are **unverified** (§6.5, §11.4).
- **AD: Zalo support means chat and booking.** **One Luvallplay Official Account** messages members for all clubs, and one Luvallplay mini app offers booking, with club pages. Zalo's rules are **unverified** (§11.4).
- **AE: the Vietnam region is hosted in Hanoi**, on a Vietnamese cloud with managed services, run by TGS engineers. That means a second hosting stack, because Vercel and Neon have no Hanoi region (§6.9).
- **AF: Vision is a platform product, and its revenue goes to TGS** (§11.2).
- **AG: one integration framework, many connectors** (§12.1), with a prioritised NZ catalogue (§12.2).
- **AH: Shopify connector (§12.5):** a club connects its own Shopify store; Luvallplay shows its products in the Shop tab and app, and buyers **check out on Shopify** (Shop Pay, Apple Pay, cards). Order notifications come back into Luvallplay. Start with a custom app per partner club; a public Shopify app is a later, separate decision.
- **AI: Xero scope (§12.3):** push **sales, payments, fees, refunds and expenses**, and pull **accounts, tax rates, tracking categories and bank accounts**. Bank lines stay with Xero's own bank feed.
- **AJ: NZ launch bar (§12.6):** before the first paid NZ club, **NZ direct debit for memberships**, a **MYOB connector** and the **Windcave gateway** are ready. Pay by bank (open banking) is not required for launch.
- **AK: the Xero connection is a paid add-on** (decided 24 Nov). It's priced to cover Xero's developer-tier costs, certification and support. *Assumptions to confirm (§12.9): the MYOB connector is a paid add-on too; the Shopify connector, direct debit and Windcave are included in base plans; Three Wolves gets add-ons free under its licence.*
- **First outside feedback:** the current order stays (outside clubs join after the setup wizard). Recruiting and interviews, which need no engineering, still start now.

**Testing:** every phase passes the gates in [`luvallplay-test-plan.md`](./luvallplay-test-plan.md) before production. The data guard that proves no one lost access or data is already built (`scripts/data-guard/`).

> **Luvallplay:** "Love all, play" is the call that starts a game in badminton, tennis, squash and table tennis, and it reads as an invitation to everyone: love all, come and play. Luvallplay is a platform for **sports clubs of every kind**. It starts with badminton (Three Wolves is club #1) and is built so any club that runs regular sessions can use it (§6.7).

---

## 0. Executive summary

The work runs in **8 phases (0–7) over roughly 23–29 weeks** of focused build time. Each phase ships something usable, so Three Wolves keeps running in production the whole way.

| # | Phase | What you get | Est. |
|---|---|---|---|
| 0 | **Safety net** | Previews on their own database branches (today they share production), CI required on `main`, restore drill, data guard in CI ([test plan](./luvallplay-test-plan.md)) | 1 wk |
| 1 | **Tidy the Three Wolves app** | Leaderboard inside Arena; Account and Membership merged into one **Me** page; admin access by player account (Timba and Kelcee), with a button from their profile; dead code removed | 2–3 wks |
| 2 | **New foundations** | Monorepo, Next.js 16, Neon + Drizzle with real migrations, module system skeleton, design tokens | 2–3 wks |
| 3 | **Multi-tenant core** | `tenants`, global user accounts, club roles, `tenant_id` + row-level security on every table, club settings replacing hard-coded constants. Three Wolves becomes club #1 | 4–5 wks |
| 4 | **Player app as an API-driven app** | The profile app rebuilt as a client-side app (same screens and code where possible) talking to a typed API with token auth. Runs on the web (PWA) and inside Capacitor | 3–4 wks |
| 5 | **Capacitor + store readiness** | iOS and Android apps tuned for phones, foldables and tablets, with push, deep links, secure sign-in, a privacy manifest, store listings, TestFlight and Play testing | 3–4 wks |
| 6 | **Luvallplay brand, websites and setup wizard** | Platform site (luvallplay.com), club landing pages driven by templates, custom domains, a modular setup wizard, and Admin → Modules | 3–4 wks |
| 3b | **Junior accounts** | Guardian-managed junior profiles, safeguarding rules and forms (§6.8) | 2–3 wks |
| 7 | **Global modules** | Find a club nearby, then per-sport leaderboards. Social and marketplace only when the gate passes (§8, §11.6). Each module is opt-in per club | 3–5 wks each |
| B | **Business foundations (track)** | NZ company, legal pack, company-owned accounts, trademark, IP audit, cost model and metering: the hard gates in §11.3. Runs from week 0 beside Phase 2 | weeks 0–8 |
| V | **Vietnam launch pack (track)** | Discovery now; then VietQR and local payments, Zalo, Vietnamese localisation, region (§11.4). Social and marketplace stay gated | 8–12 wks build |

**My biggest recommendations (detail in each section):**

1. **One store app called "Luvallplay", with Three Wolves as a club inside it.** It wears Three Wolves colours, logo and "Wolf" terms. Shipping a separate branded app per club breaks Apple's template-app rule (4.2.6) unless each club submits the app from its own developer account.
2. **Don't wrap the live website in Capacitor** (`server.url`). The Capacitor team says that setting is for development, and Apple treats it as a grey area. Bundle the player app's code inside the app and let it talk to the API. That's Phase 4, and it's the biggest single chunk of work.
3. **Wolf Vision passes are digital goods.** In the iOS app they have to go through Apple's in-app purchase, or not be sold in the app at all. Memberships, play days and merch are real-world services and can stay on Stripe.
4. **Admin access becomes a role on your normal account.** `ADMIN_PASSWORD` is kept only as a break-glass option for two weeks, then removed.
5. **Club website content moves out of Sanity into a built-in editor** in Luvallplay Admin. Sanity stays for Luvallplay's own site, blog and help centre. Clubs shouldn't need a Sanity seat to change their opening hours.
6. **Register Apple and Google *organization* developer accounts now.** You need a company and a D-U-N-S number. Personal Google accounts must run a 14-day, 12-tester closed test before production, and the App Store would show a person's name as the seller.

---

## 1. Where the code is today (audit)

What I found reading the repo. This drives the clean-up list in §5.

| Area | Today | Problem for what's next |
|---|---|---|
| Framework | Next.js 15 App Router, server-rendered profile (`app/profile/*` reads the DB in server components) | Can't be bundled into Capacitor as-is |
| Auth | Player: 6-digit email/SMS codes, httpOnly `tw_player` cookie, hashed sessions (good). Admin: one shared `ADMIN_PASSWORD` behind an HMAC cookie (`lib/admin-session.ts`) | No per-person admin, no audit trail, no roles |
| Data | `@vercel/postgres` (Vercel has moved these databases to Neon; Neon recommends switching drivers), **56 tables**, created at runtime by `ensureTables()` (**36 calls in `app/`**), raw SQL in 8 page/route files, `lib/db.ts` is 1,900 lines | No migrations, no `tenant_id`, records linked by **email** rather than user id |
| Club-specific constants | Prices, Wednesday/Friday membership days, court→player caps, booking cut-off (`lib/constants.ts`); `Pacific/Auckland` hard-coded; **"Three Wolves" appears 192 times in 67 files** | All of these become per-club settings |
| UI | CSS Modules (good). `styled-components` is installed but **not imported anywhere**. 5 near-identical `*ToastBridge` components. Inline style objects in admin (`AdminNav`, admin login) | Needs a shared design system and admin UI kit |
| i18n | en + vi, split over 4 dictionaries (`i18n`, `profile-i18n`, `arena-i18n`, `jersey-i18n`) | Unify into one typed system per module |
| Sanity | Content (hero, about, gallery, reviews) **mixed with business config** (pricing plans incl. `stripePriceId`, casual spots, booking lock days). Studio embedded at `/studio` | Business config belongs in the database; Studio bloats the web app |
| PWA | Manifest, service worker, install guide, safe-area handling, `viewport-fit=cover` | Good base. Most of the mobile CSS carries over |
| API | `/api/v1` (REST) + `/api/mcp` with bearer tokens, CORS `*` | Good base for the app API. Needs tenant scope |
| Tests | 13 `node --test` unit files | No end-to-end, visual or tenant-isolation tests |

---

## 2. Phase 1: tidy the Three Wolves app (requests 1, 4)

Done inside the current codebase and shipped to threewolvesbadminton.org. It's low risk, members see the improvement straight away, and it sets the shape the app keeps.

### 2.1 New app navigation

Today's tabs: Account · Membership · Arena · Wolf Vision · Player. The new tabs:

| Tab | Contains |
|---|---|
| **Me** (home) | Account + Membership merged (see 2.2) |
| **Arena** | Segmented control: **Challenges · Leaderboard · Ranks** |
| **Vision** | Wolf Vision (unchanged; label comes from club terms) |
| **Player** | Stats, streaks, charts, photos |
| *(Phase 7)* **Discover** | Clubs nearby, social feed. Only shown when the club takes part in global modules |

Four tabs now and five at most later, which follows Apple's Human Interface Guidelines and Material 3. On medium and wider windows the bottom bar becomes a **navigation rail**, and on large windows a **sidebar** (§4.4).

### 2.2 "Me" page: Account + Membership in one

A single page that answers *"What's my status, and what's next?"*, with settings moved one tap away.

```
┌ Header: avatar · name · membership pill (Active · renews 12 Dec) · 🔔 inbox badge · ⚙ settings ┐
│ [Club admin →]   ← only for club admins (2.4)                                                   │
├ Next up: your next play day (date, venue, "I can't make it" toggle)                              │
├ Membership card (plan, renews/ends, manage) — or Join panel if not a member                      │
├ Play calendar (book & pay casual days, see included days)                                        │
├ Shop (club jersey + merch, my orders)                                                            │
└ Welcome card (first visit only)                                                                  │
```

- **Inbox** (admin messages) moves to the header bell. It opens as a sheet on phones and as list + thread side by side on tablets.
- **Settings** (⚙) collects details, phone, language, privacy (leaderboard opt-out), connected apps (API tokens, moved from the Player tab), install guide (web only; hidden in the native app), export data, **delete account**, and sign out.
- Tablet/foldable layout: two columns. The left column holds Next up, Membership and Calendar; the right holds Shop and the Inbox preview.
- `/profile/account` and `/profile/membership` redirect permanently to `/profile` (`/profile/me`), so old links, emails and home-screen shortcuts still work.

### 2.3 Leaderboard into Arena

- Move `components/leaderboard/LeaderboardView.tsx` into the Arena as the **Leaderboard** segment. It keeps the source filters (all · challenges · play · round robin) and periods (month · quarter · year · all time).
- Tapping a row opens a **player card** sheet: rank art, Wolf Points, recent form, and a "Challenge" button that goes straight into the challenge flow. That join-up is the reason to move it.
- The public `/leaderboard` page becomes a **teaser** on the club landing page: top 5 with first names only, plus a "See the full board in the app" call to action. The old URL redirects to it. This drives app sign-ins and stops publishing members' full names. The existing opt-out still applies.
- Caching stays as it is (`unstable_cache` + `revalidateTag("leaderboard")`).

### 2.4 Admin through your normal account

- New table `club_roles(player_id, role)` with roles `owner | admin | coach`. In Phase 3 it becomes `club_members.role` with a `tenant_id`.
- **Timba and Kelcee → `owner` of Three Wolves, and platform admins** (`platform_admins` table from Phase 3). The first grant is made by a one-off script (`scripts/grant-role.mjs --email … --role owner`) run against production. Their emails are passed in when the script runs, never committed to the repo. The grant is rehearsed with the data guard first ([test plan §4.5](./luvallplay-test-plan.md)).
- **Admin → People → Admins page:**
  - Owners add an admin by email: an existing account gets the role straight away, and anyone else gets an invite that applies the role when they first sign in.
  - Roles to choose from: `owner`, `admin`, `coach`. Owners can also remove admins or change their roles.
  - Guardrails:
    - The **last owner can't be removed or demoted**.
    - Every change needs a fresh sign-in code (step-up).
    - Every change is written to the audit log.
    - The new admin and all existing owners get an email.
  - Platform admins have the same page for any club, plus a **Platform → Admins** page for the platform-admin list.
- `/admin/*` requires a signed-in player with an admin role. The middleware stops checking the password cookie, and `/admin/login` redirects to `/login?next=/admin`.
- **Step-up check:** admin pages need a sign-in within the last 12 hours. Otherwise they ask for a fresh code. This is the usual practice for privileged areas, and it matters because player sessions last 90 days.
- **"Club admin" button** in the Me header and in Settings, visible only to admins. On the web it links to `/admin`. In the native app it requests a single-use, 60-second **handoff link**, then opens admin in the in-app browser already signed in (the app's token never leaves the app).
- **Audit log** (`admin_audit_log`: who, what, when, target). Every admin action writes a row: refunds, free months, merges, cancellations, stock changes.
- `ADMIN_PASSWORD` stays for **two weeks** as a break-glass login, then it's removed. Removing it also removes the fallback secret in `lib/player-auth.ts`, so `PLAYER_SESSION_SECRET` becomes mandatory.

### 2.5 Quick clean-ups done in this phase

- Remove the unused `styled-components` dependency.
- Replace the 5 `*ToastBridge` components with one `useFlashToast()` hook.
- Pull admin inline styles into an `admin` UI kit: `PageHeader`, `DataTable`, `Badge`, `Toolbar`, `EmptyState`, `ConfirmButton`.
- Delete the `/match-analyzer` redirects once analytics show they're no longer hit.

**Phase 1 done when:** the new tab bar is live, Timba and Kelcee reach admin from their profile without a password, the audit log is recording, and nothing has regressed on iPhone, Android or iPad.

---

## 3. Phase 2: new foundations

### 3.1 Monorepo layout (Turborepo + pnpm workspaces)

```
luvallplay/
├─ apps/
│  ├─ web/            Next.js 16 — luvallplay.com, club sites ({club}.luvallplay.com + custom domains),
│  │                  admin (admin.luvallplay.com), API (api.luvallplay.com), setup wizard
│  ├─ app/            Player app — Vite + React 19 + TanStack Router/Query, built to static files.
│  │                  Served as a PWA at app.luvallplay.com AND bundled into Capacitor
│  ├─ native/         Capacitor 8 shell (ios/, android/) wrapping apps/app's build output
│  └─ studio/         Sanity Studio (deployed on its own; Luvallplay marketing/help content)
├─ packages/
│  ├─ core/           Pure TypeScript domain logic: dates/time zones, ranks, stats periods, money, validation
│  ├─ db/             Drizzle schema, migrations, RLS policies, tenant-scoped client, seed scripts
│  ├─ api/            Typed API contract (zod) + generated client used by apps/app and apps/web
│  ├─ auth/           Code sign-in, sessions (cookie + bearer), roles, step-up, admin handoff
│  ├─ ui/             Design system: tokens, theming, components (shared by app, web, admin)
│  ├─ i18n/           Typed messages, per-module namespaces, en + vi (+ more later)
│  ├─ modules/        One package per feature module (§6.2), each with server, app, admin and site parts
│  │  ├─ play-days/  memberships/  casual-play/  round-robin/  arena/  vision/
│  │  ├─ shop/  gallery/  messages/  donations/  finance/  bank-nz/  integrations/
│  ├─ global/         Platform-wide modules: directory/  leaderboards/  social/  marketplace/
│  ├─ site-templates/ Club landing page sections and templates
│  └─ config/         tsconfig, eslint, prettier, tailwind-free CSS tokens build
└─ tooling/           scripts (grant-role, tenant import, Stripe setup), CI workflows
```

**Why a separate Vite app for the player app, not a Next.js static export:**
- Next.js `output: 'export'` turns off server features, needs every dynamic route listed at build time, and has no middleware. In practice you'd be fighting the framework.
- A Vite single-page app with file-based routing (TanStack Router) builds in seconds, works offline with a cached query store, and is the most common Capacitor setup.
- The existing React components and CSS Modules carry over almost unchanged. Only data loading changes, from server components to API queries.

### 3.2 Platform upgrades

| From | To | Why |
|---|---|---|
| Next.js 15 | **Next.js 16** (`middleware.ts` → `proxy.ts`, Turbopack default) | Current major, Node runtime for the proxy (needed for tenant lookup) |
| `@vercel/postgres` + runtime DDL | **Neon serverless driver + Drizzle ORM + versioned migrations** | Vercel's Postgres now runs on Neon. Migrations run in CI, not on page load. Typed queries |
| Ad-hoc `sql.query` in pages | Repository functions per module (`packages/modules/*/server/repo.ts`) | One place per table, easy tenant scoping |
| Flat `lib/` (~100 files) | Modules (§6) | Each feature is self-contained and can be switched on or off |
| 4 i18n dictionaries | `packages/i18n` with per-module namespaces | One system, typed keys, club-selectable languages |
| Sanity Studio inside the web app | Separate Studio deploy | Smaller web bundle, simpler CSP |

**Neon branches** give a full copy of production for each pull request, so every migration (especially Phase 3) is rehearsed on real data before it runs on production.

### 3.3 Phase 2 delivery log and plan changes

Phase 2 ships as a sequence of small pull requests, each deployable and revertable on its own: (1) Drizzle schema + baseline migration + drift check → (2) driver swap behind repositories with golden master tests → (3) remove `ensureTables()` → (4) account foreign keys `CASCADE` → `RESTRICT` (rehearsed data change) → (5) Next.js 16 → (6) Sanity business config → database → (7) monorepo move → (8) module skeleton, design tokens, i18n merge.

Findings and changes recorded as the work goes:

- **Production runs Postgres 18** (Neon project `three-wolves-sydney`). CI now uses `postgres:18`, so the schema drift check compares like with like (Postgres 18 lists named NOT NULL constraints in the catalog).
- **Schema dump refreshed** (23 Nov) from a Neon branch of production: the earlier dump predated the Phase 1 roles tables. The dump now also lists sequences. It's split into a frozen `docs/schema/production-2026-11.sql` (the baseline) and `docs/schema/production.sql` (after every migration).
- **The baseline migration is generated from the real production schema**, not from `ensureTables()`. The two differ: a database built only by `ensureTables()` lacks `schema_runs`, `cancellation_feedback` and the preview `pv_*` tables, and gives `sessions.max_spots` a default of 12 where production has **8** (from the old `scripts/migrate.mjs`, now removed). The baseline keeps production's 8. The app always passes `max_spots` explicitly, so this changes nothing for members.
- **Migrations live in `db/migrations`** (Drizzle Kit layout), applied by `npm run db:migrate` (`scripts/db/migrate.mjs`): lock and statement timeouts, one transaction per migration, and refusals for unsafe cases. Production is marked as already at the baseline with `--baseline`, which first proves the live schema matches the dump. See `db/README.md`.
- `db/` sits at the repository root until the monorepo move (PR 7) turns it into `packages/db`.
- **PR 2, driver swap:**
  - `lib/database.ts` is the one database client: `@neondatabase/serverless` 1.x underneath, used the way `@vercel/postgres` used it (tagged template over HTTP, `.query` and `connect()` on the WebSocket pool, connection bound at first use), plus `orm()` (Drizzle, typed by `db/schema.ts`). `@vercel/postgres` is now only a dev dependency, as the reference for the golden master tests.
  - The raw SQL in route handlers moved to repository functions in `lib/repos/` (Drizzle). `app/` has no SQL left.
  - The golden master tests (`tests/golden-master.test.ts`) load every database module twice, once on the old driver and once on the new, each on its own copy of a synthetic fixture database. They run 330+ cases (every exported database function, reads and writes) and require identical results and, at the end, identical rows in every table. A coverage check fails on any exported database function without a case or a written reason.
  - A mutation check (removing the DATE parser from the new client) makes 8 functions differ, so the harness really sees driver differences.
  - Found while doing this: the Arena world's queries had no `ORDER BY`, so rows came back in storage order, which vacuum can change. They're ordered now, so ties break the same way on every load. No visible change: every consumer counts or sorts those lists.
  - The service-level comparison of business repositories (`packages/modules/*/server/repo.ts`, Drizzle per module) continues with the module work (PR 8) and Phase 3. The existing `lib/*-db.ts` files are already per-area repositories and now run on the new driver.
- **PR 3, no request-time DDL:**
  - Every `ensure…Tables()` (14 modules, ~200 call sites) and `lib/schema-gate.ts` are gone, about 1,500 lines. Tables come only from `db/migrations`.
  - Two data seeds that hid inside the DDL (default paused weekday, and the club jersey product with its 12 variants) moved to `db/seed/defaults.sql` (`npm run db:seed`) for new databases. Production already has them.
  - Preview builds migrate their own Neon branch (`prebuild` → `scripts/db/preview-migrate.mjs`). The preview guard decides first, and a branch made before production had a migration history is baselined only after its schema matches the frozen dump. Production builds never migrate.
  - Admin → Setup check now reports migration status ("Database schema") instead of creating tables.
  - The `schema_runs` table is now unused. It's left in place, because dropping it is a destructive change for a later release (test plan §0 rule 3).
- **PR 4, account foreign keys → RESTRICT:**
  - All **eight** foreign keys to `players` change, not only the six `CASCADE` ones. The two `SET NULL` ones (`shop_orders`, `cancellation_feedback`) would detach a person's orders on a hard delete, and accounts are only ever soft-deleted (test plan §4.2), so RESTRICT is right for them too.
  - Migration `0001_account_fks_restrict.sql`: same constraint names, `NOT VALID` then `VALIDATE`, one transaction.
  - Rehearsed on a fresh branch of production: 15 accounts, 0 problems, drift empty afterwards, and a hard delete of an account with data is refused.
- **PR 6, business config → database:**
  - New tables `pricing_plans` and `club_settings` (migration `0002_business_config`), filled with the published Sanity values read on 23 Nov 2026: 5 plans with their Stripe price ids, capacity unset, booking lock 14 days (`bookingLockDays` isn't read by the app today; it's kept).
  - `lib/business-config.ts` reads the database first and falls back to Sanity while the tables don't exist yet (expand). Edits happen in **Admin → Money → Pricing & settings** (club admins; audited).
  - Checked three ways:
    - `tests/business-config.test.ts`: every field equals the committed Sanity snapshot, and the plans render identically in English and Vietnamese;
    - `scripts/verify-business-config.mjs`: a live database against live Sanity (catches a tampered price id);
    - a combined rehearsal (PR 4 + PR 6) on a branch of production: 0 problems, drift empty, values match.
  - **Contract later:** remove the Sanity fallback and the Sanity pricing fields once production has run 0002 and a quiet week has passed.
- **PR 7, monorepo (pnpm workspaces + Turborepo):**
  - `apps/web` (the whole Next.js app, its scripts and tests) and `packages/db` (`@luvallplay/db`: Drizzle schema, migrations, seed). `docs/` and `.github/` stay at the root.
  - npm → pnpm with `node-linker=hoisted` (npm-style `node_modules`, because Sanity expects hoisting). Next's peer warning from `next-sanity` is allowed via `pnpm.peerDependencyRules`, replacing npm's `overrides`.
  - `next.config.ts`: `transpilePackages`, `outputFileTracingRoot` and `turbopack.root` point at the repository root.
  - The remaining packages from §3.1 (`core`, `auth`, `ui`, `i18n`, the modules) start in PR 8. `apps/studio` follows the Studio step (runbook §7).
  - The Vercel switch is a dashboard step, done last (runbook §8). Production keeps serving the previous deployment until the new build is Ready.
- **PR 8, shared packages, module skeleton, design tokens, i18n:**
  - `packages/core` (`@luvallplay/core`): the pure modules moved out of the app unchanged (`stats-periods`, `ranks`, `phone`, `safe-next`, `first-name`). The old `apps/web/lib/*.ts` paths are one-line re-exports, so no import changed.
  - `packages/auth` (`@luvallplay/auth`): the pure access rules from `lib/admin-roles.ts` (roles, `adminPathAllowed`, `adminApiAllowed`, step-up freshness, `normalizeEmail`). Reading roles from the database stays in the app and re-exports the rules. Code sign-in and sessions move here with the API work in Phase 3.
  - `packages/i18n` (`@luvallplay/i18n`): the four dictionaries merged into typed namespaces `site`, `profile`, `arena`, `jersey`, en + vi. A Vietnamese dictionary missing a key is now a type error. `t`/`pt`/`at`/`jt` and the hooks are thin wrappers, so no component changed. `tests/i18n.test.ts` renders every key in both languages and compares it with a snapshot taken from the old files before the merge (1,038 keys per language): identical, and every `{placeholder}` matches between English and Vietnamese.
  - `packages/ui` (`@luvallplay/ui`): design tokens, **semantic only** for components (§6.3): `--primary`, `--on-primary`, `--accent`, `--on-accent`, `--surface`, `--surface-raised`, `--ink`, `--ink-muted`, `--line`, `--control-border`, `--focus`, `--danger`, `--font-display`, `--font-text`.
    - The 12 club colour schemes (§6.3.1) are data (`color-schemes.json`, from `docs/plans/assets/club-color-schemes.json`). Neutrals and fonts come from the Luvallplay brand system (copied exactly). The default theme is Court Green; `tokens.css` is that theme and uses no brand names.
    - The Three Wolves look is its own token set, tested equal to `globals.css`, so the club's site is unchanged. It becomes Three Wolves' imported brand (§6.3.2) with the theming work.
    - Tests: every scheme passes the plan's contrast floors (text on fills ≥ 4.5:1 in both modes, primary on the light surfaces ≥ 4.5:1, fills ≥ 3:1 against both dark grounds), and the brand's own pairs pass in both themes.
    - Decided with the planning thread (23 Nov): the schemes are checked against the brand's real dark grounds (`surface` `#0b1b2b`, `surface-raised` `#12263a`), with the dark primaries lightened so fills stand off both at ≥ 3:1. The brand system's `court-green` dark changed from `#157a5a` to `#2b7d64` to match (Court Green's dark primary). The test uses the same floors as the generator.
  - `packages/modules` (`@luvallplay/modules`): `defineModule()` with the §6.2 manifest, extended for §6.2.1 and §6.2.3.
    - Fields: `core`; `requires` and `recommends`; `payments: "none" | "optional" | "required"` with optional `paymentModes` (Card payments: online only); `availability` (available, beta or hidden); `liveActivity` (what needs a confirmation before switching off); and everything it owns: admin nav and pages, app tabs/cards/routes, site sections/routes, API routes, crons, emails and webhook events.
    - The registry: the core (Home, Play days, People & roles, Messages & announcements, Website, Settings) plus 16 optional modules for what Three Wolves runs today. Setup check and Platform staff are listed as platform-console pages, not club modules. Three Wolves: online payments, every module on.
    - `canTurnOn` / `canTurnOff` are pure rules ready for Settings → Modules and the platform console: the core never switches; payment modes; requirements first; dependents block; locks (owners can't, platform admins can); availability and beta. Nothing reads the registry at runtime yet.
    - Tests tie the registry to the real app: every admin menu page, every cron in `vercel.json` and every webhook event belongs to exactly one module (or the platform console), and every route and page a module names exists.
    - Finding: the `membership.changed` webhook event is declared but nothing emits it yet.
  - **Plan change:** modules are one package with the registry for now, not one package per module (§3.1). Each module's server, app, admin and site code moves into it as Phase 3 builds the API, so code doesn't move twice.
  - Packages import nothing from Next, React, the database or the app (a test enforces it); CI typechecks them on their own.
- **Break-glass removed (23 Nov 2026):** the `ADMIN_PASSWORD` login (`/admin/login?breakglass=1`, `/api/admin-login`, `/api/admin-logout`, `lib/admin-session.ts`) is gone, along with its fallbacks: `PLAYER_SESSION_SECRET` is now required (it's set in production and preview), and jersey links hash with `CANCEL_LINK_SECRET`. Admin is reached only by signing in with an account that has a club role or platform admin. Old audit rows keep the actor kind `break-glass`. The `ADMIN_PASSWORD` variable in Vercel is no longer read and can be deleted.
- **Lint clean (23 Nov 2026):** the React Compiler rules (`set-state-in-effect`, `refs`, `immutability`, `purity`, `static-components`) are errors again, and CI fails on any warning (`--max-warnings 0`). All 117 warnings are fixed: browser-only values via `useSyncExternalStore`; resets compared during render instead of in effects; refs written in effects; components hoisted out of render (this also stops the Arena score inputs losing focus while typing); Arena cards use the server's clock. Seven suppressions remain, each with a reason in the code: four false positives on async loads and one-shot mount handlers, two Wolf Vision mount reads, and one in an async Server Component. `@next/next/no-img-element` is off on purpose: images come from Blob and the Sanity CDN already sized, and `next/image` would route each through Vercel Image Optimization, which Hobby caps.
- **Studio moved (23 Nov 2026):** `apps/studio` holds the Sanity Studio (config, CLI config, schema), deployed by Sanity to https://threewolves.sanity.studio with a short-lived Deploy Studio token that was revoked straight after. The site's `/studio` redirects there. The web app drops `sanity`, `@sanity/vision` and `next-sanity` (the publish webhook verifies signatures with `@sanity/webhook`), and with them the pnpm peer-dependency override for Next 16. Studio runtime auto-updates are off, so it runs the version in the lockfile.
- **PR 5, Next.js 16** (16.4.6, Turbopack builds):
  - `middleware.ts` is now `proxy.ts` (`export function proxy`), on the Node runtime, which is fixed in 16, so the `runtime` setting is gone.
  - `revalidateTag(tag)` is now `revalidateTag(tag, { expire: 0 })`. That keeps today's behaviour (the next request reads fresh data), not the stale-while-revalidate `"max"` profile.
  - ESLint uses `eslint-config-next` 16's own flat config. Its five new React Compiler rules (`react-hooks/set-state-in-effect`, `refs`, `immutability`, `purity`, `static-components`) flag about 74 existing spots that work today. They were warnings at first; all fixed on 23 Nov (see "Lint clean" above).
  - `next-sanity` 9 (Studio at `/studio`, webhook signature check) only declares Next 14–15. An npm `overrides` entry (`next: $next`) holds it on 16 until the Studio leaves the web app. Checked: the Studio mounts, and the webhook rejects a bad signature and accepts the manual trigger.
- **Plan change: the Studio move needs Three Wolves' Sanity project.** The site's Sanity project (`c0v5j4dz`) isn't in the Sanity account connected to the build session, so the session can't deploy a hosted Studio. (The business config was read through Sanity's public read API.) The Studio move stays in Phase 2 and needs one step from Timba (Phase 2 runbook §7).
- **Vercel previews ("Resource provisioning failed")**: the Vercel project's Neon integration still creates preview branches in the *old US* Neon project (`neon-almond-button`). That project is at the free plan's 10-branch limit (main + 9 stale `preview/claude/*` branches), so every preview fails before building. The fix is a dashboard action (see the Phase 2 runbook).

---

## 4. Phases 4–5: the player app in Capacitor (request 3)

### 4.1 Architecture

```
            ┌────────────── apps/app (static bundle) ──────────────┐
 iOS app ──▶│ React SPA · TanStack Query (persisted cache) · i18n  │──HTTPS──▶ api.luvallplay.com
 Android ──▶│ Capacitor plugins via a small `native` adapter layer │          (apps/web route handlers,
 Web PWA ──▶│ same bundle at app.luvallplay.com                    │           tenant-scoped, bearer auth)
            └──────────────────────────────────────────────────────┘
```

- **Auth in the app:** the same code sign-in. The session token is stored in the **iOS Keychain / Android Keystore** through a secure-storage plugin and sent as `Authorization: Bearer`. The API accepts the cookie (web) *or* the bearer token (app), backed by the same `player_sessions` table. CORS is limited to `capacitor://localhost`, `https://localhost` and the app's own domains.
- **Live updates:** web-bundle fixes ship over the air (Capawesome Cloud or Capgo), with channels for production and beta. App Store rules allow this as long as the app's main purpose doesn't change. Native changes still go through review.
- **Offline:** cached Me / Arena / stats data opens instantly. Writes like "I can't make it" queue and sync when back online.

### 4.2 Native features (these also clear Apple's "minimum functionality" bar, 4.2)

| Feature | Plugin / approach |
|---|---|
| Push notifications: challenge received/accepted, match result to confirm, admin message, play-day reminder, roster out, payment issue | `@capacitor/push-notifications` + FCM (one service for both platforms); per-category opt-in in Settings |
| Universal Links / App Links: email sign-in links, challenge invites and receipts open in the app | `apple-app-site-association` + `assetlinks.json` served from the app's domains |
| Camera and photos | Android **Photo Picker** (no broad media permission, required by Play policy); iOS PHPicker. Wolf Vision keeps `getUserMedia` in the WebView |
| Haptics on scoring, challenge accepted, rank up | `@capacitor/haptics` |
| Share sheet (rank cards, Vision clips, invite links) | `@capacitor/share` |
| Edge-to-edge system bars | Capacitor 8 core **SystemBars** plugin + CSS `env(safe-area-inset-*)` (already in the CSS) |
| Keyboard | `@capacitor/keyboard` resize mode + `interactive-widget=resizes-content` (already set) |
| Android back button / predictive back | `@capacitor/app` `backButton` → router history; closes sheets first |
| App icon badge (unread inbox) | push payload badge counts |
| Later | Home-screen widgets (next play day, rank), Live Activity during a match, passkeys |

### 4.3 App Store and Play Store compliance checklist

**Apple**

| Rule | What we do |
|---|---|
| 4.2 Minimum functionality | Bundled app (not a remote website) + native features from 4.2 |
| 4.2.6 / 4.3 Template and spam apps | One Luvallplay app containing many clubs, not one copy per club (🟡 Decision A) |
| 4.8 Login services | Our own email/SMS code sign-in is exempt. **If we ever add Google/Facebook sign-in, we must also offer Sign in with Apple.** Recommendation: add Sign in with Apple + passkeys in Phase 5 anyway, as a faster sign-in |
| 5.1.1(v) Account deletion | Already built (`/api/profile/delete`); make it reachable in two taps from Settings, with a clear explanation of what is kept (financial records) |
| 5.1.1 Permissions | Plain-language purpose strings for camera, microphone (Vision), photos, location (club finder) and notifications, each asked for only when the feature is used |
| Privacy manifest + App Privacy labels | `PrivacyInfo.xcprivacy` (required-reason APIs) and accurate nutrition labels. No tracking → no App Tracking Transparency prompt |
| 3.1.1 vs 3.1.3(e) Payments | Memberships, play days, casual bookings, merch and donations are **real-world goods/services → Stripe is allowed**. **Wolf Vision passes are digital → in-app purchase on iOS** (🟡 Decision C) |
| 1.2 User-generated content | Photos, messages and (later) social posts: report, block, keyword filter, published contact, moderation within 24h. Photo auto-moderation already exists |
| 2.1 Completeness | A **review demo account** with a fixed sign-in code that only works for that address, seeded demo data, and review notes explaining code sign-in and the club model |
| iPad | Must work in iPadOS 26 resizable windows, Stage Manager and all orientations (`UIRequiresFullScreen` is deprecated) |
| Age rating | Juniors never use the app on their own: a **guardian account** manages every junior profile (§6.8), so the app isn't directed at children. **Check** Apple's Kids category and Google's Families policy, set the age rating to match, and keep social and marketplace features adult-only |

**Google Play**

| Rule | What we do |
|---|---|
| Target API level | **API 36 (Android 16)**, required for new apps and updates since 31 Aug 2026. Capacitor 8 targets 36 |
| Large screens (Android 16) | On screens ≥600dp, Android ignores orientation and resizability locks. We don't set any locks, and test every window size |
| Edge-to-edge | Enforced for API 35+. Handled by SystemBars + safe-area CSS |
| Data safety form + account deletion | In-app deletion **plus a public web page** for deletion requests (Play requires both) |
| Photo/video permissions | Photo Picker, no `READ_MEDIA_IMAGES` |
| Developer account | **Organization account** to skip the 14-day / 12-tester closed-test rule for new personal accounts, and to show "Luvallplay" as the developer |
| App signing | Play App Signing, AAB builds |

### 4.4 Phones, foldables and tablets

**Layout system (one set of rules for app, admin and sites):**

| Window class (width) | Navigation | Layout |
|---|---|---|
| Compact < 600 | Bottom tab bar | Single column |
| Medium 600–839 | Navigation rail | Two columns where it helps (Me, Player) |
| Expanded 840–1199 | Navigation rail | **List + detail** (Arena challenges, Leaderboard + player card, Inbox) |
| Large ≥ 1200 | Sidebar | List + detail + supporting pane |

These breakpoints match Material 3's window size classes. Components use **container queries**, so a card looks right whether it sits in a phone column or a tablet side pane, including iPad Split View and Stage Manager windows of any size.

**Foldables:**
- **Viewport Segments API** (`@media (horizontal-viewport-segments: 2)` + `env(viewport-segment-*)`, Chrome/WebView 138+): two-pane layouts split exactly at the hinge so nothing sits in the fold.
- **Device Posture / tabletop mode:** when the phone is half-folded on a table, Wolf Vision moves the camera preview to the top half and controls to the bottom. That's a natural "film my match" stand.
- **Cover screens:** the Galaxy Z Fold cover screen is narrow (about 344dp), so everything is tested down to **320px**. Continuity between folded and unfolded: the app keeps its state and scroll position when the device is opened or closed (no activity restart; Capacitor's default `configChanges` covers this, and we verify it).

**Everywhere:**
- `dvh`/`svh` viewport units; safe-area padding on every edge.
- Keyboard and pointer support on iPad and Chromebook: hover states, focus rings, `⌘K` search in admin.
- 44pt / 48dp minimum touch targets.
- Reduced-motion support.
- Dynamic Type / font scaling up to 200% without layouts breaking.

**Test matrix:**
- iPhone SE (375) · iPhone Pro Max · iPad mini · iPad Pro 13" (full, split, Stage Manager)
- Galaxy Z Fold (cover + inner) · Galaxy Z Flip · Pixel Fold · Pixel Tablet · a low-end Android (performance check)

Playwright visual snapshots run at each window class on every pull request. Real devices are covered through Firebase Test Lab or BrowserStack before each store release.

**Performance budget:**
- App shell under 150 KB gzipped (JS).
- Interactive in under 1.5s on a mid-range Android from cold start.
- Route chunks loaded on demand.
- Stripe, MediaPipe and reCAPTCHA load only when used, as they do today.

### 4.5 Build and release pipeline

- GitHub Actions: lint → unit → tenant-isolation tests → Playwright → build web → build iOS (macOS runner + fastlane match) and Android (AAB).
- Delivery: TestFlight / Play internal testing → closed beta (Three Wolves members) → production.
- Crash and error reporting: Sentry (Capacitor + Next.js SDKs).
- Analytics: privacy-friendly and first-party (no cross-app tracking).
- Store assets:
  - Screenshots for 6.9" iPhone, 13" iPad, Android phone, and 7" + 10" tablet.
  - Play feature graphic.
  - Privacy policy and terms on luvallplay.com.
  - A support URL.

---

## 5. Request 4: clean-up of all pages

| Area | Clean-up |
|---|---|
| **Website** (club landing) | Rebuilt from template sections (§7.3): Hero → Why play with us → Schedule & venue → Membership & casual → Leaderboard teaser → Gallery → Reviews → Get the app → FAQ → Footer. The main call to action is **"Join the club in the app"**; casual booking stays available as guest checkout. Lighthouse ≥ 95 on all four scores, structured data (`SportsClub`, `Event` for play days) for local search |
| **App** | §2 structure; one component library (`packages/ui`); every screen has loading skeleton, empty, error and offline states; consistent sheets and modals; one toast system |
| **Admin** | A small **core** sidebar (Home · Play days · People · Messages · Website · Settings), with each module adding its own items under **Play**, **Money**, **Players** or **Content** only when it's switched on (§6.2.3). Shared `DataTable` (sort, filter, export, becomes cards on mobile), dashboard home ("needs attention": unread messages, photos to review, disputes, failed payments) |
| **Sanity** | Business config removed (pricing plans, `stripePriceId`, casual spots and booking lock days move to the database and Admin). Studio holds Luvallplay content only: marketing pages, blog, help centre, release notes. Three Wolves content migrates into the club website editor (🟡 Decision D) |
| **Code** | Runtime DDL → migrations; email links → `user_id` foreign keys; constants → club/module settings; "Three Wolves" strings → club config; `hasDb` checks removed (a database is required); error boundaries per route; zod validation at every API edge |
| **Tests** | Unit (core logic), integration (repos against a Neon branch), **tenant isolation** (every repo function is tested to make sure club A can't read club B), Playwright end-to-end for sign-in, booking, membership, challenge and admin flows |

---

## 6. Phase 3: multi-tenant core (request 5)

### 6.1 Data model

**Approach: one shared database, a `tenant_id` column on every club-owned table, and Postgres row-level security (RLS) as a safety net.** This is the standard model for SaaS at this scale. It's cheap, runs one migration for everyone, and makes cross-club ("global") features easy. A database per club would make global leaderboards and the marketplace painful.

```
tenants            id, slug, name, status, country, region, timezone, currency, languages[], sports[], location (PostGIS point),
                   payment_mode (free | offline | online), incorporated (yes | no | unsure),
                   stripe_status (none | connecting | connected), bank_details jsonb, theme jsonb (preset id or imported brand),
                   terms jsonb (e.g. points_name: "Wolf Points"), custom_domain, created_at
club_brand_assets  tenant_id, kind (logo | logo_dark | font_display | font_text), file, checked_at, licence_confirmed_by
tenant_modules     tenant_id, module_id, enabled, settings jsonb, enabled_at        ← what the wizard writes
users              id, email, phone, first/last/display name, avatar, lang, ...      ← global identity (today's players)
club_members       tenant_id, user_id, role (owner|admin|coach|member|guest), status, joined_at,
                   leaderboard_visible, global_profile_visible
junior_profiles   id, tenant_id, guardian_user_id, name, birth_year, no login of its own     ← §6.8
guardianships      guardian_user_id, junior_profile_id, consent_at, consent_scope jsonb
platform_admins    user_id                                                            ← Luvallplay staff
admin_audit_log    tenant_id, actor_user_id, action, target, meta, at
...every club table  + tenant_id NOT NULL, FK, composite indexes (tenant_id, …), RLS policy
global tables      directory listings, global ratings, posts/follows, marketplace listings (§8)
```

- **Clubs manage their own players** (from the research thread): club admins register, enable or disable a player for their club (`club_members.status = active | disabled`). A disabled player loses access to that club's spaces but keeps their account and data, and can be re-enabled. The host (Luvallplay / Three Wolves) doesn't police individual clubs' members. **Safeguarding rules apply platform-wide** (§8).
- **One Luvallplay account across clubs.** A player can belong to several clubs and switch between them in the app's header. A club admin sees only their club's members and data.
- **RLS done right:**
  - The app connects as a role that doesn't own the tables.
  - The tenant is set per transaction with `set_config('app.tenant_id', $1, true)`.
  - Policies compare it to `tenant_id`.
  - `FORCE ROW LEVEL SECURITY` is on.
  - Application code still filters by tenant. RLS is the backstop, not the only check.
- **Email links → `user_id`.** Today's email-based links (bookings, memberships, attendance) get real foreign keys during the backfill. The email stays as a contact field.

### 6.2 Module system

Every feature is a module with a manifest. The wizard, admin, app navigation, API and scheduled jobs all read the same registry.

```ts
export default defineModule({
  id: "play-days",
  scope: "club",                     // "club" | "global"
  name: { en: "Play days & bookings", vi: "…" },
  requires: ["members"],             // auto-selected in the wizard
  recommends: ["memberships"],
  settings: z.object({ weekdays: z.array(Weekday), courts: z.record(...), bookingCutoffHour: z.number(), ... }),
  app:   { tabs?, meCards: ["next-up", "calendar"] },
  admin: { nav: [{ group: "Play", href: "/play-days" }] },
  site:  { sections: ["schedule"] },
  crons: [{ id: "sync-calendar", schedule: "0 2 * * *" }],   // one cron fans out per enabled club
  webhooks: ["attendance.recorded"],
});
```

**Module catalogue (from what Three Wolves already has):**

| Group | Module | Notes |
|---|---|---|
| Core (always on) | Club profile & website · **Play days** (schedule, sign-ups, capacity, waitlist, cancellations, attendance) · People & roles · Messages & announcements · Admin essentials | Exactly what a free, no-money club needs to run (§6.2.3) |
| Run your club | **Calendar sync** (Google Calendar) · **Casual play** (drop-in bookings for non-members, guest checkout) · **Court board** (live court rotation) · **Round robin / mini games** · **Day requests** · **Multiple venues** | Extend Play days; courts, capacity and cut-offs are Play days settings |
| Money | **Memberships** (plans, cycles, days; a plan can be free) · **Shop & merch** (jersey pre-orders become a shop product type; or a **Shopify connector** for clubs that already sell there, §12.5) · **Accounting sync (Xero, MYOB)**, a **paid add-on** (§12.3) · **Donations** · **Finance & reports** · **Bank reconciliation (NZ, Akahu)** | All optional. Card payments need Stripe Connect; cash and bank transfer don't. A free-play club leaves the whole group off (§6.2.1) |
| Engage players | **Arena** (challenges, ranks, club leaderboard) · **Vision** (AI match analysis) · **Gallery & photos** · **Integrations** (API, webhooks, MCP) | Ranks and art are themeable per club |
| Global (opt-in) | **Find a club** · **Global leaderboards** · **Social** · **Marketplace** | §8 |

#### 6.2.1 Free-play clubs and payment modes

Some clubs offer free play to everyone, so **payments are never required**. Every club has a **payment mode** (`tenants.payment_mode`), chosen in the setup wizard and changeable in Admin:

| Mode | What players see | What's switched off |
|---|---|---|
| **Free play** | "Free to play" on the club site and in the app. Play days are **free sign-ups** (RSVP) with the same capacity, waitlist, "I can't make it" and attendance as paid ones. Joining the club is a free membership: tap Join and you're in | Every price, checkout, Stripe, invoices, the Money admin group, membership renewals and payment reminders. Stripe Connect onboarding is never shown |
| **Cash or bank transfer** | Prices, with "Pay at the hall" or bank details. Admins mark payments received (the cash and bank-transfer recording Three Wolves already uses) | Card checkout and Stripe Connect |
| **Online payments** | Card checkout through the club's own Stripe account (connected to Luvallplay), plus cash/transfer if the club allows. **Only for incorporated clubs with their own Stripe account** (§6.2.2) | Nothing |

- Free play is a first-class mode, not "paid with a price of 0": no "$0.00", no checkout step, no receipts, and no "payment pending" states anywhere.
- Mixed clubs work too. A paid club can mark individual play days or membership plans as **free** (e.g. a free open night), and those skip checkout.
- Optional extras still work for free clubs if they choose: **Donations** ("Support the club") and a **Shop** can be switched on later without changing the mode for play.
- Switching mode later is guarded:
  - Free → paid: prices apply only to bookings and memberships made after the switch.
  - Paid → free: blocked while active paid subscriptions exist, until the admin chooses to let them run to the end of their period or cancel and refund them.
  - Players get a notice either way.
- Module manifests declare `payments: "none" | "optional" | "required"`. The wizard and Admin hide anything that needs payments when the club is on Free play, and the API refuses payment calls for a free club (tested, test plan §3.8 journey S3).

#### 6.2.2 Deciding the payment mode at setup

*This is the **NZ and Australia** flow. Vietnam's flow asks different questions (business registration, club bank account, wallet) and is designed after the Vietnamese discovery round (§11.4). Setup asks for the club's **country** in step ② and shows that country's flow.*

Many NZ clubs aren't incorporated, so they can't open a Stripe account in the club's name. Setup therefore asks three plain questions and sets the mode itself (wizard step ④):

```
Do you charge players to play?
 ├─ No ───────────────────────────────────────────────→ Free play
 └─ Yes → Is your club incorporated?
           (an incorporated society, charitable trust or company)
           ├─ No / Not sure ──────────────────────────→ Cash and bank transfer only
           └─ Yes → Does the club have its own Stripe account?
                     ├─ Yes → connect it now ─────────→ Online payments (+ cash/transfer if wanted)
                     └─ No ───────────────────────────→ Cash and bank transfer only
```

- The answers are stored (`tenants.incorporated`: yes | no | unsure; `tenants.stripe_status`: none | connecting | connected).
- **Online payments are offered only when both answers are yes**, and only go live once the club's Stripe account is connected and verified. If connecting fails or is abandoned, the club stays on cash and bank transfer, and Admin shows "Finish connecting Stripe".
- Luvallplay **never** takes card payments on a club's behalf through another club's or the platform's account, and never holds club money. Each club's money goes straight to its own bank account (cash/transfer) or its own Stripe account (cards).
- **For cash and bank transfer, setup also asks for:**
  - the club's bank account name and number (NZ format checked);
  - whether players can pay cash at the hall;
  - whether a spot is confirmed straight away or only once the payment arrives (default: confirmed, with payment due before the play day);
  - optionally, connecting the club's bank account read-only through Akahu, so incoming transfers are matched to bookings automatically (as Three Wolves does today).
- **Moving up later:** when a club incorporates and opens a Stripe account, **Admin → Payments → Turn on card payments** asks the same two questions and connects Stripe. Prices and history carry over; cash and bank transfer can stay on alongside cards.
- **Help for unincorporated clubs:** a short "Getting incorporated" guide, linked from setup and Admin → Payments. It covers the Incorporated Societies Act 2022 basics (minimum 10 members, about $88.89 + GST application fee), a constitution template and a checklist, plus why it helps: card payments, a club bank account, protection from personal liability for committee members and eligibility for many grants.

**What Admin shows for each mode** (driven by the mode, not by separate switches):

| Admin area | Free play | Cash and bank transfer | Online payments |
|---|---|---|---|
| **Payments to check:** unpaid bookings and memberships, each with its payment reference; mark paid (cash or transfer) | – | ✔ | ✔ (for cash/transfer payments) |
| **Bank matching** (Akahu, optional) | – | ✔ | ✔ |
| **Finance & reports** (income, expenses, receipts, AGM report) | optional (for donations or expenses) | ✔ | ✔ |
| **Membership renewals:** reminder emails with bank details and the member's reference, no automatic charging | – | ✔ | ✔ (cash/transfer members) |
| **Card payments:** Stripe payouts, card refunds, failed-payment retries, Stripe sync, auto-renewing subscriptions | – | – | ✔ |
| **Payments settings:** bank details, cash at the hall, confirm-before-paid, Akahu, "Turn on card payments" | – | ✔ | ✔ (+ Stripe account status) |

**What players see in cash and bank transfer mode:**
- A booking or membership shows **"Pay by bank transfer"** with the club's account, the amount and a unique reference (e.g. `TW-4821`) with a copy button, and **"Pay cash at the hall"** if allowed.
- The item stays "Awaiting payment" until it's matched or marked paid, then shows "Paid".
- Reminders go out before the play day if still unpaid.
- No card form, saved card, "manage card" or auto-renew option appears anywhere, and the API refuses card-payment calls for these clubs.

#### 6.2.3 Admin: the core and the optional modules

**The test for the core:** could a free-play club with no money flow run its play days without this? If yes, it's a module. What's left is deliberately small, so a new volunteer-run club sees a simple admin that doesn't overwhelm them.

**Core admin (always on, can't be turned off):**

| Area | What it covers | Why it's essential |
|---|---|---|
| **Home** | "Needs attention": next play day and its sign-ups, join requests, unread messages, anything a module adds (e.g. photos to review) | One place to start |
| **Play days** | Recurring schedule and one-off days (date, time, venue, courts → capacity), sign-up list and waitlist, open or close sign-ups, cancel a day (members told automatically), tick attendance | Running play days is what every club does |
| **People** | Members list, join requests (approve or decline), invite by email or link, edit details, **enable or disable a player** (the club's own decision), merge duplicate accounts | The club decides who plays |
| **Messages** | Inbox for messages from members, and **announcements** to all members by email and app notification (e.g. "Courts moved to Hall B") | Members and admins must be able to reach each other, also needed for safeguarding |
| **Website** | The basic club page: about, schedule, venue, contact, "Join the club" and "Sign up for a play day" | How new players find and join the club |
| **Settings** | Club details and venue, time zone and languages, Look & feel, Payments (mode, §6.2.2), **Modules**, Admins & roles, Audit log (read-only), Data & privacy (export club data, handle deletion requests) | Running the club account safely and legally |

For a free club with nothing else switched on, the admin sidebar is just: **Home · Play days · People · Messages · Website · Settings.**

**Optional modules and the admin areas they add** (today's Three Wolves admin tabs mapped across):

| Module | Admin area it adds | Today's tab | Needs |
|---|---|---|---|
| Calendar sync | Play days → calendar connection | (inside Play days) | – |
| Casual play | Casual bookings, guest list | (inside Play days) | – |
| Court board | Organiser screen for live court rotation | `/casual-play` link | – |
| Round robin / mini games | Draws, scores, mini game days | Play days toggle, `/mini-game` | – |
| Day requests | Requests for extra play days | Day requests | – |
| Multiple venues | Venue list, per-venue capacity | – | – |
| Memberships | Plans, cycles, renewals, membership list | Members | Payment mode not *Free play* (free clubs use the core People list) |
| Payments to check | Unpaid items, mark as paid, references | (Members, Shop) | Cash/transfer or online |
| Bank matching (NZ, Akahu) | Bank feed, auto-match | Financials → Bank | Cash/transfer or online |
| Card payments | Stripe payouts, card refunds, retries, Stripe sync | (Members) | Online payments (§6.2.2) |
| Finance & reports | Income, expenses, receipts, AGM report | Financials | – (free clubs can track expenses too) |
| **Accounting sync (Xero, MYOB)** | Connection status, account and tax mapping, sync log, error queue, daily reconciliation report (§12.3) | – | Finance & reports; a payment mode other than Free play. **Paid add-on** (decision AK) |
| **Shopify connector** | Connection status, product display settings, order list (read-only) (§12.5) | Shop | Shop & merch |
| Shop & merch | Products, stock, orders (jersey pre-orders are a product type) | Shop, Jersey | Cash/transfer or online |
| Donations | Donation settings and list | (home page) | Cash/transfer or online |
| Arena | Challenges, disputes, ranks, club leaderboard | Challenges | – |
| Vision | Passes, device check, training labels | Device check | – |
| Gallery & photos | Photo moderation, gallery | Photos | – |
| Integrations | API keys, webhooks, MCP | (Player tab) | – |
| Global: Find a club, Global leaderboards, Social, Marketplace | Directory listing, opt-ins, moderation queues | – | Each opted into separately (§8) |

Not club modules at all: **Setup check** (environment diagnostics) and **Platform** (platform admins) move to the Luvallplay platform console, which only platform admins see.

**Who turns modules on and off:**
- **During setup:** the club picks modules in wizard step ⑤ (presets or individual cards).
- **Club owners:** in **Settings → Modules** at any time. Club admins can see which modules are on, but only owners change them. Every change is written to the audit log.
- **Luvallplay platform admins**, in the platform console:
  - turn any module on or off for any club (e.g. to help a club set up, or to switch off a module being misused);
  - **lock** a module on or off for a club, so the club's owners can't change it, with a reason the owners can see;
  - control **availability platform-wide**: a module can be *available*, *beta* (only for clubs the platform chooses) or *hidden* (e.g. while a problem is fixed);
  - every change is in the platform audit log.
- **The rules every switch follows:**
  - **Turning a module off hides it, it doesn't delete anything.** Its admin areas, app screens, website sections, API routes, crons and emails stop. Its data is kept and returns when it's turned back on (test plan journey S2).
  - A module can't be turned on until its needs are met (e.g. Shop needs a payment mode other than Free play). A module that others depend on can't be turned off while they're on. The switch explains why.
  - Turning off a module with live activity (e.g. Arena with challenges in progress, a Shop with unpaid orders) shows what's affected and asks for confirmation. Members are told if something they use goes away.
- **Presets** in setup:
  - *Free social club*: core only.
  - *Social club*: core + Court board + Casual play.
  - *Competitive club*: + Round robin, Arena, Gallery.
  - *Coaching academy*: + Memberships, Day requests.
  - Three Wolves keeps every module it uses today.

**Settings replacing constants:**
- `MEMBERSHIP_ACCESS_DAYS` → `memberships.settings.days`
- `COURTS_TO_MAX_PLAYERS` → `play-days.settings.courts`
- Prices → plans in the database, linked to Stripe Prices on the club's connected account
- `Pacific/Auckland` → `tenants.timezone`
- "Wolf Points" / "Wolf Vision" → `tenants.terms`

### 6.3 Whitelabel and the Three Wolves exception

- Every club gets generic terms by default ("Luv Points", "Vision", generic rank art) and a **theme**.
- A theme has: logo, colours, fonts, rank-art set and terms.
- **Three Wolves keeps everything already built for it:** the wolf rank art, "Wolf Points", "Wolf Vision", Copperplate fonts and the navy palette. These are stored as *its* imported brand (§6.3.2) and terms, not as code. It's the first real test of custom branding.
- Theming works through **semantic** CSS custom properties set per club (`--primary`, `--on-primary`, `--accent`, `--on-accent`, `--surface`, `--ink`, `--font-display`, `--font-text`, …). The same components render differently with no per-club code. `packages/ui` (Phase 2) uses only semantic tokens, never brand names, so presets and imported brands plug straight in.
- A theme applies to the club's website, the club's spaces inside the app, emails, QR posters and the club's shop. The store app's icon and the sign-in screens stay Luvallplay.

#### 6.3.1 Twelve ready-made colour schemes

New clubs pick one in the wizard. Each is a primary colour (headers, buttons) plus an accent that pops (live badges, highlights, rank-ups). Each has a tested dark-mode version, and all pass WCAG AA contrast in both modes (`docs/plans/assets/club-color-schemes.json`, checked by `club-color-schemes.py`; preview in `club-color-schemes.png`).

| Scheme | Primary | Accent | Feel |
|---|---|---|---|
| **Court Green** (default) | `#0E6B4F` | `#D4F23C` | Luvallplay's own: the court with a lime shuttle |
| **Midnight Rally** | `#1E3A8A` | `#FBBF24` | Deep navy under hall lights, gold smash (dark mode uses a lighter blue with dark text) |
| **Shuttle Mono** | `#18181B` | `#FACC15` | Black and white like a feather shuttle, yellow strike (flips to white buttons in dark mode) |
| **Sunset Smash** | `#C2410C` | `#FDE047` | Burnt orange with sunny yellow |
| **Ocean Drive** | `#0F766E` | `#F9A8D4` | Deep teal with flamingo pink |
| **Royal Drop** | `#6D28D9` | `#6EE7B7` | Regal violet with fresh mint |
| **Cherry Net** | `#BE123C` | `#FCD34D` | Bold cherry with golden yellow |
| **Electric Serve** | `#1D4ED8` | `#FB923C` | Electric blue with hot orange |
| **Jungle Rally** | `#166534` | `#FDA4AF` | Forest green with a coral pop |
| **Aurora** | `#0E7490` | `#FEF08A` | Glacier cyan with a lemon glow |
| **Plum Clear** | `#86198F` | `#5EEAD4` | Rich plum with an aqua flash |
| **Arctic Smash** | `#075985` | `#F0ABFC` | Ice-deep blue with orchid |

- The wizard shows each scheme live on the club's own name, a play-day card and a button, in light and dark, before the club picks.
- Neutrals (backgrounds, text, borders) are shared across schemes, so every scheme stays readable. Dark-mode colours are checked against the brand system's real dark grounds (`surface` #0B1B2B and `surface-raised` #12263A), so fills stand off both at ≥ 3:1.
- More schemes can be added later as data (one entry in the JSON), with the same automated contrast check in CI.

#### 6.3.2 Bring your own brand

Clubs that already have a look can import it instead of picking a scheme (wizard step ③ or **Admin → Look & feel**):

- **Logo:**
  - Upload an SVG, PNG or JPG. SVGs are sanitised (scripts, external links and event handlers stripped); raster images need to be at least 512px.
  - An optional separate version for dark backgrounds.
  - Luvallplay generates the favicon, the square club avatar, the email header and the QR-poster version automatically. The admin checks a preview of each.
- **Fonts:**
  - Pick from a curated list of Google Fonts, or upload the club's own (WOFF2, WOFF, TTF or OTF, max 2 MB per file, one display and one text face). The uploader confirms the club has the licence to use it on the web.
  - Luvallplay checks the font covers English and **Vietnamese** characters and warns about anything missing, with the built-in face filling the gaps.
  - Fonts are served from Luvallplay's own storage, with fallbacks so text never disappears while a font loads.
- **Colour palette:**
  - Enter colours (hex, or pick visually), take them from the logo (automatic extraction suggests 3–5 colours), or **import from the club's website**. Luvallplay fetches the page server-side and reads its theme colour, logo and fonts (safe fetch: public addresses only, size and time limits).
  - The club picks which colour is primary and which is the accent.
  - **Contrast is automatic.** If a chosen colour can't carry readable text, Luvallplay keeps the colour for the logo and decorative uses but adjusts the shade used behind text, shows the original and adjusted side by side, and explains why in one sentence. A dark-mode version is generated the same way as for the presets.
- Imported brands are stored per club (`club_brand_assets`), isolated like all club data, and can be replaced or reverted to a preset at any time. Changes preview before they go live.

**Settings replacing constants:**

### 6.4 Domains and routing

| Host | Serves |
|---|---|
| `luvallplay.com` (primary), plus `luvallplay.org`, `.nz` and `.vn` | Platform marketing, **Find a club**, "Start your club" wizard, help, legal. `.com` is the brand's main address (`.org` reads as non-profit); `.vn` is the Vietnamese-language home; the others redirect |
| `app.luvallplay.com` | Player app (PWA). Same bundle as the store apps |
| `admin.luvallplay.com/{club}` | Club admin (one cookie domain, so the account sign-in just works) |
| `api.luvallplay.com` | API for app, integrations and MCP |
| `{club}.luvallplay.com` or **custom domain** (e.g. `threewolvesbadminton.org`) | Club landing page |

- `proxy.ts` resolves the club from the host name, using a cached lookup in Edge Config, and rewrites to `/_sites/[club]/…`. The lookup also returns the club's **region** (§6.9), and the request is served by that region's deployment.
- Custom domains are added through the Vercel Domains API, with automatic SSL.
- Club pages are statically generated and revalidated with a `tenant:{id}` tag.

### 6.5 Payments: providers by country

The three payment modes (§6.2.1: free, cash or bank transfer, online) stay the same everywhere. What changes by country is **which provider sits behind "online"**, and the rules for setup:

| Country | Online payments | Bank transfer | Bank-feed matching |
|---|---|---|---|
| **NZ, Australia** | **Stripe Connect**, with the **NZ company** as the platform account (Accounts v2, direct charges, application fee 0%): cards, Apple Pay and Google Pay, and in NZ **BECS direct debit** for memberships (§12.6). **Windcave** is a second provider for clubs that already have a merchant account there (§12.6) | NZ bank account details and a unique reference | Akahu (NZ). Australia needs another provider |
| **Vietnam** | **MoMo** (decision AC), with **each club connecting its own MoMo merchant account**. **Stripe isn't a realistic option there** | **VietQR** code with amount and reference, from the club's own bank account. This is the default, and the only option for clubs that can't get a MoMo merchant account | A Vietnamese bank-feed matching provider (to choose) |

*Unverified for MoMo:* I couldn't read MoMo's developer documentation from the planning environment. These points need confirming at developers.momo.vn or with MoMo before the Vietnam build: whether clubs and informal groups can become merchants (and with which documents), whether MoMo has a platform or partner programme for many sub-merchants, whether recurring or auto-debit payments exist, settlement timing (general sources say wallet payouts can take 1 to 7 working days), refunds, and webhooks (IPN). **Why each club has its own account:** collecting money for other businesses and paying it on can need a State Bank payment-intermediary licence in Vietnam (Decree 52/2024, with high capital requirements reported for collection and payment support services; **Check** with Vietnamese counsel).

- **One Payments interface, several providers.** Every provider implements the same operations (create payment, refund, recurring billing, verify webhook, reconcile, payout status) and declares its **capabilities**, so screens adapt: for example, auto-renewing subscriptions only appear where the provider supports recurring charges, otherwise members get renewal reminders with a QR code. Stripe is the first provider; adding a provider is a module, not a rewrite.
- **Money is stored as integer minor units plus a currency**, and each currency has its own exponent (NZD and AUD have 2, **VND has 0**: amounts are whole dong). Today's `*_cents` columns and every divide-by-100 in the code must be audited in Phase 3, with tests that use VND amounts.
- Each club uses **its own merchant account in its own country**. **Luvallplay never holds club money** and never collects on behalf of another club. Stripe Connect is only for clubs on *Online payments* in NZ or Australia (§6.2.1); free-play and cash clubs never see it.
- **Three Wolves' existing Stripe account is connected rather than recreated**, so live subscriptions, customers and payouts stay where they are.
- **Business model:** NZ badminton free for good, everyone else pays (§11.2).
  - Tables `plans` and `club_plans`, plus an **entitlements** check that every module calls (`can(club, "module.feature")`). Plans depend on **country and sport**.
  - Every module's manifest declares the plan it belongs to. Billing is switched off (`BILLING_ENABLED=false`) until the first paid club, but it's built and tested, because Vietnam is the first paid market.
  - **Paying TGS** follows the same country rule: Stripe Billing in NZ and Australia, bank transfer (VietQR) invoices or a local gateway in Vietnam. Paid plans are only ever sold on the web, never inside the iOS/Android app.
  - The Connect application fee is configurable and set to **0%**.
- **Operator and contracts:** see §11.1. The NZ company contracts with NZ and Australian clubs and holds the Stripe platform account. TGS contracts with Vietnamese clubs.

### 6.6 Migration of the live Three Wolves data

The data moves in seven steps:

1. Create `tenants` with Three Wolves as club #1, carrying its theme, terms and settings copied from today's constants.
2. Add nullable `tenant_id` and `user_id` columns.
3. Backfill.
4. Verify the counts.
5. Make the columns `NOT NULL` and add foreign keys and RLS.
6. Switch reads.
7. Drop the old email joins.

Each step is rehearsed on a Neon branch of production, behind a feature flag, with a tested rollback.


### 6.7 Multi-sport from the start

Luvallplay serves clubs of any sport that run regular sessions. Badminton goes first, and nothing in the core assumes it:

- **Each club lists its sports** (`tenants.sports[]`, e.g. badminton, pickleball, futsal). A play day can name its sport, so multi-sport clubs work.
- **Sport packs** hold everything sport-specific as data, not code:
  - vocabulary ("court" / "pitch" / "table", "game" / "match" / "set", "doubles" / "team of 5");
  - scoring format (rally points to 21, sets, goals, timed halves);
  - team sizes;
  - capacity units (players per court, per pitch);
  - line-icon artwork.

  Badminton is the first pack. Adding a sport means adding a pack, with English and Vietnamese wording.
- **Modules declare the sports they support.**
  - Sport-neutral (work for every sport): Play days, People, Messages, Court board (renamed in the UI from each pack's vocabulary), Round robin, Memberships, Shop and the rest.
  - **Arena:** challenge flow is generic; its scoring comes from the sport pack.
  - **Vision:** badminton only for now. It's only offered to clubs that play badminton.
- **Global features are per sport:** Find a club filters by sport, global leaderboards and ratings are kept separately for each sport, and the marketplace has sport categories.
- **Setup** asks "Which sports does your club play?" in step ② and shows modules that fit.
- **Copy rule:** neutral words in shared UI and on the Luvallplay site. Sport words only appear where the club's sport is known.


### 6.8 Junior accounts (guardian-managed)

Decision V: no longer 16+ only. **Juniors (under 16) never get their own login.** A **guardian** (an adult with a normal account) adds and manages each child's profile, so the app is never used directly by children and the existing sign-in, privacy and moderation rules stay simple.

- **Data model:** `junior_profiles` (name, birth year, club, no email or phone) and `guardianships` (guardian, child, when and what the guardian consented to). One guardian can manage several children and one child can have two guardians. Phase 3 includes these tables so nothing has to be reshaped later.
- **What a guardian can do:** join the child to a club, sign them up for sessions, pay, sign waivers and consent forms, record emergency contacts and medical notes, see attendance, and withdraw or delete the child's data.
- **What juniors can't have:** direct messages, social posts or follows, marketplace access, public photos, public leaderboard entries (unless the guardian opts in, and then first name and initial only), or Vision footage (unless the guardian consents).
- **Club-side safeguards (a module that clubs switch on: "Juniors"):**
  - a junior roster with guardian and emergency contacts, visible only to those who need it (medical notes are encrypted and limited to named roles);
  - **junior-programme coaches and volunteers must have a recorded safety check** before they're assigned to juniors (**Check:** the NZ Children's Act 2014 safety-checking rules for people who work with children; Vietnam has its own rules);
  - the club acknowledges a junior-safeguarding policy when switching the module on;
  - messages to a junior always go to the guardian, and coaches can't message children directly.
- **Optional module: Forms and waivers** (consent forms, liability waivers, emergency contacts) for any club, with versioned text and signature records.
- **Growing up:** at 16 a guardian can invite the young person to take over their own account with their consent; history and ratings move with them.
- **Law (Check each, with counsel):** NZ Privacy Act 2020 for children's information; Vietnam's personal data law treats children's data specially and needs a guardian's consent; app-store policies on apps used by or about children.
- **Testing:** journey J1 and permission-matrix rows for guardian, junior, junior-programme coach and other clubs' admins (test plan §3.17).
- **When:** Phase 3b, after the multi-tenant core and before the first paid market. The guardianship tables are part of Phase 3 itself.

### 6.9 Regions and country packs

**Regions (decision Y).** A region is a complete deployment: its own database, storage and compute. Every club lives in exactly one region (`tenants.region`).
- **Sydney** is the first region and serves NZ and Australia. The **Vietnam region is hosted in Hanoi** (decision AE), added when the Vietnam launch needs it. The reason is Vietnam's personal data law (in force since 1 Jan 2026), which has rules, assessments and penalties for moving data collected in Vietnam abroad (**Check** with Vietnamese counsel, including how it applies to NZ and Australian players' data held by a Vietnamese company).
- Host routing looks up the club's region and sends the request there (§6.4). A player's account lives in the region where they joined. **Cross-region identity isn't promised.** Global features (Find a club, ratings, later social and marketplace) work **within a region** at first.
- Migrations, the data guard, backups and restore drills run **per region**. The platform console shows all regions.
- Only Sydney runs in Phase 3, but the schema, routing and tooling are region-aware from the start. That's cheap now and very expensive to retrofit.

**The Hanoi stack (decision AE).** Vercel and Neon have no Hanoi region (I found none; **Check** their region lists). The Vietnam region therefore runs on a **Vietnamese cloud with managed Kubernetes and managed Postgres, run by TGS engineers**. Candidates are Viettel IDC, FPT Cloud, VNPT, CMC and VNG/GreenNode; all offer cloud services and some list managed Postgres and Kubernetes, but I haven't verified versions, point-in-time recovery, residency terms or prices. The choice is made after a comparison on those points.

**The code has to be portable.** What differs by region:

| Piece | Sydney region | Hanoi region |
|---|---|---|
| Runtime | Vercel | Containers (a Next.js standalone build) on managed Kubernetes |
| Database driver | Neon serverless driver | A standard Postgres driver. `lib/database.ts` supports **both**, behind one interface (the Neon driver only works through Neon's proxy). Drizzle and the golden-master tests cover both |
| Previews and rehearsals | Neon branches | **No branches.** Rehearse by restoring the latest backup into a scratch Postgres in Hanoi, then run the data guard there (slower, same guarantees) |
| Object storage (photos, uploads) | Vercel Blob | S3-compatible storage at the provider, behind one storage interface |
| Scheduled jobs | Vercel Cron | Kubernetes CronJobs calling the same routes with a secret |
| Email | Resend | A provider whose data handling is acceptable to counsel |
| Sign-in texts | Google Identity Platform (free allowance) | A Vietnamese SMS provider or Zalo notifications (**Check**) |
| Push notifications | FCM | FCM sends device tokens abroad (**Check** with counsel) |
| Photo moderation | Google Vision SafeSearch | A local or self-hosted classifier, because photos are personal data |
| Error tracking, analytics | Hosted services | Self-hosted, or only with consent and counsel's agreement |
| CDN, WAF, secrets | Vercel | The provider's, or Cloudflare (**Check**) |

- **Rule:** anything that sends personal data **out of the Vietnam region needs a written decision** (who, what, why, and counsel's view). A **regional services matrix** lists every provider per region and is enforced in CI (test plan §3.16).
- **Operations TGS must own:** a named ops owner, backups with point-in-time recovery and a restore drill, patching, monitoring and on-call, deployment from the same CI to Kubernetes, and a plan for a second Vietnamese site (**Check**).
- **Cost and time:** this adds a second stack to run. The Vietnam launch pack estimate rises accordingly (§9).
- **Fallback, only with counsel's agreement:** if running Hanoi proves too heavy, a Singapore region on Vercel and Neon with the required transfer assessments.


**Country packs.** Everything that differs by country lives in data and small adapters, not in the core:
- country, **currency and its exponent** (NZD 2, VND 0), tax rules (GST in NZ and Australia; VAT in Vietnam, **Check**), invoice rules (**Vietnam's e-invoice rules, Check**), time zone, public holidays;
- the payment providers, the bank-feed provider and the setup questions (§6.2.2, §6.5);
- phone number formats (+64, +61, +84) and the SMS or messaging provider;
- the legal documents, privacy and age rules, and complaint processes (NZ's 48-hour process in §8; Vietnam's licences);
- **names and search:** Vietnamese names put the family name first, so profiles use a single full-name field plus a display name, and **search ignores accents** (typing "nguyen" finds "Nguyễn");
- languages and sport vocabulary (§6.7).

### 6.10 Phase 3 delivery log and plan changes

Phase 3 ships as twelve small steps, each deployable and revertable on its own: (1) tenants schema and Three Wolves as club #1 → (2) nullable `tenant_id` columns, backfilled → (3) email links → `user_id` → (4) settings replace constants → (5) module enforcement → (6) second driver and region routing → (7) money audit → (8) payments interface → (9) entitlements and metering → (10) `NOT NULL`, foreign keys and row-level security → (11) reads switched, after 7 clean days of shadow reads → (12) old email joins dropped. The steps that need a decision or a sign-off are in [`phase-3-runbook.md`](./phase-3-runbook.md).

Findings and changes recorded as the work goes:

- **Step 1, tenants schema (migration `0003_tenants`):**
  - Five new tables: `tenants`, `tenant_modules`, `club_members`, and the junior-account tables `junior_profiles` and `guardianships` (§6.8, empty). Additive only.
  - Three Wolves' row is copied from today's constants, and a test compares the migration with them: `Pacific/Auckland`, NZD, English and Vietnamese, badminton, online payments, incorporated (its bank account name ends in "INC"), its bank details, its colours and fonts (from `packages/ui`), and the terms "Wolf Points" and "Wolf Vision".
  - `tenant_modules` has one row per module in the registry, the core included, because the core has settings too. The settings that are constants today are stored there: courts → players, session capacity, booking window and cut-off (Play days); the mini-game field (Round robin); membership days, default courts, cycle lengths, start search and pending hold (Memberships); donation limits in minor units (Donations). Nothing reads them yet (step 4).
  - **Plan change: `club_members` is a new table beside `club_roles`, not `club_roles` reshaped.** `club_roles` and `platform_admins` are untouched and stay the source of admin access, so the previous app version keeps working and nobody's access can change in this step. `club_members` mirrors the role and the leaderboard flag after each change, and an idempotent reconcile (the same statement as the backfill) repairs anything missed. Reads move to `club_members` in step 11, and `club_roles` is dropped in step 12.
  - The mirror runs outside transactions only. A failed statement inside an open transaction would abort it, which the grant script's tests caught.
  - **Plan change: `tenant_modules` has the platform lock from the start** (`locked` on/off, `lock_reason`, §6.2.3), which saves a later migration.
  - **Plan change: `tenants.location` (a PostGIS point) is left for Phase 7** (Find a club). Production has no PostGIS, and nothing needs the column before then.
  - Clubs have integer ids, like every other table. The slug is the public name; code looks a club up by slug or host and never assumes id 1.
  - The accounts table keeps the name `players`. New tables call the link `user_id`, the name the plan uses for the global identity.
  - The migration also creates Three Wolves in every new database (CI, previews, local). A second region's database needs its own first club, which is decided with the Hanoi work.
  - Rehearsed on a fresh Neon branch of production: 17 live accounts, 0 problems, no schema drift, 2 owners and 2 platform admins unchanged (`docs/rehearsals/2026-11-phase3-tenants.md`).
  - **Production run, 23 Nov 2026, 07:36 UTC:** restore point `pre-phase-3-tenants`; the migration took 5.5 s; the data guard diff passed with 17 accounts and 0 problems; no drift; 19 accounts and 19 club members, mirror drift 0.
  - Finding for step 6 (host routing): the site is served from `www.threewolvesbadminton.org` (the bare domain redirects there), and `tenants.custom_domain` holds the bare domain. The host lookup has to treat both as Three Wolves.
  - Finding for step 10: many tables have keys that only work for one club (`sessions` by date, `attendance` by date and email, `club_settings` by key, `pricing_plans` by plan id, and others). Their primary keys and unique indexes have to gain `tenant_id` before a second club can exist.
- **Step 2, `tenant_id` columns (migration `0004_tenant_id_columns`):**
  - A nullable `tenant_id` on the 54 club-owned tables. `packages/db/tenancy.ts` lists every table as club-owned or platform-wide, and a test fails on a table in neither list. Platform-wide: accounts and sign-in (`players`, `player_sessions`, `auth_codes`, `sms_sends`, `admin_handoffs`, `player_events`, `player_settings`), `tenants`, `platform_admins`, `guardianships`, and the unused `schema_runs` and `pv_*` tables.
  - **Plan change: no batched backfill.** The column has a constant default (Three Wolves' id), which Postgres keeps in the catalog. No row is rewritten, every existing row reads as Three Wolves' in the same atomic change, and rows written by the previous app version get it too, which a batched backfill can't do. The default is dropped in step 10, before a second club can exist; the migration and `verify.mjs` both refuse a second club while it's in place.
  - The 54 `ALTER`s run as one statement, so each table's exclusive lock is held for milliseconds, not for 54 round trips.
  - **Vision tables (`wv_*`) are club-owned for now.** Decision AF makes Vision a platform product; who owns its passes, labels and models is settled with the Vision cutover (§11.2).
  - **New tool: `scripts/characterise.ts`** (test plan §4.4, T−4). It hashes each account's views (account, membership, play days left, calendar, quick stats, stats, orders, threads, points board, access, data export) and the club boards before and after a change. No tool for this existed before.
  - **It caught a real difference on its first use:** "Download my data" selected every column of `arena_pairs`, so 4 members' exports gained a `tenant_id` field. The query now names its columns. The data guard can't see this kind of change, because no stored value changed.
  - **Correction: step 2 was planned to deploy before it migrated, and that was wrong.** The production build of the merged change failed, because Drizzle's typed queries name every column in `schema.ts`, so a version that adds a column can't build (the home page is prerendered from the database) or run until the column exists. The failed build never went live. The migration ran, then `main` was redeployed. **Rule: migrate first, then merge.** The previous version always works with a new column in place; the new version never works without it.
  - Finding: the Neon driver sends its HTTP queries to the region's `api.` host, not the database's own host. Operator scripts that run the app's client now point them at the database host, so the session's network allowlist needs one host per branch, not two.
  - Rehearsed on a fresh Neon branch of production: 17 accounts, 0 problems; 1,441 rows in 57 tables all with the club's id; characterisation identical; no drift (`docs/rehearsals/2026-11-phase3-tenant-id.md`).
  - **Production run, 23 Nov 2026, 08:25 UTC:** restore point `pre-phase-3-tenant-id`; the migration took 1.4 s; the data guard diff passed with 17 accounts and 0 problems; no drift; 1,441 rows in 57 tables all with the club's id. Live at 08:28 UTC.
- **Step 3, email links → `user_id` (migration `0005_user_id_links`):**
  - Ten tables gain a nullable `user_id` with a foreign key to the account (`ON DELETE RESTRICT`) and an index: `attendance`, `bookings`, `casual_play_profiles`, `day_requests`, `donations`, `jersey_registrations`, `memberships`, `player_absences`, `session_fill_ins`, `waitlist`. `shop_orders` already had `player_id`. The email stays as the contact field.
  - On production's data: 453 rows, 287 linked to an account, 166 for people without one (guests, and members who never signed in). All 10 active memberships were already linked, so there was no `ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT` to resolve first.
  - **Plan change: database triggers keep the link in step, not app code.** The previous app version doesn't know the column, and rows are written from many places (checkout, Stripe webhooks, crons, admin). Two functions: a row points at the live account with its email when it's inserted or its email changes; an account picks up the rows under its email when it's created, and lets go of them when it's soft-deleted. That is the rule the email joins follow today, so a person's rows by `user_id` are the rows they see now. The triggers come out when the app writes `user_id` itself (step 11 or 12).
  - A deleted account's rows have no `user_id`. They stay, with their email, "no longer linked to a sign-in" as today, and a new sign-up with the same email picks them up again, as today.
  - **Tooling:** the schema dump and the drift check now cover functions and triggers. A Drizzle schema can't describe them, so the "built from `schema.ts`" comparison covers tables, indexes and sequences, and the migrations comparison covers everything.
  - **The characterisation check caught a second thing:** one member's data export listed two same-day bookings in a different order after the backfill, because the export sorted by date only and the backfill changes the order rows are stored in. Every list in the export now has a full sort order. The rehearsal was repeated from a fresh copy and is identical.
  - Rehearsed on a fresh Neon branch of production: 17 accounts, 0 problems; no disagreement between `user_id` and email on 453 rows; characterisation identical; no drift (`docs/rehearsals/2026-11-phase3-user-id-links.md`).
  - **Production run, 23 Nov 2026, 09:09 UTC:** restore point `pre-phase-3-user-id-links`; the migration took 4.4 s; the data guard diff passed with 17 accounts and 0 problems; no drift; no disagreement between `user_id` and the email on 453 rows. Merged at 09:11 UTC.
- **Step 4, settings replace constants (no migration):**
  - Part 1: `@luvallplay/core/club-config` (pure) turns a club's `tenants` row and `tenant_modules.settings` into one typed `ClubConfig`, and compares two configs setting by setting. `lib/club-config.ts` loads it, cached for a minute.
  - **The feature flag is `CLUB_SETTINGS_SOURCE`:** `constants` (default), `shadow` (built-in values answer, stored ones are compared and differences logged) or `database`. This is the shadow read for settings.
  - A missing or malformed stored value falls back to the built-in value for that field only, and is reported. A database error never breaks a page.
  - A test proves the settings migration 0003 stored for Three Wolves equal today's constants exactly, so the shadow comparison starts empty. Admin → Setup check shows it live.
  - The loader is tested with a second, synthetic club (Vietnam, VND, its own days and limits) to show nothing is borrowed from Three Wolves' values.
  - Part 2: the donation routes and the membership start search read the loader. Shadow reads for settings started on production on 23 Nov 2026, 09:50 UTC.
  - Part 3: `"Pacific/Auckland"` was typed into 16 files. They share one constant now, which is also the built-in value of the `timezone` setting, and a scan fails on new copies.
  - Part 4: play-day capacity reads the settings. **Finding:** the booking guard's SQL had its own typed copy of the courts → players table ("keep the two in sync" in a comment). It now takes the table as a parameter, so the query and the code can't disagree.
  - Part 5: the remaining server-side capacity uses read the settings.
- **Step 5, module enforcement (no migration):**
  - **Plan change: route ownership is one table (`packages/modules/src/routes.ts`), not spread over the manifests.** Each prefix has an owner: a module, `core`, `account` (sign-in and the player's own account) or `platform`. The longest prefix wins. A test generated from the app's route list fails on a route without an owner, which is the "new endpoint without coverage fails CI" rule applied to modules.
  - Enforcement is in the request proxy: a path whose module is off answers 404, for pages, API routes and crons alike. The proxy now sees every `/api` request; the check is an in-memory lookup, with the club's switches read at most once a minute.
  - **Decision: enforcement fails open.** If the switches can't be read, every module counts as on. Modules are a product switch, not a security boundary, and a database hiccup must not turn a club's features off. Tenant lookup (step 6) fails closed, as the plan says.
  - A module without a row is off; the core is on whatever the table says.
  - The minimal switch is Admin → Settings → Modules, for owners and platform admins, using the registry's `canTurnOn` / `canTurnOff`.
  - Finding: `payments-to-check` owns no route of its own (its screens are inside Members and Shop), so it is switched inside those pages, in the next part.
  - Part 2 (after #106): what's left of step 5 is module parts inside other modules' pages, per-module emails and the platform console's lock.
- **Step 4, continued:**
  - **Finding: the hosting plan keeps server logs for one hour**, so logs can't show "shadow reads clean for 7 days". **Plan change:** each shadow result is a row in `admin_audit_log` (`shadow.<what>`: `clean`, `differ` or `unavailable`). A difference is written when a request sees it; the roster cron writes one result a day. `scripts/shadow-report.mjs` prints the record and is the evidence for the step 11 gate.
  - The booking clock (time zone, booking window, cut-off hour) is a parameter of the date helpers. The booking rule, the Me page and the calendar components pass the club's. About 50 other callers still use the default (the built-in values, equal to Three Wolves' settings); they move as their modules are touched.
  - Membership cycle lengths in the renewal SQL, the Stripe sync and the free month come from the settings. They go into SQL as whole numbers only.
  - Client components read the club's public settings from a provider (`useClub()`), filled by the root layout.
- **Step 6, second driver and region routing (no migration):**
  - `DATABASE_DRIVER` chooses the Neon driver (default) or standard Postgres (`lib/database-pg.ts`). The golden master compares three clients: the old one, the Neon driver and standard Postgres. An unknown driver name stops the app.
  - Host → club → region is pure logic in `@luvallplay/core/host-routing`, with every host type of §6.4 told apart. `TENANT_ROUTING` is `off` (default), `shadow` or `enforce`; an unknown value enforces. Refusals: 404 unknown host, 421 another region's club, 503 when the lookup can't answer.
  - **Decision: Edge Config is a copy, the `tenants` table is the truth.** A host missing from the copy is looked up in the database, so a new club's domain works before the copy is refreshed, and a broken copy doesn't take clubs offline. If both fail, nothing is served.
  - **Decision: one club per deployment until step 11.** A host that resolves to a different club in the same region is refused, because reads aren't tenant-aware yet.
  - **Decision: the deployment's own host names** (the hosting provider's URLs, used by its scheduler and previews) serve the deployment's club. This rule goes away when a deployment holds more than one club.
  - Storage (`lib/storage.ts`) and scheduled jobs (`lib/cron.ts`) are interfaces with Vercel as the first provider; a contract test is ready for the S3-compatible provider, and `scripts/cron/k8s.mjs` prints Kubernetes CronJobs from the same list as `vercel.json`.
  - **Finding:** two scheduled jobs didn't require the scheduler's secret when it was unset. All five now share one check that refuses in production without a secret.
  - **Not done in Phase 3:** the S3-compatible storage provider, the platform's own hosts (marketing, app, admin, api) and cross-region forwarding. They belong to the Vietnam launch and Phase 6.
- **Step 7, money audit (no migration):**
  - `@luvallplay/core/money` holds the currency table (exponents), exact conversion both ways, and formatting. 41 hand-written conversions and 12 typed currency codes now use it.
  - VND cases are in the tests: whole dong, no division, fractions refused, Vietnamese grouping.
  - Two CI scans: arithmetic by 100 outside the helpers, and typed currency codes.
  - **Decision: column names stay (`*_cents`), and a row's currency is its club's.** Both are written in the runbook (§7).
  - **Finding:** a negative amount used to print as `$-10.50`; it now prints as `-$10.50`.
- **Step 8, payments interface (no migration):**
  - The interface and its rules are pure (`@luvallplay/core/payments`); Stripe is the first provider. One contract suite runs on every provider, including replay twice and out of order.
  - One-off payments (casual play, donations, shop) and the webhook signature check use it. **Plan change: subscriptions stay on Stripe's own API for now**, behind a pinned list of files; the interface's subscription operations are designed with the first provider that can't charge again by itself, so they aren't shaped by Stripe alone.
- **Step 9, entitlements and metering (migration `0006_entitlements`, additive):**
  - `plans` (platform), `club_plans` and `usage_counters`. Three Wolves is on `nz-badminton-free`. Prices are minor units plus a currency; a test adds a Vietnamese plan priced in whole dong.
  - `can()` is built and tested with billing on and off. **Decision: the free tier survives everything** (no plan, an ended plan, a plan that can't be read), so a billing problem never takes away what a free club runs its sessions with. A late payment switches nothing off.
  - Usage is counted for emails, sign-in texts, uploads and payments started. **Decision: limits report, they never block**, and the limits are empty until the cost model sets them.
  - Rehearsed on a fresh copy of production: 17 accounts, 0 problems.
  - **Production run, 23 Nov 2026, 17:09 UTC:** restore point `pre-phase-3-entitlements`; 3.5 s; data guard 17 accounts, 0 problems; no drift.
- **Step 10, required club id and row-level security (migration `0007_tenant_rls`, no row changes):**
  - `tenant_id` is `NOT NULL` with a foreign key on all 59 club-owned tables. Row-level security is enabled and forced on each, with one policy keyed on the transaction setting `app.tenant_id`. The app's role `luvallplay_app` has no login and can't bypass it. With no club named, nothing is visible.
  - **Finding: the database owner on Neon has `BYPASSRLS`.** So the policies can go in without touching the live app, and the app moves onto the role by a setting (`TENANT_SCOPE`), not by a deploy of new queries.
  - **Decision: the role and the club are set per transaction** (`SET LOCAL ROLE`, `set_config(…, true)`), never per session, because the pooled endpoint hands a server connection to another request after each transaction.
  - **Plan change: shadow reads are done at the database client.** In `shadow` mode a sample of real reads is run a second time as the app's role, in a read-only transaction, and compared as a set of rows. This tests the app's actual queries, not a list someone wrote.
  - **Plan change: natural keys are widened in step 11, not step 10** (runbook §10).
  - The golden master has a fourth copy that runs through row-level security; it found three orderings without a tie-breaker, now fixed.
  - **Decision: the account-linking trigger runs as its owner**, because accounts are global and must link rows in every club.
  - **The app's own login** (`APP_DATABASE_URL`, runbook §11.2): the code is built. With it set, the app connects as a role that has no rights until it steps down to the app's role, every statement is scoped whatever `TENANT_SCOPE` says, and the owner's connection string is left to migrations and operator scripts. **Decision: a second variable, not a new meaning for `POSTGRES_URL`**, so no script changes and the Neon integration keeps managing the owner's string. Creating the login is the owner's step (it needs a password); `scripts/tenants/app-login.mjs` checks it.
- **Step 11, preparation (migration `0010_tenant_keys`, no row changes):**
  - **The route-level isolation suite** is an end-to-end journey: a second, synthetic club runs on its own server under `TENANT_SCOPE=enforce`, and every route, generated from the `app` directory, is requested as a platform admin and as nobody.
  - **Finding: the admin Players page listed every account on the platform.** Row-level security can't catch this, because accounts are global by design; the page now joins to the club's members. Lesson for later phases: every query on a platform table needs its own club condition, and only the route-level suite checks that.
  - **Finding: `DEFAULT 1` made every write for a second club fail under `enforce`.** The default now follows the transaction's club.
  - **Decision: keys are widened by expand and contract.** `0010` adds per-club unique indexes beside 20 natural keys and the app's upserts name them; `0011` drops the old keys and gives the per-club ones their names, reusing the indexes (no rebuild). The foreign keys to a play day carry the club.
  - **Finding: the new version fails against a database without `0010`** (the calendar's upsert). Migrate first, then merge.
  - **Production run, 23 Nov 2026, 22:40 UTC:** 6.0 s; data guard 18 accounts, 0 problems; no drift.
  - **Finding about the tests:** the check "Drizzle Kit sees nothing to migrate" has not been comparing anything since migration `0006`: the journal has no snapshots after `0005`, and Drizzle Kit, given the temporary directory's absolute path, writes nothing. The other half of that test, a database built from `schema.ts` equals the reference dump, does work and covers the same ground. Left as is; to be repaired or removed in Phase 4.
- **Tests added after step 10:**
  - **Permission matrix (test plan §3.6), from the database:** eight roles against six actions, each person's access resolved as the app's role for the club. It adds the rows Phase 3 brings: another club's admin (an admin there, nobody here), switching modules (owners and platform admins), and the platform's lock (holds for owners).
  - **Finding from journey S2:** the request proxy and the pages keep separate copies of the module switches, each remembered for a minute. So a switch takes effect at once on the instance that made it and within a minute everywhere else. `MODULES_CACHE_MS` sets the time (tests use 0).
  - **Journey S2:** an owner switches a module off; its pages and API answer 404, its data is kept, the rest of the club carries on; back on, everything returns; an admin who isn't an owner has no switch.
- **Steps 4 and 5, second round:**
  - The club's clock is passed at about 40 async call sites; 11 plain helpers are pinned in a test until their callers can pass it. **Finding:** `endOfClubDay` in the shop tries the two New Zealand UTC offsets by hand; it needs a time-zone-aware rewrite before a club outside New Zealand uses the shop.
  - **Plan change: a club's terms are per language.** Vietnamese has its own wording for the points ("Điểm Sói"), so `tenants.terms` gains `localized.<lang>`; a language with no name of its own uses the club's single name and never borrows Three Wolves'. Migration `0008_terms_localized` stores Three Wolves' Vietnamese name.
  - **Decision: the club's terms are set once per server process** (and per browser), because a deployment holds one club until step 11.
  - Sections, navigation, tabs and Me-page cards follow the module switches. Luvallplay staff can lock a module on or off with a reason.
- **Steps 4 and 5, third round:**
  - Every call of the date helpers passes the club's clock; the scan's list of exceptions is empty. The shop's end-of-day helper is time-zone-aware (tested in five zones and on the days the clocks change).
  - No club term is typed outside `lib/constants.ts`: app code uses `pointsName()`, `visionName()`, `alphaName()`, `silverName()` or `withTerms()`, and module-level copy tables are wrapped so the terms are filled as each entry is read. Migration `0009_terms_seats` stores the seat titles.
  - **Decision: switching a module off never strands money.** New "pay later" reservations stop; ones already waiting can still be marked as paid, and emails about payments already taken are still sent.
- **Findings about the environment:**
  - Neon's free plan keeps **6 hours** of history, not the 7 days the test plan's runbook asks for (§4.4). Each step's named `pre-<step>` branch is its restore point until that changes.
  - The Neon project is at 6 of the free plan's 10 branches. Rehearsal branches from Phase 2 and Phase 3 are still there and hold real data.
  - Local development has Postgres 16. The schema drift check needs 18 and runs in CI and against the Neon rehearsal branch.

---

## 7. Phase 6: brand, websites and the setup wizard

### 7.1 Luvallplay brand

Name: **Luvallplay**. Domain to buy: **luvallplay.org** (+ .com, .nz). The brand lives in the **Luvallplay brand** design system: https://claude.ai/artifact/7do36zHNvLp3pFdNUC7euj (logo files, app icon, colour and type tokens, voice and usage rules). It's private until you share it.

The design system is the source of truth. If anything here differs from it, the design system wins.

- **Mark: a heart in bloom.** A Rally Coral heart sits where four rounded Court Green petals meet (lime petals on dark grounds). The petals read as four players around a court and as a shuttle's feathers; the heart is the "love" in love all. It works for any sport.
- **Wordmark:** lowercase **luvallplay** in Montserrat Alternates ExtraBold, outlined in the logo files (never retyped). Side-by-side, stacked and one-colour versions exist.
- **App icon:** lime petals and a coral heart on a full-bleed Court Green square.

| Token | Colour | Use |
|---|---|---|
| **Court Green** | `#0E6B4F` | Primary: buttons, active tabs, headers (white text on it: 6.2:1 ✔) |
| **Net Navy** | `#0B1B2B` | Text, dark mode surfaces |
| **Shuttle White** | `#FAFAF7` | Backgrounds |
| **Smash Lime** | `#D4F23C` | Accent: highlights, rank-ups, live states. **Fill only, never text on light** (lime on navy: 13.7:1 ✔) |
| **Rally Coral** | `#FF6B4A` | Social and notification accents, sparingly |
| Line Grey | `#E3E7E4` | Dividers, court-line motif |

- **Type:** **Be Vietnam Pro** for text (full Vietnamese support, less generic than Inter) + **Barlow Condensed** for scores, ranks and headlines. Both are free Google Fonts.
- **Dark mode** from day one.

All palettes are validated for WCAG AA in light and dark. Clubs choose from 12 tested schemes or import their own brand, with automatic contrast adjustment (§6.3.1–6.3.2).

### 7.2 Setup wizard ("Start your club", about 5 minutes)

```
① Sign in (code) → ② Your club → ③ Look & feel → ④ How you charge → ⑤ Pick modules → ⑥ Go global? → ⑦ Invite & import → ⑧ Launch
```

| Step | Content | Best practice applied |
|---|---|---|
| ② Your club | Name, URL slug (live availability check), **country** (sets region, currency, payment flow and legal documents, §6.9), **sports played** (§6.7), city/venue (map pin, used by Find a club), languages | Autosave every field; live preview of the club page on the right (desktop) or a "Preview" toggle (mobile) |
| ③ Look & feel | Pick one of the **12 colour schemes** (§6.3.1), shown live on the club's own name, a play-day card and a button in light and dark. Or **Use our own branding**: upload logo, font and colours, or import them from the club's website (§6.3.2) | One tap picks a scheme; the custom path has its own short sub-steps with previews; automatic contrast fixes explained in plain words |
| ④ How you charge | Up to three questions (§6.2.2): *Do you charge players?* → *Is your club incorporated?* → *Does it have its own Stripe account?* The answers set the mode: **Free play**, **Cash and bank transfer only**, or **Online payments** (connect the club's Stripe account right there). Cash and bank transfer clubs then enter bank details and choose cash-at-the-hall, confirm-before-paid and Akahu matching | One question per screen, plain words with an "Not sure?" explainer. Free play is a full, first-class choice. Cards are only offered to incorporated clubs with Stripe; everyone else gets a working cash and bank-transfer setup plus the "Getting incorporated" guide. Admin is configured from the answers |
| ⑤ Pick modules | Starter **presets** (§6.2.3): *Free social club* (core only), *Social club*, *Competitive club*, *Coaching academy*. Then grouped cards (Run your club · Money · Engage players) with on/off toggles. The core is shown as "Always included"; Money cards are hidden for Free play | Dependencies selected automatically with a note ("Memberships needs Play days"); 3–4 sensible defaults pre-selected; never more than one decision per card |
| ⑥ Go global? | Four plain toggles: list in **Find a club** · players can appear on **global leaderboards** · **social** · **marketplace**, each with a one-line privacy explanation | Opt-in, off by default except the directory listing; changeable any time |
| ⑦ Invite & import | Invite co-admins by email; import members from CSV or a spreadsheet paste | Skippable |
| ⑧ Launch | Checklist summary, club link, QR poster for the hall (in the club's colours), "Get the app" link | Celebrate; next-step suggestions |

- A progress bar and Back / Next on every step.
- Everything after step ② is skippable.
- Every choice can be changed later: **Admin → Look & feel** reuses step ③, **Admin → Payments** step ④ (with the mode-switch guards in §6.2.1 and "Turn on card payments" in §6.2.2), and **Admin → Modules** steps ⑤ and ⑥.

### 7.3 Club landing pages

- Built from `packages/site-templates` sections fed by club settings, plus content from the built-in **Website editor** in Admin: text, photos, FAQ and reviews, with live preview.
- Two or three templates to start: *Classic*, *Bold*, *Minimal*.
- Templates render in the club's theme (preset or imported brand), so every template works with every scheme.
- The site's job is to explain the club, show the schedule, prices and gallery, and turn visitors into players through **Join in the app** and **Book a casual session**.
- For free-play clubs the price section becomes a clear **"Free to play: just turn up"** block, and the call to action is **Sign up for a play day**.

### 7.4 Luvallplay introduction website (luvallplay.org)

A public website that introduces Luvallplay to clubs, organisers and players. It's in **English and Vietnamese**, built to impress, and **sport-neutral**: Luvallplay starts with badminton but is useful to any club that runs regular sessions.

**Can start now.** It only needs the brand system and the domain, so it's a parallel track and doesn't wait for Phases 3–6. Before the app is public it runs in **"coming soon"** mode with a sign-up form. It switches to full launch mode (Start your club, Find a club, store badges) when the setup wizard ships in Phase 6.

**Positioning and voice:**
- **Headline idea:** **"Love all, play."** The call that starts a game in badminton, tennis, squash and table tennis, read here as an invitation: everyone is welcome, come and play.
- **One-line promise:** *"The free app for clubs and players. Run your sessions, welcome everyone, and play more."*
- **Sport-neutral words:** session, game, court or field, team, members. Sport-specific examples rotate:
  - racquet sports: badminton, pickleball, tennis, table tennis, squash;
  - team sports: volleyball, futsal, basketball, netball;
  - social sport generally.
- Badminton is described as where Luvallplay started (Three Wolves), not as the limit.
- Voice from the brand book: warm, direct, short sentences, sentence case, no emoji in headings, and sport-neutral words wherever Luvallplay speaks for itself (the brand book now says so).

**Brand (strictly from the design system):**
- Logo files as provided: the side-by-side lockup in the header, the stacked lockup in the footer, and the dark versions on Net Navy sections.
- Colours: `court-green` for primary actions, `smash-lime` as the one accent per screen, `rally-coral` only around the heart and social moments, and `surface` / `surface-raised` / `ink` for the page. Light and dark themes.
- Type: **Barlow Condensed** (`display-xl` for the hero) and **Be Vietnam Pro** for all body text. It covers Vietnamese fully.
- Shape: pill buttons, `radius-lg` cards, flat surfaces with `line` dividers, a visible `focus` ring, and 150–250ms springy motion that respects reduced motion.

**Page sections, in order:**

| Section | Content | How it's made attractive |
|---|---|---|
| **Hero** | "Love all, play." + the one-line promise. **Start your club, it's free** and **Find a club** (before launch: **Join the waitlist**) | A big `display-xl` headline on Court Green. The **lines-of-play motif**: the court-line pattern generalised to field markings that redraw from one sport to the next (badminton court → tennis → futsal pitch → volleyball) in thin `court-line` strokes, with a still image when reduced motion is on. Real community photos in rounded frames |
| **Sports strip** | Chips: Badminton · Pickleball · Tennis · Table tennis · Volleyball · Futsal · Basketball · +more | Picking a sport swaps the photos and example wording across the page |
| **How it works** | 3 steps: *Set up your club in 5 minutes* → *Invite your players* → *Play* | Large numerals in `score` style; short sentences |
| **Everything your club needs** | Sessions and sign-ups, waitlists, attendance, members, messages, a club website. The optional modules shown as an "add what you need" grid | Product screenshots in phone and tablet frames, **each in a different club colour scheme**, to show off the 12 schemes |
| **Free, the way clubs need it** | Free play, cash and bank transfer, or online payments for incorporated clubs. No platform fees today | Three cards that mirror the setup choices |
| **Make it yours** | 12 colour schemes or your own logo, fonts and colours | An interactive scheme picker that re-colours a sample club card live |
| **For players** | One account for every club, your stats and streaks, find a club nearby; the marketplace and social "coming soon" | A device mock with the Me page |
| **Safe and fair** | Clubs manage their own members, safeguarding across the platform, guardians manage juniors, your club owns its data, privacy law in your country | Calm `surface-raised` cards with line icons |
| **Story** | "Started at Three Wolves in Christchurch", with a quote (with the club's consent) | Photo with the club's colours as a co-brand moment |
| **FAQ** | Cost, payments, sports supported, languages, data ownership, getting incorporated | Accordion; FAQ structured data |
| **Footer** | Stacked lockup, language switch, App Store / Google Play badges ("coming soon" until launch), legal, contact, "A product of The GOAT Solution" | Net Navy section with dark-theme logo |

**English and Vietnamese:**
- Every word, image alt text, meta tag and social preview image exists in both languages.
- URLs are `/en/…` and `/vi/…` with `hreflang` links, so search engines show the right one. The first visit picks the browser's language, and a visible switch remembers the choice.
- Vietnamese copy is written natively and reviewed by a Vietnamese speaker (not machine-translated), and layouts are checked for its longer lines.

**Build:**
- Lives in `apps/web` and is served for the `luvallplay.org` host (+ `.com`/`.nz` redirects) through the same host routing as club sites (§6.4).
- Content comes from Sanity, per decision D (Luvallplay's own marketing content), with `en`/`vi` fields.
- Pages are statically generated.
- The **waitlist/interest form** asks for email, name, club, sport, city and role (organiser or player). It uses Turnstile spam protection and double opt-in by email, and is stored in Postgres with consent recorded.
- Privacy-friendly analytics only, with no tracking cookies.
- Structured data for Organization, SoftwareApplication and FAQPage, plus Open Graph images per language.
- Targets: Lighthouse ≥ 95 on all four scores, WCAG AA in both themes and both languages.

#### 7.4.1 Design direction: fun, playful, healthy and clean

The research behind this (2026 trend roundups from Figma, Envato, Elementor, GoDaddy, Liquid Web and DesignRush, plus fitness and community-sport site reviews; sources in the planning thread) points one way: **clean structure with real personality**. Sites should feel *experienced, not just viewed*, with motion that has a purpose, bold but controlled colour, real people instead of stock, and accessibility and speed treated as core, not extras.

| Trend | How the Luvallplay site uses it | Guardrail |
|---|---|---|
| **Bento grids:** modular, scannable cards with soft corners | "Everything your club needs" is a bento grid. Mixed card sizes in `radius-lg`, each card one feature with a tiny live animation: a sign-up counter ticking up, a waitlist name sliding into a spot, attendance ticks appearing, a score going 20–19 → 21–19 | Cards are flat `surface-raised` with a `line` border; no glass, no heavy shadows. Max 7 cards |
| **Kinetic, expressive type** | The hero sets "Love all, play." in Barlow Condensed `display-xl`, and the letters land one after another with a small bounce, like a ball. Under it, a rotating sport word cycles through badminton → pickleball → futsal → netball → volleyball | Plays once, then stays still. Reduced motion shows the final text. The rotating word pauses on hover and focus, and screen readers get the plain sentence |
| **Snappy, purposeful motion** (easing that matches a playful brand) | Springy 150–250ms ease-out with a slight overshoot on buttons (a tiny squash on press), chips and cards. The logo's petals turn a quarter and the heart beats once on load and on hover | Only `transform` and `opacity` are animated. Nothing loops forever, and nothing moves while someone is reading |
| **Scroll-driven animation:** now native in Chrome, Safari and Firefox (Baseline since Firefox 159) | The **lines-of-play** motif draws itself as you scroll: a court outline becomes a pitch, then a table. Sections fade and rise in gently | Pure CSS `animation-timeline` behind `@supports` and `prefers-reduced-motion`. Without support, everything shows complete and static |
| **View transitions** | Switching language, sport chip or colour scheme cross-fades smoothly instead of jumping | Progressive enhancement only |
| **Bold, "dopamine" colour, controlled** | Big colour blocks in Court Green, Smash Lime and Rally Coral on warm Shuttle White, echoing the cover. The scheme picker shows off the 12 club schemes | One accent colour per *section* (the brand's one-per-screen rule, adapted for long pages); text always on `surface` or a token pair that passes AA |
| **Organic, friendly shapes** | The logo's rounded **petals** become a shape family: soft petal and pill shapes behind photos and stats, and a petal-shaped mask on community photos | Max 2 decorative shapes per section; never behind body text |
| **Tactile "sticker" accents** (light skeuomorphism) | A few rounded badge stickers, slightly tilted: "Free for clubs", "Safe for juniors", "EN · VI", in lime or coral with a soft edge | Max 3 on the page; real text, not images |
| **Real people, real places** (the top fitness-site lesson) | Photos of real NZ community sport: halls, courts, parks, mixed ages, abilities and backgrounds, laughing between games. Simple line illustrations of different sports in the brand icon style (1.9px stroke, round caps) fill gaps | No stock "athletes", no AI-generated people, no posed gym shots |
| **Interactive previews** ("show the experience") | Three small demos: the **scheme picker**, a **"build your club"** toggle where switching modules on lights up bento cards, and a **sport switch** that re-words the page | Each works with keyboard and touch, and has a static fallback |
| **Accessibility and honesty as design** | Large readable type (18px body on the site), generous spacing, clear focus rings, plain-language copy | No pop-ups, countdowns or pre-ticked boxes, no dark patterns, no cookie wall (no tracking cookies at all) |
| **Fast and light ("healthy" for the planet too)** | Static pages, modern image formats with responsive sizes, fonts subset to Latin + Vietnamese, CSS-first animation, no autoplay video | Budgets: LCP < 2.0s on 4G mid-range Android, JS < 80 KB on the home page, total page < 1 MB |

**What "healthy" and "clean" mean here:**
- Warm off-white `surface` (never stark white or grey), lots of white space, greens leading the palette, and daylight and outdoor photos.
- Two typefaces only and one clear hierarchy per section.
- Calm pacing: one idea per section, one main button per section.

**Trends deliberately not used:** heavy glassmorphism (hurts readability), anti-grid brutalism and neo-brutalism (not friendly), Y2K chrome, WebGL/3D scenes and autoplay video (slow on phones), AI-generated imagery, mascots, and confetti.

**Design deliverables before build:**
1. A moodboard and a single long-page mock in both languages and both themes.
2. The motion spec (timings, easing, what moves and when, reduced-motion versions).
3. The illustration and shape set (sport line icons, petal shapes, stickers).
4. A short photo brief for the shoot.

Each is reviewed with you before build.

**Imagery:** real, diverse community sport in NZ halls and parks across several sports, licensed or commissioned (a small photo shoot with Three Wolves and one or two partner clubs is ideal). No stock "business people with rackets". Product screenshots come from the real app with demo data.

**Done when:**
- The design direction in §7.4.1 is approved and implemented, including reduced-motion and no-support fallbacks.
- Both languages are complete.
- The waitlist works end to end.
- It passes the test plan gate for the intro site.
- It's live on luvallplay.org.

---

### 7.5 Phase 6 delivery log and plan changes

**Stage A, the public website (24 Nov 2026).** Built on branch `claude/luvallplay-phase-6`; the runbook is `docs/plans/phase-6-runbook.md`.

Plan changes (they supersede §7.4 where they differ):

| Change | Why |
|---|---|
| **The website is its own app, `apps/site`, and its own Vercel project (`luvallplay-site`)**, not a host inside `apps/web` | A marketing change can't touch Three Wolves, and the reverse. The product parts (wizard, club sites on `{club}.luvallplay.com`, custom domains) stay in `apps/web` (Stage B); the wildcard goes to the platform project, the apex to this one |
| **luvallplay.com is the primary domain** (not .org); .org and .nz redirect to it; **luvallplay.vn is the Vietnamese home** | Owner's decision. All four are attached to the Vercel project and wait only for DNS |
| **Design D ("Rally")** is the approved design (`docs/design/website-d`), so its page order replaces the section table in §7.4, and its layered cards, glass header and soft shadows replace the "flat, no glass" guardrail in §7.4.1 | Owner chose design D |
| **Sanity: a separate project and Studio (`apps/site-studio`)**, with the content also **seeded in the repo** | The site is complete before Sanity is connected and stays up if Sanity is unreachable. The seed is what gets pushed to Sanity |
| **The site has its own small Postgres** for form submissions (`pg`, three tables, created at build) | Nothing about the public site reads or writes the Three Wolves database |
| **Only true facts.** Every sample person, quote, ranking and number in the design is replaced by a real fact, an illustration labelled as one, or a slot that stays empty until real content exists | Owner's rule. `tests/completeness.test.ts` fails on design placeholders, price numbers and missing translations |
| **Nothing loops:** the hero score plays one demo game and rests (with a replay button); the ticker glides across twice and rests, and says "On Luvallplay", not "Live now" | Gate R's motion rules, with design D's two animations kept |
| **Two launch switches in the Studio:** `launchMode` (waitlist or wizard and stores) and "search indexing" (noindex until go-live) | Both flip without a deploy |
| **Home-page JavaScript is about 135 KB gzipped, over the 80 KB target** | Nearly all of it is the Next.js and React runtime; the site's own interactive code (score demo, finder, theme switch) is a few KB. The pages are pre-rendered and work without JavaScript, Lighthouse performance is 98 to 99 and LCP about 1 s on the throttled mobile profile. Meeting 80 KB would mean leaving Next.js for this app; left as an open decision |

Gate R results (local production build, CI job "Website"):

- 17 unit tests and 10 end-to-end checks pass: 58 pages crawled, every link and anchor resolves, each page has a twin in the other language, title, description, canonical, hreflang, Open Graph and exactly one h1; axe finds no violations on 12 page types in both languages, light and dark, phone and desktop; no sideways scroll at 320, 375, 600, 840 and 1200 px; no animation under reduced motion, none infinite, complete without JavaScript; the only cookie is `lang`.
- Forms: honeypot, consent recorded with its wording, double opt-in (the emailed link shows a button, so mail scanners can't confirm), duplicates update one row, "Remove my details", rate limit with hashed buckets, nothing sent outside production.
- Lighthouse (mobile, throttled): performance 98 (en) and 99 (vi), best practices 100, accessibility 100 after the fix below, SEO 69 only because the site is deliberately `noindex` before go-live.
- Found and fixed by the checks: a menu link with a stray slash; contrast lost while a card was fading in on scroll (the fade is gone, the rise stays); heading order on two pages; the 404 page losing its language.

Still open for Stage A: the Sanity organisation (owner is creating one), the forms database (owner creates it from Vercel, runbook §4), Resend DNS, DNS for the four domains, company details for Privacy and Terms, and a Vietnamese speaker's review of the Vietnamese copy. An ignored-build step for the Three Wolves project (so website-only changes don't rebuild it) is written (`scripts/vercel-ignore.sh web`) but not switched on: it changes how Three Wolves deploys, so it waits for the owner's go-ahead.

**Stage B** (setup wizard, club websites and editor, Admin → Modules, Look & feel, Payments, Stripe Connect in test mode, the readiness-gate lock) has not started: it needs Phase 3 finished (§6.10).

---

## 8. Phase 7: global modules (opt-in per club)

Build them in this order, each one releasable on its own. **Decision Z: social and marketplace are gated.** Items 1 and 2 are built first. Items 3 and 4 start only when the **gate** passes:
- **Enough density:** thresholds set after the partner period (proposed: at least 15 active clubs and 500 weekly active players in the region, so there's something to see and to moderate).
- **Moderation capacity:** a named owner, a published process and response times.
- **The country's legal checks are done (written down, with counsel):**
  - **NZ:** the Harmful Digital Communications Act safe-harbour complaints process (48-hour deadlines), spam-law compliance, Fair Trading Act advice for the marketplace.
  - **Vietnam:** whether the social features need a **licence or notification under Decree 147/2024** and what applies to livestream and revenue features; the **E-commerce Law (from 1 July 2026)**: platform type, seller verification through VNeID, a legal representative or entity; children's data rules; data hosting (§6.9).
- Vietnam's roadmap includes both (decision X), but they ship there only when this gate passes for Vietnam.

1. **Find a club nearby:**
   - PostGIS radius search, a map (MapLibre with an open tile provider), and a city/postcode fallback when location isn't shared.
   - Filters: **sport**, day, level, price, casual-friendly.
   - Club card → "Book a casual session" / "Request to join".
   - Cheapest to build, and it brings players to clubs, which is the reason for clubs to sign up.
2. **Global leaderboards:**
   - Club points (Wolf Points) depend on how active a club is, so they **aren't comparable between clubs**.
   - Global boards use a **skill rating (Glicko-2)** calculated only from **verified matches**: Arena challenges confirmed by both sides, plus round robin results entered by admins. Dispute handling and anomaly checks already exist in Arena.
   - Views: city, country, world, by age band and gender category.
   - Players opt in per profile.
3. **Social:**
   - Global player profile (opt-in), follow, an activity feed (automatic posts for matches, rank-ups and photos), kudos and comments.
   - Cross-club challenges.
   - **Each club manages its own social space:** its admins moderate their members' posts and enable or disable players.
   - **Safeguarding is platform-wide:**
     - Adults only (juniors have no social access).
     - Report and block on every post and profile.
     - Keyword and image filters (the photo moderation already built).
     - A platform-level review queue for serious reports.
     - Published community rules, and suspension across all clubs for serious breaches.
     - App Store rule 1.2 requires this tooling.
4. **Marketplace** (scope from the research thread, modelled on TradeMe / Facebook Marketplace):
   - **No messaging on the platform.** Buyers ask questions **publicly on the listing**, and the seller answers publicly.
   - When a buyer commits to buy and the seller confirms, a **"Contact seller" / "Contact buyer"** button appears **for those two people only**. It opens their own email app with the other person's address filled in. All further talk happens outside the platform, and the users are responsible for it.
   - **Verified sellers:**
     - Clubs from launch, and later shops, which can also post promoted items and adverts.
     - They carry a verified badge and **can take payment through the platform** (the country's payment provider, §6.5, with a platform fee that sits at 0% while everything is free).
   - **Player-to-player listings are unverified:** no payment through the platform, and a clear "trade at your own risk" notice. The platform takes no responsibility, as on Facebook Marketplace.
   - Listings can be reported. Banned-item rules, sold or expired listings auto-hide, and listing photos go through the same image moderation.

---

## 9. Sequencing and timeline

```
Wk  0–8   Track B  Business foundations: NZ company, legal pack, accounts, trademark, IP audit, cost model (§11.3)
Wk  0–8   Track V  Vietnam discovery with 5–10 clubs (no engineering) (§11.4)
Wk  0–1   Phase 0  Safety net: preview databases, CI gates, restore drill (test plan §2, §6)
Wk  1–3   Phase 1  Tidy Three Wolves (ship)
Wk  3–6   Phase 2  Monorepo, Next 16, Neon+Drizzle, module skeleton, design tokens
Wk  6–11  Phase 3  Multi-tenant core + Three Wolves migration (ship, invisible to members)
Wk 11–14  Phase 3b Junior accounts and safeguarding (§6.8)
Wk 10–14  Phase 4  Player app as SPA on new API (ship as PWA at app.luvallplay.com)
Wk 13–17  Phase 5  Capacitor, native features, compliance, TestFlight / Play testing → store launch
Wk  3–7   Track R  Luvallplay introduction website (EN + VI, "coming soon" + waitlist) on luvallplay.org (§7.4)
Wk 16–20  Phase 6  Platform site in launch mode, club templates, wizard, Admin → Modules (onboard 1–2 pilot clubs)
Wk 20+    Phase 7  Find a club → per-sport leaderboards; social and marketplace only when the gate passes
Wk 14–26  Track I  Integrations for NZ: framework + Xero sync, NZ direct debit, Windcave, Shopify connector, MYOB connector (§12). Needs Phase 3 and live NZ billing
Wk 20–32  Track V  Vietnam launch pack: Hanoi region, VietQR, MoMo, Zalo chat and booking, Vietnamese legal pack (§11.4)
```

**Treat the week numbers as a best case.** They don't include waiting on lawyers, the NZ company, app-store review or Vietnamese counsel. Phase 2 has already found surprises, so **re-baseline the whole schedule after Phase 2 and again after Phase 3** using real progress. Phases overlap where they don't depend on each other. Start the Apple and Google organization accounts and the D-U-N-S number **in week 1**, because approval can take 1–3 weeks.

**Main risks and how they're handled:**

| Risk | Mitigation |
|---|---|
| **Previews share the production database today** (a schema change in a pull request alters production as soon as its preview is opened) | Phase 0: a database branch per preview, and no runtime schema changes ([test plan §2](./luvallplay-test-plan.md)) |
| Live data migration (Phase 3) | Data guard rehearsals on Neon branches (per-person access and data checks), expand/contract, restore points, two-person sign-off ([test plan §4](./luvallplay-test-plan.md)) |
| App Store rejection | Bundled app, native features, demo account, careful review notes; ask App Review for a pre-submission consultation if needed |
| Scope creep in global features | Each global module ships on its own after the platform is live with pilot clubs |
| Tenant data leak | RLS + app-level filters + automated isolation tests on every repo function |
| **Nobody has written down who owns the product or who contracts with clubs** | Track B and the four hard gates before the first outside club (§11.3) |
| **Production lives in personal accounts** (the only Vercel team is a personal one) | Gate 2: move everything into company-owned accounts with two or more owners (§11.3) |
| **A Vietnamese entity can't be the Stripe platform for NZ clubs** | The NZ company holds the Stripe platform account (§6.5, §11.1) |
| **Vietnam's rules** (social licensing, e-commerce law, data law) | Discovery and Vietnamese counsel first, region-aware platform, social and marketplace gated (§6.9, §8, §11.4) |
| **Payments don't fit Vietnam** (no Stripe, wallets with payout delays, VND has no minor unit) | One Payments interface with several providers, VietQR first, minor-unit audit (§6.5) |
| **Hanoi is a second hosting stack** (no Vercel or Neon there) | Portable code (two database drivers, storage, cron), a regional services matrix, a named ops owner, restore drills in Hanoi (§6.9) |
| **MoMo and Zalo rules are unverified** | Read both developer documents and ask both companies in writing before the Vietnam build; VietQR works without MoMo |
| **Platform admins see every club's personal data** | Signed confidentiality and data-handling agreement, logged access, least privilege (§11.1) |
| **Vision revenue and training footage cross Three Wolves and TGS** | Written cutover, committee notice, fresh consent for training footage (§11.2, §11.3 gate 3) |
| **Active Vietnamese competitors** (pickleball and court-booking apps) | Discovery before building; position on club nights and community, not court rental (§11.4) |
| **"Luvallplay" isn't protected anywhere** (Vietnam awards trademarks to whoever files first) | Conflict search, then file in NZ, Australia and Vietnam early (§11.3) |
| **Free forever for NZ badminton can't pay its own way** | Fair-use limits, metering and a cost model (§11.2, §11.3); revenue comes from the paid markets |
| **Xero's developer pricing and certification** (tiers since 2 Mar 2026; certification and an annual security assessment for higher tiers) | The add-on is priced to cover it; start with design partners inside the free Starter tier; certify before growing; budget it in the cost model (§12.3) |
| **Double-posting sales to Xero** (Shopify's own Xero connection and Luvallplay both posting) | Luvallplay doesn't post Shopify sales to Xero by default; a setting makes the choice explicit (§12.5) |
| **Postings rejected by Xero** (lock dates, deleted accounts, rate limits) | Error queue, no deletes in Xero, daily reconciliation report (§12.3) |
| **Direct debit scheme duties** (mandates, notifications, disputes) | Mandate flow and notification emails built to the scheme rules, tested with Stripe's NZ test mode (§12.6) |
| **Shopify's distribution choice can't be changed** | Custom apps for partner clubs first; a public app is a separate, later decision (§12.5) |
| **Schedule is optimistic** | Re-baseline after Phase 2 and Phase 3 |

---

## 10. Decisions (all answered; see the top of this document)

| # | Question | My recommendation |
|---|---|---|
| **A** ✅ | Store app identity: one **Luvallplay** app with clubs inside, a **Three Wolves**-branded app, or both? | One Luvallplay app; Three Wolves shown as the member's club with its own theme |
| **B** ✅ | Launch order: Three Wolves app in the stores ASAP (before multi-tenant), or after the multi-tenant core? | After Phase 3. The bundle ID and listing are permanent, and members already have the PWA meanwhile |
| **C** ✅ | Wolf Vision passes on iOS/Android: in-app purchase (via RevenueCat), free inside the app, or not sold in the app (buy on the web only, no link)? | In-app purchase through RevenueCat for app users, Stripe on the web |
| **D** ✅ | Club website content: built-in editor in Luvallplay Admin, or Sanity for every club? | Built-in editor; Sanity for Luvallplay's own marketing, blog and help |
| **E** ✅ | Business model: club subscription (tiers or per module), % fee on payments, marketplace commission, or a mix? | Free starter tier + paid tiers by module, plus a small application fee on payments |
| **F** ✅ | Brand palette and type in §7.1: approve, or adjust? Do you already own `luvallplay.com`? | Approve as the starting point; I can make a visual preview page |
| **G** ✅ | Marketplace scope: club storefronts only, or player-to-player gear too? | Club storefronts first |
| **H** ✅ | Do clubs have juniors (under 13 / under 16)? | Superseded: junior accounts are built early, guardian-managed (§6.8, decision V) |
| **I** ✅ | Admin emails: which account email do Timba and Kelcee sign in with? Should both also be **Luvallplay platform admins**, or only club owners? | Both Three Wolves owners; platform admin for whoever runs Luvallplay |
| **J** ✅ | Languages: keep en + vi, and add others? | Keep en + vi; the system lets clubs pick more later |
| **K** ✅ | Company: is there a registered company (for D-U-N-S, Apple/Google organization accounts, Stripe platform)? | Register the accounts under that company in week 1 |

---

## 11. Operating model, markets and readiness gates

*Decided on 23 Nov after the plan review ([`luvallplay-plan-review.md`](./luvallplay-plan-review.md)). Items marked **Check** need a lawyer, accountant or other professional, not just this plan.*

### 11.1 Who does what

| Entity | Role |
|---|---|
| **The GOAT Solution (TGS), Vietnam** | Owns the Luvallplay IP and brand. Runs development. Runs the **Vietnam** business: contracts with Vietnamese clubs, Vietnamese payments and tax. Licenses the platform to the NZ company. Holds the Apple and Google developer accounts (decision K). |
| **NZ company, owned by TGS** (e.g. Luvallplay Ltd) | Runs the platform for **NZ and Australia**. Contracts with every club there, including Three Wolves and the free-for-feedback partner clubs. Holds the **Stripe Connect platform account**. Accountable under NZ privacy law. Its **NZ-resident director is Timba** (decision AB; **Check** the Companies Office rules). It has its own NZ bank account, books and accountant, separate from Three Wolves. |
| **Three Wolves** | A club and a licensee, not a party to anyone else's contract. Gets a **free licence** with data-export and exit rights. Its name, logo, wolf artwork and "Wolf" terms stay Three Wolves' own. |
| **Kelcee (President of Three Wolves)** | Unpaid, **no equity or fee** (decision AA). Helps recruit NZ clubs **as a Three Wolves officer**, with the Three Wolves committee's recorded approval (an officer of a not-for-profit promoting a related for-profit's product is a related-party matter, **Check**). **Signs for Three Wolves** on the licence, so Timba isn't on both sides. **Platform admin only after signing a confidentiality and data-handling agreement with the NZ company** (every club's personal data is visible to a platform admin); access is logged and used only for support and partner onboarding. No authority to sign for TGS or the NZ company. |

- **Timba wears three hats** (TGS CEO, NZ company director, Three Wolves Treasurer). To keep that clean:
  - Timba records the interests in the NZ company's interests register and in the Three Wolves committee minutes (**Check** the Companies Act rules on interested directors).
  - Timba takes no part in Three Wolves decisions about the licence, Vision revenue or fees, and signs nothing for Three Wolves.
  - The NZ company has its own bank account, books and accountant, and a named **privacy officer** (**Check** the NZ Privacy Act requirement).
  - **Check** with an accountant: running TGS and the NZ company from NZ can affect where TGS is tax-resident or whether it has a permanent establishment in NZ. **Check** director duties and personal liability, and whether directors-and-officers insurance is worth having.
- **The chain of rights is written down:** anyone who contributed to the existing code assigns their rights to TGS; TGS licenses the NZ company (an intercompany licence, with tax advice on royalties and transfer pricing, **Check**); the NZ company licenses clubs.
- **Conflict of interest:** Timba is TGS's CEO and Three Wolves' Treasurer. The Three Wolves licence is in writing, the committee minutes the declared conflict, and someone other than Timba signs for Three Wolves. If Three Wolves is a registered charity or incorporated society, its own rules on related-party benefit apply (**Check**).
- **Every other club contracts with the NZ company (or TGS in Vietnam), never with Three Wolves**, even when Kelcee recruited them.
- **Money between the parties** has written rules: club money stays with the club; platform features are priced by TGS or the NZ company; Wolf Vision revenue (in-app purchases go to the developer-account holder) and any donations or shop sales are agreed and invoiced between the parties.

### 11.2 Commercial model

- **NZ badminton clubs are free for good.** That is today's partner clubs and Three Wolves, and every NZ badminton club that joins later. The agreement says so, with 90 days' notice for any change.
- **Other sports and other markets pay.** The first paid market is **Vietnam**, then other sports in NZ (through the NZ company). Plans depend on **country and sport** (§6.5), and prices are set **per country in local currency** (VND for Vietnam) after the discovery round.
- **Paid add-ons (decision AK).** The **accounting sync** is a paid add-on for **every** club, NZ badminton included. It's the first thing an NZ badminton club may pay for, so **billing must be real in NZ too** (Stripe Billing through the NZ company, with GST where it applies, **Check**) before the add-on is sold, not only in Vietnam.
- **Paid plans become real before the first paid club.** Billing, invoices (**Check** Vietnam's e-invoice rules), and the country's way of paying TGS (VietQR bank transfer or a local gateway in Vietnam) are built and tested, not just hidden behind a switch.
- **Vision is a platform product, and its revenue goes to TGS** (decision AF).
  - It's renamed **Vision** on the platform (Wolf Vision stays Three Wolves' own term, set in its brand). It's badminton-only for now (§6.7).
  - **Players pay for passes, not clubs.** The free-for-good promise covers club tools, not Vision passes. *(An assumption: tell me if you intended passes to be free for NZ badminton too.)*
  - **Where the money goes:** NZ and Australia web purchases go through the **NZ company's own Stripe account** (a normal account, not Connect), with GST on NZ sales (**Check**), and the NZ company pays TGS under the intercompany licence or a service agreement (**Check** withholding and transfer pricing). In-app purchases pay the developer-account holder, which is TGS. In Vietnam, passes are paid to TGS through MoMo.
  - **Cutover from Three Wolves:** today Three Wolves' Stripe account takes Vision payments (NZ$5 and NZ$2). Pick a cutover date, honour passes already bought, leave revenue to that date with Three Wolves, and tell the Three Wolves committee in writing (it's a related-party arrangement).
  - **Training footage:** footage collected by Three Wolves for club purposes now helps improve a TGS product. That is a change of purpose under privacy law (**Check**), so get fresh, specific consent from the people filmed, or retrain only from consenting sources. The consent wording, retention limits and an opt-out are part of gate 3 (§11.3).
- **Free forever needs guardrails.** The free tier has **fair-use limits** set from the cost model (§11.3 gate 4). Examples: email sign-in codes by default with a monthly SMS cap per club; photo and Vision storage caps; an email-volume cap. Going over a limit shows a warning and a conversation, and **never stops a club running its sessions**.
- **The free-for-feedback partner programme (NZ badminton):**
  - 5 to 10 clubs at first, with a written agreement: feedback and idea licence, confidentiality, testimonial and case-study permission, best-effort support with no uptime promise, and notice before any change.
  - A regular call, in-app feedback, a short survey, a public changelog and roadmap, and usage analytics **with consent**.
  - Clubs join after the setup wizard (Phase 6), per the decision to keep the current order. Recruiting and interviews start now.

### 11.3 Readiness gates (all four before the first outside club)

| Gate | What must be true | Evidence |
|---|---|---|
| **1. Legal pack, reviewed by a lawyer** | NZ company formed. Licence to Three Wolves, club terms, player terms, privacy policy, data-processing terms (the club is the controller, the platform the processor; for global features the platform is a controller too), acceptable-use and safeguarding policies, the partner agreement, marketplace terms (when the marketplace is built). The NZ complaints process under the Harmful Digital Communications Act (48-hour deadlines) and spam-law compliance (consent, sender identity, working unsubscribe). Insurance quotes (cyber and professional indemnity). Three Wolves committee minutes declaring the conflict. | Signed documents and minutes, listed on the release checklist (the documents themselves are not stored in the code repository) |
| **2. Accounts, domains and trademark** | Production moves out of personal accounts. Today the only Vercel team is a personal one. Move **Vercel, Neon, Resend, Sanity, Google Cloud/Firebase, Akahu, Cloudflare, domains and DNS, GitHub and the app stores** into company ownership with **two or more owners**, hardware-key two-factor, a shared password vault and a written break-glass runbook. Three Wolves keeps its own Stripe account; the platform Stripe account belongs to the NZ company. **Domains:** luvallplay.com, .org, .nz and .vn. **Trademark:** a conflict search first (also for app-store names), then filings in NZ, Australia and **Vietnam, which awards marks to whoever files first and can take 18 to 24 months** (**Check** with an IP lawyer). | Account ownership table, domain registrations, trademark search report and filing receipts |
| **3. IP and licence audit** | The **UTM Copperplate fonts** shipped with the site have no licence record (they may be restricted): get a commercial licence or replace them. A licence report for every npm dependency in CI. Ownership of the wolf artwork and rank art. Photo permissions. **Vision:** consent wording, retention limits and an opt-out for footage used to train the shuttle model, and the licence of the model itself. | Audit report, CI licence check, consent text in the app |
| **4. Cost model, metering and limits** | A cost-per-club and cost-per-active-player model: Neon, Vercel, email, SMS (sign-in codes run on Google's free allowance, capped at about 10 texts a day, which a dozen clubs will exceed), storage and image moderation, push, maps, domains, Apple and Google fees, support time. **Usage is metered per club from day one**, and the fair-use limits in §11.2 are set from the model. A platform-admin usage dashboard with alerts. | Model spreadsheet, metering tests, limits table |

**An extra gate before the first paid club in Vietnam:** Vietnamese counsel has reviewed the points in §11.4, the legal pack exists in Vietnamese, and the Vietnamese trademark is filed.

### 11.4 Vietnam

**Launch scope (decision X):**
- **Club tools with VietQR bank transfer:** sessions, sign-ups, memberships; payment by bank transfer with a VietQR code carrying the amount and a payment reference, matched manually or by a bank-feed provider (§6.5).
- **Local online payments through MoMo** (decision AC), each club with its own merchant account; VietQR for everyone else (§6.5).
- **Zalo support: chat and booking (decision AD).**
  - **Chat:** club-to-member messages and notifications through Zalo. **One Luvallplay Official Account (OA)**, verified by TGS, sends them under each club's name. Inbound replies arrive in the club's inbox as threads linked to the member.
  - **Booking:** one **Luvallplay Zalo mini app** with club pages, where members sign up for sessions, join the waitlist, see the calendar and pay by VietQR or MoMo. It's another client of the Phase 4 API, not a second product.
  - **Linking a Zalo user to an account:** by phone-number verification, or by Zalo Login. If Zalo Login is offered in the store app, Apple's rule 4.8 means Sign in with Apple (already planned) must be offered too.
  - **Architecture:** the Messages module gets **channels** (email, push, SMS and Zalo), so a club's announcement goes out on the channels each member chose.
  - *Unverified:* I couldn't read Zalo's developer documentation from the planning environment. Confirm at developers.zalo.me: OA verification requirements, the rules for chat messages (the time window after a member last wrote, limits, which messages cost money), Zalo notification (ZNS) template approval and per-message prices, who may publish a mini app and what review it needs, what Zalo Login returns (for example the phone number), and whether **one OA may serve many organisations**. General sources say an OA is free to create, needs a personal Zalo account and a Vietnamese number, and must be verified.
- **Social and marketplace:** in the Vietnam roadmap, **shipped only when the gate in §8 passes for Vietnam**.
- **Localisation:** Vietnamese-quality copy (not machine-translated), accent-insensitive search, family-name-first names, +84 phone formats, the Asia/Ho_Chi_Minh time zone, **VND with no minor unit**, Vietnamese sport vocabulary, a `.vn` home and Zalo/Facebook share cards (§6.9).

**Discovery (starts now, no engineering):** interview 5 to 10 Vietnamese badminton and pickleball clubs.
- What they use today (Zalo and Facebook groups, spreadsheets, court-booking apps), what hurts, how they collect money, and which payment methods they use.
- Willingness to pay and price points.
- A comparison with the local apps. Vietnam already has several (PickoNow, Padel Hub VN, the national pickleball association's app, ThePickleHub), and most look like **court-rental booking**, not club-night management. Luvallplay's position is club nights, community and ratings, and discovery should confirm that gap exists.
- Results decide the launch scope, the price points, the payment gateway and whether Vietnam is really the right first paid market.

**Hosting:** **Hanoi, on a Vietnamese cloud, run by TGS engineers** (decision AE, §6.9).

**Checks with Vietnamese counsel (all marked Check):**
- **Decree 147/2024 (internet services):** licence or notification thresholds for social networks (one summary cites 10,000 monthly visits for six months or 1,000 regular users a month), obligations for livestream and revenue-generating features, and what applies to foreign providers.
- **E-commerce Law (from 1 July 2026):** whether the shop or marketplace makes Luvallplay a regulated platform, seller identification through VNeID, and a legal representative or entity.
- **Personal data law and Decree 356/2025 (from 1 Jan 2026):** consent, the data-transfer assessment filed within 60 days of processing or transfer, penalties for cross-border transfer violations (one source says up to 5% of revenue), children's data, and where the Vietnam region is hosted (§6.9).
- **Payment intermediary rules (Decree 52/2024):** confirm that each club using its own MoMo merchant account keeps Luvallplay outside the licensing rules, and what applies to TGS collecting its own fees.
- **E-invoices and tax** for fees TGS charges and for clubs that sell to members; **advertising and sports-event rules**; **trademark** (§11.3).

### 11.5 Support, operations and security (before commercial launch)

- **Support:** a help centre (English and Vietnamese), a support inbox with a named owner and response targets, a status page, an incident process with a written template, and a clear "best effort, no SLA" statement for partner clubs.
- **Club offboarding, export and restore:** a club can export all its data, can leave or close (with defined retention and deletion), and a **single club can be restored** without rolling back everyone (tenant-scoped export and restore tooling). Both directions of exit for Three Wolves are written down: if the platform stopped, Three Wolves keeps its data and a way to keep running.
- **Release rings:** an internal test club first, then partner clubs, then everyone; per-club feature flags; a changelog; a deprecation policy for the API and webhooks. Three Wolves is no longer also the test bed.
- **Platform console:** support "view as admin" only with consent and an audit trail, a club health dashboard, per-club rate limits, and suspending a club for abuse.
- **Email:** each club can send from its own domain (DKIM and SPF), with bounce and complaint handling so one club can't damage everyone's deliverability.
- **Club verification and anti-impersonation:** reserved names (federations, "Badminton NZ"), criteria for the verified badge (for example an incorporated society number or federation approval), and a takedown route.
- **Trust and safety operations:** who reviews reports and when, escalation contacts, and the 48-hour process in NZ.
- **Security posture for selling to associations:** a security page, a vulnerability disclosure policy, an external penetration test before multi-club launch, a dependency and licence inventory, and later a SOC 2-style programme.
- **People risk:** production accounts, credentials and recovery are never held by one person (gate 2). Runbooks are written so a non-engineer can confirm the data-guard checks.

### 11.6 Success measures and decision gates

- **Measure from the first partner club:** active clubs; weekly active players per club; sessions run through the app; 30- and 90-day retention; the "very disappointed if it went away" score from a short survey; cost per club (§11.3 gate 4); support load per club.
- **Decision gates (thresholds are proposals to confirm after the first partner period):**
  - **A: open to all NZ badminton clubs.** 5 partner clubs active for 8 weeks, with a majority "very disappointed if gone".
  - **B: go or no-go on Vietnam as the first paid market.** After the discovery round (§11.4).
  - **C: social and marketplace** (§8).
  - **D: first paid price.** Tested with Vietnamese discovery clubs and the first paid pilots.

---

## 12. Integrations: industry-standard and NZ-ready

*Decisions AG to AK (24 Nov). Research is summarised in [`luvallplay-plan-review.md`](./luvallplay-plan-review.md); anything marked **Check** or **unverified** needs the provider's current documentation or a professional before building.*

### 12.1 One integration framework, many connectors

Every connector (Xero, MYOB, Shopify, Windcave and later ones) is built on the same framework, so adding one is a module, not a rewrite:

- **Connections:**
  - Each club authorises its own account by OAuth 2.0. Only owners and admins can connect, with a fresh sign-in code (step-up).
  - Tokens are **encrypted per club** (envelope encryption, keys in a secret manager), never logged, and shown to nobody.
  - A health screen shows connected, expiring, revoked or error, and a **Reconnect** button.
  - **Disconnect** revokes the token at the provider, deletes ours, and writes the audit log.
  - Xero's refresh tokens rotate, so the new token is stored atomically before the old one is dropped; expiry and rotation rules are **unverified**, so confirm them in Xero's documentation.
- **Sync engine:**
  - An **outbox**: every business event (payment, refund, order, donation) becomes a job.
  - Jobs are **idempotent** (a mapping table records which Luvallplay item became which external item), retried with backoff, respect each provider's per-club rate limits, and land in a dead-letter queue with a replay button.
  - **Nothing is ever deleted in a club's accounting system**: a void or credit note is posted instead.
  - If an item is changed in the external system after it synced, Luvallplay **flags** it and never overwrites it.
  - A daily **reconciliation report** compares Luvallplay's totals with the external ones.
- **Tables:** `integration_connections`, `integration_mappings`, `integration_sync_log` and `integration_usage` (all `tenant_id`, with RLS and the isolation tests of test plan §3.5).
- **Modules and money:** each connector is a module (§6.2.3) with its own entitlement (included or add-on, §12.9). Calls, egress and connection counts are **metered per club** (readiness gate 4, §11.3), because providers charge by usage.
- **Privacy:** a connector sends only what's needed (contact name and email, amounts, references). Providers are listed in the data-processing terms. **Xero's developer terms prohibit using its API data for AI or machine-learning training** (as reported; **Check**), and nothing in Luvallplay does.
- **Regions:** NZ and Australian connectors run in the **Sydney region only**. Vietnam's equivalents (e-invoice providers and local accounting software) are designed after the Vietnamese discovery round (§11.4).
- **Testing against sandboxes** (test plan §3.19): a Xero demo company, a Shopify development store, Stripe test mode and Windcave's test environment, plus recorded-response tests for failure cases.

### 12.2 NZ catalogue and priority

| Priority | Integration | Why | Status |
|---|---|---|---|
| **Ready for the first paid NZ club** (decision AJ) | **Xero accounting sync** | Xero is NZ's dominant small-business accounting tool (one blog says about 70%, unsourced), and NZ club software such as Hello Club pushes payments, invoices and credit notes into it | Paid add-on (§12.3) |
| | **NZ direct debit for memberships** (Stripe BECS) | Cheaper than cards and automatic renewals | Base plan (§12.6) |
| | **Windcave gateway** | A second NZ card gateway for clubs and councils that already use it | Base plan (§12.6) |
| | **MYOB connector** | NZ's other main accounting package | Add-on (§12.4) |
| | **Shopify connector** | Many clubs already sell merchandise there | Base plan (§12.5) |
| | **Cards, Apple Pay, Google Pay** (Stripe) | Digital wallets are now NZ's leading online payment method (a July 2026 payments report), so wallets must be on | Exists; confirm wallets are enabled on NZ accounts (**Check**) |
| | **Akahu bank matching, Google Calendar, public API and webhooks** | Already built | Exists |
| **Within about six months of NZ launch** | Pay by bank (open banking payments) | Account-to-account payments are emerging; the banks' obligations under the Customer and Product Data Act are being phased in over 2026 and 2027, and some deadlines may move (**Check** MBIE) | Not required for launch |
| | Mailchimp | Hello Club lists it; clubs already have lists | Later |
| | Zapier and Make | Through the existing public API and webhooks | Documented, not built |
| | Microsoft 365 calendar | For clubs not on Google | Later |
| | QuickBooks Online connector | A third accounting package | Later |
| | A POS for tuck shop and door sales (for example Square) | Not researched | Later, **Check** demand |
| **When selling to associations and councils** | **Peppol e-invoicing** | New Zealand's e-invoicing is voluntary for business to business, with a mandate for large suppliers to government planned from 1 January 2027 (sources differ on earlier dates; **Check** MBIE and Inland Revenue) | Later |

### 12.3 Xero accounting sync (the paid add-on)

**Direction and scope (decision AI).** Luvallplay is the source of truth for transactions; Xero is the source of truth for the chart of accounts.

- **Pushed to Xero:**
  - Members and payers as **contacts**, matched by email.
  - Memberships, casual bookings, shop orders and donations as **sales invoices**, with the payment applied to the invoice.
  - **Refunds as credit notes.**
  - **Card fees as expense lines.**
  - **Expenses** from Finance (money spent, with the receipt attached).
- **Pulled from Xero:** the chart of accounts, tax rates, tracking categories and bank accounts, for the mapping screen.
- **Not pushed:** bank transactions. Xero's own bank feed (and Luvallplay's Akahu matching) handle the bank, so the same money isn't reconciled twice.

**The standard design for card payments** (used by Stripe's own Xero guidance and by settlement connectors such as A2X):
- Payments post to a **clearing account** at full value, fees go to a fee expense account, and each **payout is posted as one settlement** whose net equals the single bank line, so Xero reconciles it in one click.
- The clearing account should net to zero each cycle. A leftover balance points to a missing fee, refund or timing item, and the daily report flags it.
- Payouts are **transfers**, never income, to avoid double-counting.
- Auto-reconciliation by charge ID needs an automatic payout schedule and **one payment account per Xero organisation** (as Stripe documents; **Check**).
- Cash and bank-transfer payments post straight to the bank or deposit account, so the matching bank-feed line reconciles to them.

**Mapping and controls**
- A setup screen maps each Luvallplay income type to a Xero account, tax rate and tracking category, with sensible defaults per NZ club type. Defaults are suggestions the club's accountant can change.
- A **sync start date** (history isn't pushed unless the club chooses a start date), a **dry-run preview**, and a per-item "resync".
- **Xero lock dates** are respected: a posting before the lock date is queued with a clear alert, never forced.
- Failures show a plain-language fix ("this account was archived in Xero") in the error queue.

**NZ specifics (Check each with an accountant)**
- **GST at 15%**, with an option for clubs that aren't GST-registered, and the information Inland Revenue requires on taxable supplies (supplier, date, description, amount, GST; the exact requirements depend on the amount).
- **Donation receipts** for clubs that are donee organisations, and treatment of donations as outside GST.
- The existing finance categories and AGM report map onto Xero accounts and tracking categories so a club's reports match in both places.

**Xero's commercial terms (unverified, from third-party summaries; read Xero's developer pricing and certification pages):**
- Since **2 March 2026** developers pay by **tier** (Starter, Core, Plus, Advanced, Enterprise) based on connected organisations and data pulled out. One source gives Starter as free to about 5 connections, Core about €20 a month to 50, Plus about €140 to 1,000, and Advanced about €820 to 10,000.
- **App certification and an annual security assessment** are needed for the paid tiers, and apps reaching 1,000 connections need an advanced assessment. Sources disagree on the limits for uncertified apps (25 connections per app, or a cap on uncertified apps per organisation) and on how many active connections are needed to apply (10 in the newer source).
- New apps use **granular scopes**. The Journals endpoint is reported as restricted to the Advanced tier, so the design avoids it and uses invoices, payments, bank transactions and credit notes.
- **Plan:** launch with design partners inside the free Starter tier, apply for certification when connections approach the limit, align the security work with the §11.5 security programme, and set the add-on price from the cost model.

### 12.4 MYOB (and later QuickBooks)

The sync is written against an **`AccountingProvider` interface** (contacts, invoices, payments, credit notes, spend money, accounts, tax rates, tracking, attachments). Xero is the first implementation and **MYOB the second** (decision AJ); QuickBooks Online is third. MYOB's NZ API, authentication and limits are **unverified**, so a short spike confirms them before the build. The mapping screen, sync engine, reconciliation report and cost metering are shared. MYOB is a paid add-on on the same terms as Xero (assumption, §12.9).

### 12.5 Shopify connector (decision AH)

- **Model:** the club connects **its own Shopify store**. Luvallplay shows the club's products in the Shop tab and the app's Shop screen (read through Shopify's APIs), and the buy button opens **Shopify's checkout**.
  - Shopify's payments, including Shop Pay, only work inside a Shopify checkout, so Luvallplay never tries to run them itself. NZ businesses can use Shopify Payments for cards, Apple Pay, Google Pay and Shop Pay (per Shopify's NZ help page). Shopify POS Tap to Pay is **not** available in NZ.
  - Order, payment and refund **webhooks** come back and appear in Admin → Shop as read-only orders, and trigger the club's notifications. Stock stays in Shopify.
- **Distribution:** Shopify makes you choose between a **custom app** (installed on one store through a link, no review, no Shopify billing) and a **public app** (App Store listing, review, billing), and **the choice can't be changed afterwards**. Start with a custom app per partner club. Build a public app as a separate, later decision once many clubs use Shopify. From 20 Nov 2026 a custom app needs an **IP allowlist** before installing on a store outside your own organisation (as reported; **Check**).
- **Unverified:** the exact Admin and Storefront API surface Luvallplay needs, the privacy and compliance webhooks Shopify requires of public apps, and app-review requirements. Read Shopify's current developer documentation before the build.
- **Avoid double accounting:** clubs on Shopify usually already send sales to Xero through a Shopify connector. When the Shopify connector is on, **Luvallplay does not post those sales to Xero by default**; a setting lets a club choose to post summaries instead.
- **The native Luvallplay shop** (pre-orders, cash on collection, the jersey flow) stays for clubs without Shopify.

### 12.6 NZ payment methods

- **Wallets and cards (Stripe):** Apple Pay and Google Pay on the Payment Element, enabled for NZ accounts (**Check**).
- **NZ direct debit for memberships (Stripe BECS, decision AJ).**
  - Members sign a **Direct Debit Authority** and are debited automatically. It works with Stripe Subscriptions and in NZD only.
  - **Scheme duties:** the club notifies the member by email within 5 days of the authority and on the day of each debit (as Stripe documents; **Check**); debits are **delayed** (several business days to settle); and the bank-account holder has a dispute process.
  - So Luvallplay builds the authority screen with the scheme wording, stores the authority record, sends the notification emails in English and Vietnamese, handles failed and disputed debits (retry, alert, member message), and shows "pending" until funds arrive.
- **Windcave (decision AJ).** A second provider behind the Payments interface (§6.5), connected with the club's own Windcave merchant account (Windcave was formerly Payment Express and offers card and account-to-account products). Its API, onboarding and fees are **unverified**; a short spike precedes the build. Luvallplay still never holds club money.
- **Pay by bank (open banking payments).** Not required for launch. Watch MBIE's open banking rollout and Akahu's accredited-requestor status (Akahu is on MBIE's register), and revisit when major banks' obligations are in force.
- **Not planned:** buy-now-pay-later, and legacy online EFTPOS or POLi-style redirects.
- **PCI:** payment details go only through the provider's hosted fields or checkout, so Luvallplay stays at the lightest PCI level (**Check** each provider's rules).

### 12.7 Evidence and caveats

- Found: Xero is NZ's dominant package (market-share figures are unsourced); Hello Club's Xero app pushes payments, invoices and credit notes to Xero and pulls accounts; Stripe documents NZ BECS direct debit with Subscriptions; Shopify documents Shopify Payments in NZ and the custom-versus-public app choice; Xero's pricing and certification pages describe tiers, assessment and granular scopes; Inland Revenue and e-invoicing pages cover taxable supply information and Peppol.
- **Not found or unverified:** Xero refresh-token and rate-limit specifics, MYOB's NZ API, Windcave's API and fees, Shopify's compliance webhooks and API surface, whether Apple Pay and Google Pay are enabled by default on NZ Stripe accounts, donee-organisation receipt rules, and the final dates of NZ open banking and e-invoicing milestones.

### 12.8 NZ compliance checklist for selling the add-ons

GST rules for the add-on's own invoices (the NZ company); taxable-supply information on club invoices; donation receipts (**Check**); Privacy Act terms for connectors (processor role, §11.1); direct-debit scheme duties; Consumer Guarantees Act for shop sales; and a written statement of what each connector reads and writes, shown on its connect screen.

### 12.9 Pricing and entitlements

- **The accounting sync is a paid add-on** (decision AK), implemented as an **add-on plan kind** in the entitlements (`plans` and `club_plans`, §6.5), switched by billing.
- **Assumptions to confirm:**
  - MYOB, as an accounting connector, is a paid add-on on the same terms.
  - The **Shopify connector, direct debit and Windcave are included in the base plans** (Shopify has no per-connection fee like Xero's, but the build still costs money).
  - **Three Wolves gets add-ons free under its licence.** (Three Wolves is a club on a free licence, so this needs writing into the licence.)
- **Price:** not set. It covers Xero's developer tier, certification, support and margin, from the cost model (§11.3 gate 4) and a price test with design partners (§11.6 gate D). Billing runs through Stripe Billing via the NZ company, with GST where it applies.

### 12.10 Phasing

1. **After Phase 3 and live NZ billing:** the integration framework, then the Xero sync (read accounts, push contacts, invoices, payments, fees, refunds, expenses), then NZ direct debit.
2. **Then:** the Windcave provider, the Shopify connector, the MYOB connector.
3. **Later (§12.2):** pay by bank, Mailchimp, Microsoft 365, QuickBooks, a POS, Peppol.

Rough best-case build effort, to be re-baselined after Phase 3: framework and Xero 5 to 7 weeks, direct debit 2 to 3, Windcave 3 to 4, Shopify 3 to 4, MYOB 3 to 4. They share the framework, so later connectors are faster. Track I (§9) can run beside Phase 4 and 5.

