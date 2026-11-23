# Build plan: from Three Wolves to Luvallplay

Status: **draft for review** (22 Nov 2026). Items marked **🟡 Decision** need your answer before that phase starts. Each has my recommendation, so you can just say "go with the recommendation".

**Decided (22 Nov):**
- **A:** one **Luvallplay** store app, with Three Wolves as a club inside it (its own theme and terms).
- **B:** store launch **after** the multi-tenant core (Phase 3). Members use the PWA until then.
- **C:** Wolf Vision passes are sold by **in-app purchase** (RevenueCat) in the store apps, and by Stripe on the web.
- **D:** club website content lives in a **built-in editor** in Luvallplay Admin. Sanity is kept for Luvallplay's own marketing, blog and help content.

**Decided (23 Nov):**
- **E:** **free for every club for now**, with paid plans built in but switched off (§6.5).
- **F:** the brand is **Luvallplay**. The domain to buy is **luvallplay.org** (not luvplayall.org), ideally with luvallplay.com and luvallplay.nz. The brand concept is in §7.1.
- **G:** the marketplace has **both club/shop storefronts and player-to-player listings**, with the scope set in the research thread (§8).
- **H:** **no under-16s.** The platform is 16+, with an age confirmation at sign-up.
- **I:** **Timba and Kelcee are both Three Wolves owners and Luvallplay platform admins.** Owners can add and remove admins from the admin pages (§2.4).
- **J:** English and Vietnamese only for now.
- **K:** everything (developer accounts, D-U-N-S, the Stripe platform account) is registered under **The GOAT Solution**.

**Testing:** every phase passes the gates in [`luvallplay-test-plan.md`](./luvallplay-test-plan.md) before production. The data guard that proves no one lost access or data is already built (`scripts/data-guard/`).

> **Luvallplay:** "Love all, play" is the umpire's call that starts every badminton match. It's a great name for a badminton platform, and the brand below leans into it.

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
| 7 | **Global modules** | Find a club nearby, then global leaderboards, social, then marketplace. Each module is opt-in per club | 3–5 wks each |

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
    - Tests: every scheme passes the plan's contrast floors (text on fills ≥ 4.5:1 in both modes, primary as text on the light ground ≥ 4.5:1, fills against the dark ground ≥ 3:1), and the brand's own pairs pass in both themes.
    - **Open question for the theming work:** the schemes' dark-mode primaries are checked against a dark ground of `#0e1419`, but the brand system's dark surfaces are `#0b1b2b` / `#12263a`. Against those, most dark primaries come out at 2.5–2.97:1, just under the 3:1 floor for a fill's edge (text on the fills is fine). Court Green's dark primary also differs: `#187156` in the schemes, `#157a5a` in the brand system. One of the two needs adjusting before the wizard ships.
  - `packages/modules` (`@luvallplay/modules`): `defineModule()` with the §6.2 manifest, extended for §6.2.1 and §6.2.3.
    - Fields: `core`; `requires` and `recommends`; `payments: "none" | "optional" | "required"` with optional `paymentModes` (Card payments: online only); `availability` (available, beta or hidden); `liveActivity` (what needs a confirmation before switching off); and everything it owns: admin nav and pages, app tabs/cards/routes, site sections/routes, API routes, crons, emails and webhook events.
    - The registry: the core (Home, Play days, People & roles, Messages & announcements, Website, Settings) plus 16 optional modules for what Three Wolves runs today. Setup check and Platform staff are listed as platform-console pages, not club modules. Three Wolves: online payments, every module on.
    - `canTurnOn` / `canTurnOff` are pure rules ready for Settings → Modules and the platform console: the core never switches; payment modes; requirements first; dependents block; locks (owners can't, platform admins can); availability and beta. Nothing reads the registry at runtime yet.
    - Tests tie the registry to the real app: every admin menu page, every cron in `vercel.json` and every webhook event belongs to exactly one module (or the platform console), and every route and page a module names exists.
    - Finding: the `membership.changed` webhook event is declared but nothing emits it yet.
  - **Plan change:** modules are one package with the registry for now, not one package per module (§3.1). Each module's server, app, admin and site code moves into it as Phase 3 builds the API, so code doesn't move twice.
  - Packages import nothing from Next, React, the database or the app (a test enforces it); CI typechecks them on their own.
- **PR 5, Next.js 16** (16.4.6, Turbopack builds):
  - `middleware.ts` is now `proxy.ts` (`export function proxy`), on the Node runtime, which is fixed in 16, so the `runtime` setting is gone.
  - `revalidateTag(tag)` is now `revalidateTag(tag, { expire: 0 })`. That keeps today's behaviour (the next request reads fresh data), not the stale-while-revalidate `"max"` profile.
  - ESLint uses `eslint-config-next` 16's own flat config. Its five new React Compiler rules (`react-hooks/set-state-in-effect`, `refs`, `immutability`, `purity`, `static-components`) flag about 74 existing spots that work today. They're **warnings for now**. **Follow-up:** fix them before turning on the React Compiler.
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
| Age rating | **16+**, matching the platform rule (no under-16s): age confirmation at sign-up, in the terms, and in the store age rating. The questionnaire answers cover user content, the marketplace and social features |

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
| **Admin** | Grouped sidebar: **Club** (dashboard, settings, modules, website) · **People** (members, players, roles, inbox) · **Play** (play days, attendance, round robin, challenges, day requests) · **Money** (financials, bank, shop, payouts) · **Content** (photos, gallery). Shared `DataTable` (sort, filter, export, becomes cards on mobile), dashboard home ("needs attention": unread messages, photos to review, disputes, failed payments) |
| **Sanity** | Business config removed (pricing plans, `stripePriceId`, casual spots and booking lock days move to the database and Admin). Studio holds Luvallplay content only: marketing pages, blog, help centre, release notes. Three Wolves content migrates into the club website editor (🟡 Decision D) |
| **Code** | Runtime DDL → migrations; email links → `user_id` foreign keys; constants → club/module settings; "Three Wolves" strings → club config; `hasDb` checks removed (a database is required); error boundaries per route; zod validation at every API edge |
| **Tests** | Unit (core logic), integration (repos against a Neon branch), **tenant isolation** (every repo function is tested to make sure club A can't read club B), Playwright end-to-end for sign-in, booking, membership, challenge and admin flows |

---

## 6. Phase 3: multi-tenant core (request 5)

### 6.1 Data model

**Approach: one shared database, a `tenant_id` column on every club-owned table, and Postgres row-level security (RLS) as a safety net.** This is the standard model for SaaS at this scale. It's cheap, runs one migration for everyone, and makes cross-club ("global") features easy. A database per club would make global leaderboards and the marketplace painful.

```
tenants            id, slug, name, status, country, timezone, currency, languages[], location (PostGIS point),
                   theme jsonb, terms jsonb (e.g. points_name: "Wolf Points"), custom_domain, created_at
tenant_modules     tenant_id, module_id, enabled, settings jsonb, enabled_at        ← what the wizard writes
users              id, email, phone, first/last/display name, avatar, lang, ...      ← global identity (today's players)
club_members       tenant_id, user_id, role (owner|admin|coach|member|guest), status, joined_at,
                   leaderboard_visible, global_profile_visible
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
| Core (always on) | Club profile & website · Members & roles · Messages (inbox) · Admin | |
| Run your club | **Play days & bookings** (incl. calendar sync) · **Casual play** (drop-in, guest checkout) · **Day requests** · **Round robin / mini games** | Courts, capacity and cut-offs become settings |
| Money | **Memberships** (plans, cycles, days) · **Shop & merch** (jersey pre-orders become a shop product type) · **Donations** · **Finance & reports** · **Bank reconciliation (NZ, Akahu)** | All need Payments (Stripe Connect) |
| Engage players | **Arena** (challenges, ranks, club leaderboard) · **Vision** (AI match analysis) · **Gallery & photos** · **Integrations** (API, webhooks, MCP) | Ranks and art are themeable per club |
| Global (opt-in) | **Find a club** · **Global leaderboards** · **Social** · **Marketplace** | §8 |

**Settings replacing constants:**
- `MEMBERSHIP_ACCESS_DAYS` → `memberships.settings.days`
- `COURTS_TO_MAX_PLAYERS` → `play-days.settings.courts`
- Prices → plans in the database, linked to Stripe Prices on the club's connected account
- `Pacific/Auckland` → `tenants.timezone`
- "Wolf Points" / "Wolf Vision" → `tenants.terms`

### 6.3 Whitelabel and the Three Wolves exception

- Every club gets the **Luvallplay default theme** and generic terms ("Luv Points", "Vision", generic rank art).
- A club **theme** has: logo, colours (primary/accent, generated into an accessible palette), fonts (from a curated list), rank-art set, and terms.
- **Three Wolves keeps everything already built for it:** the wolf rank art, "Wolf Points", "Wolf Vision", Copperplate fonts and the navy palette. These are stored as *its* theme and terms, not as code.
- Theming works through CSS custom properties set per club. The same components render differently with no per-club code.

### 6.4 Domains and routing

| Host | Serves |
|---|---|
| `luvallplay.com` | Platform marketing, **Find a club**, "Start your club" wizard, help, legal |
| `app.luvallplay.com` | Player app (PWA). Same bundle as the store apps |
| `admin.luvallplay.com/{club}` | Club admin (one cookie domain, so the account sign-in just works) |
| `api.luvallplay.com` | API for app, integrations and MCP |
| `{club}.luvallplay.com` or **custom domain** (e.g. `threewolvesbadminton.org`) | Club landing page |

- `proxy.ts` resolves the club from the host name, using a cached lookup in Edge Config, and rewrites to `/_sites/[club]/…`.
- Custom domains are added through the Vercel Domains API, with automatic SSL.
- Club pages are statically generated and revalidated with a `tenant:{id}` tag.

### 6.5 Payments: Stripe Connect

- Each club is a **connected account** created with **Accounts v2** (Stripe's recommended path for new Connect integrations). Charges are **direct charges**, so the club is the merchant of record and pays its own Stripe fees and refunds. Luvallplay optionally takes an **application fee**.
- **Three Wolves' existing Stripe account is connected rather than recreated**, so live subscriptions, customers and payouts stay where they are.
- **Business model: free for now, paid plans ready but hidden.**
  - Tables `plans` and `club_plans`, plus an **entitlements** check that every module calls (`can(club, "module.feature")`).
  - Every module's manifest declares the plan it belongs to. Today **every module is on the Free plan**, and `BILLING_ENABLED=false` hides prices, the upgrade screens and billing pages.
  - Stripe Billing for club subscriptions is integrated and tested in test mode but dormant.
  - The Connect application fee is configurable and set to **0%**.
  - Turning on paid plans later is a settings change plus a pricing page, not a rebuild. Paid plans are only ever sold on the web, never inside the iOS/Android app.
- **Operator:** the platform is run by **The GOAT Solution**, with Three Wolves using it under a contracted free-use agreement (from the research thread). Each club owns its data. Because Timba is both CEO of The GOAT Solution and Treasurer of Three Wolves:
  - Put the agreement in writing.
  - Declare the conflict of interest to the Three Wolves committee.
  - Have Timba step out of committee decisions that involve The GOAT Solution.

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

---

## 7. Phase 6: brand, websites and the setup wizard

### 7.1 Luvallplay brand

Name: **Luvallplay**. Domain to buy: **luvallplay.org** (+ .com, .nz). The brand lives in the **Luvallplay brand** design system: https://claude.ai/artifact/7do36zHNvLp3pFdNUC7euj (logo files, app icon, colour and type tokens, voice and usage rules). It's private until you share it.

- **Mark:** a shuttlecock that is also a heart. The cork is the heart's tip, and three feather spines plus the binding band fan into the lobes. "Luv" + badminton in one shape that still reads at 16px.
- **Wordmark:** custom lowercase **luvallplay** in round-ended single strokes, matching the app's line icons.
- **App icon:** a Smash Lime heart-shuttle on a full-bleed Court Green square.

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

All palettes are validated for WCAG AA in light and dark. Club colours are auto-adjusted to meet contrast.

### 7.2 Setup wizard ("Start your club", about 5 minutes)

```
① Sign in (code)  →  ② Your club  →  ③ Pick modules  →  ④ Go global?  →  ⑤ Payments  →  ⑥ Invite & import  →  ⑦ Launch
```

| Step | Content | Best practice applied |
|---|---|---|
| ② Your club | Name, URL slug (live availability check), city/venue (map pin, used by Find a club), logo upload (colours extracted automatically), languages | Autosave every field; live preview of the club page on the right (desktop) or a "Preview" toggle (mobile) |
| ③ Pick modules | Starter **presets**: *Social club*, *Competitive club*, *Coaching academy*. Then grouped cards (Run your club · Money · Engage players) with on/off toggles | Dependencies selected automatically with a note ("Memberships needs Play days"); 3–4 sensible defaults pre-selected; never more than one decision per card |
| ④ Go global? | Four plain toggles: list in **Find a club** · players can appear on **global leaderboards** · **social** · **marketplace**, each with a one-line privacy explanation | Opt-in, off by default except the directory listing; changeable any time |
| ⑤ Payments | Stripe Connect onboarding (hosted), or **Skip — cash/bank transfer only for now** | Optional; the club can launch without it |
| ⑥ Invite & import | Invite co-admins by email; import members from CSV or a spreadsheet paste | Skippable |
| ⑦ Launch | Checklist summary, club link, QR poster for the hall, "Get the app" link | Celebrate; next-step suggestions |

- A progress bar and Back / Next on every step.
- Everything after step ② is skippable.
- Every choice can be changed later in **Admin → Modules**, which reuses the wizard's step ③ and ④ components.

### 7.3 Club landing pages

- Built from `packages/site-templates` sections fed by club settings, plus content from the built-in **Website editor** in Admin: text, photos, FAQ and reviews, with live preview.
- Two or three templates to start: *Classic*, *Bold*, *Minimal*.
- The site's job is to explain the club, show the schedule, prices and gallery, and turn visitors into players through **Join in the app** and **Book a casual session**.

---

## 8. Phase 7: global modules (opt-in per club)

Build them in this order, each one releasable on its own:

1. **Find a club nearby:**
   - PostGIS radius search, a map (MapLibre with an open tile provider), and a city/postcode fallback when location isn't shared.
   - Filters: day, level, price, casual-friendly.
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
     - 16+ only.
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
     - They carry a verified badge and **can take payment through the platform** (Stripe Connect, with a platform fee that sits at 0% while everything is free).
   - **Player-to-player listings are unverified:** no payment through the platform, and a clear "trade at your own risk" notice. The platform takes no responsibility, as on Facebook Marketplace.
   - Listings can be reported. Banned-item rules, sold or expired listings auto-hide, and listing photos go through the same image moderation.

---

## 9. Sequencing and timeline

```
Wk  0–1   Phase 0  Safety net: preview databases, CI gates, restore drill (test plan §2, §6)
Wk  1–3   Phase 1  Tidy Three Wolves (ship)
Wk  3–6   Phase 2  Monorepo, Next 16, Neon+Drizzle, module skeleton, design tokens
Wk  6–11  Phase 3  Multi-tenant core + Three Wolves migration (ship, invisible to members)
Wk 10–14  Phase 4  Player app as SPA on new API (ship as PWA at app.luvallplay.com)
Wk 13–17  Phase 5  Capacitor, native features, compliance, TestFlight / Play testing → store launch
Wk 16–20  Phase 6  Brand, platform site, club templates, wizard, Admin → Modules (onboard 1–2 pilot clubs)
Wk 20+    Phase 7  Find a club → Global leaderboards → Social → Marketplace
```

Phases overlap where they don't depend on each other. Start the Apple and Google organization accounts and the D-U-N-S number **in week 1**, because approval can take 1–3 weeks.

**Main risks and how they're handled:**

| Risk | Mitigation |
|---|---|
| **Previews share the production database today** (a schema change in a pull request alters production as soon as its preview is opened) | Phase 0: a database branch per preview, and no runtime schema changes ([test plan §2](./luvallplay-test-plan.md)) |
| Live data migration (Phase 3) | Data guard rehearsals on Neon branches (per-person access and data checks), expand/contract, restore points, two-person sign-off ([test plan §4](./luvallplay-test-plan.md)) |
| App Store rejection | Bundled app, native features, demo account, careful review notes; ask App Review for a pre-submission consultation if needed |
| Scope creep in global features | Each global module ships on its own after the platform is live with pilot clubs |
| Tenant data leak | RLS + app-level filters + automated isolation tests on every repo function |

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
| **H** ✅ | Do clubs have juniors (under 13 / under 16)? This affects age rating, social features and consent | Social features 16+ only; juniors managed through a parent's account |
| **I** ✅ | Admin emails: which account email do Timba and Kelcee sign in with? Should both also be **Luvallplay platform admins**, or only club owners? | Both Three Wolves owners; platform admin for whoever runs Luvallplay |
| **J** ✅ | Languages: keep en + vi, and add others? | Keep en + vi; the system lets clubs pick more later |
| **K** ✅ | Company: is there a registered company (for D-U-N-S, Apple/Google organization accounts, Stripe platform)? | Register the accounts under that company in week 1 |
