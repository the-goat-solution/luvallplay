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

**Added (23 Nov):**
- **L: free-play clubs.** Some clubs charge nothing at all. Every club picks a **payment mode**: *Free play* (no payments anywhere, no Stripe), *Cash or bank transfer*, or *Online payments*. A free-play club gets the full product without a single price on screen (§6.2.1).
- **M: 12 ready-made colour schemes** for new clubs, each tested for contrast in light and dark mode (§6.3.1, preview in `docs/plans/assets/club-color-schemes.png`).
- **N: bring your own brand.** Clubs can import their own logo, font and colour palette, or pull them from their existing website (§6.3.2).
- **O: online payments only for incorporated clubs with their own Stripe account.** Setup asks both questions; every other paying club is set up for cash and bank transfer only, with an admin area built for that (§6.2.2). Three Wolves never collects or passes on money for other clubs (Stripe forbids it, and it would make the collector a regulated money-transfer business under NZ's AML/CFT Act).

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
                   payment_mode (free | offline | online), incorporated (yes | no | unsure),
                   stripe_status (none | connecting | connected), bank_details jsonb, theme jsonb (preset id or imported brand),
                   terms jsonb (e.g. points_name: "Wolf Points"), custom_domain, created_at
club_brand_assets  tenant_id, kind (logo | logo_dark | font_display | font_text), file, checked_at, licence_confirmed_by
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
| Money | **Memberships** (plans, cycles, days; a plan can be free) · **Shop & merch** (jersey pre-orders become a shop product type) · **Donations** · **Finance & reports** · **Bank reconciliation (NZ, Akahu)** | All optional. Card payments need Stripe Connect; cash and bank transfer don't. A free-play club leaves the whole group off (§6.2.1) |
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
| **Midnight Rally** | `#1E3A8A` | `#FBBF24` | Deep navy under hall lights, gold smash |
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
- Neutrals (backgrounds, text, borders) are shared across schemes, so every scheme stays readable.
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
| `luvallplay.com` | Platform marketing, **Find a club**, "Start your club" wizard, help, legal |
| `app.luvallplay.com` | Player app (PWA). Same bundle as the store apps |
| `admin.luvallplay.com/{club}` | Club admin (one cookie domain, so the account sign-in just works) |
| `api.luvallplay.com` | API for app, integrations and MCP |
| `{club}.luvallplay.com` or **custom domain** (e.g. `threewolvesbadminton.org`) | Club landing page |

- `proxy.ts` resolves the club from the host name, using a cached lookup in Edge Config, and rewrites to `/_sites/[club]/…`.
- Custom domains are added through the Vercel Domains API, with automatic SSL.
- Club pages are statically generated and revalidated with a `tenant:{id}` tag.

### 6.5 Payments: Stripe Connect

- Each club is a **connected account** created with **Accounts v2** (Stripe's recommended path for new Connect integrations). Charges are **direct charges**, so the club is the merchant of record and pays its own Stripe fees and refunds. Luvallplay optionally takes an **application fee**. Stripe Connect is only for clubs on the *Online payments* mode (§6.2.1); free-play and cash clubs never see it.
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

All palettes are validated for WCAG AA in light and dark. Clubs choose from 12 tested schemes or import their own brand, with automatic contrast adjustment (§6.3.1–6.3.2).

### 7.2 Setup wizard ("Start your club", about 5 minutes)

```
① Sign in (code) → ② Your club → ③ Look & feel → ④ How you charge → ⑤ Pick modules → ⑥ Go global? → ⑦ Invite & import → ⑧ Launch
```

| Step | Content | Best practice applied |
|---|---|---|
| ② Your club | Name, URL slug (live availability check), city/venue (map pin, used by Find a club), languages | Autosave every field; live preview of the club page on the right (desktop) or a "Preview" toggle (mobile) |
| ③ Look & feel | Pick one of the **12 colour schemes** (§6.3.1), shown live on the club's own name, a play-day card and a button in light and dark. Or **Use our own branding**: upload logo, font and colours, or import them from the club's website (§6.3.2) | One tap picks a scheme; the custom path has its own short sub-steps with previews; automatic contrast fixes explained in plain words |
| ④ How you charge | Up to three questions (§6.2.2): *Do you charge players?* → *Is your club incorporated?* → *Does it have its own Stripe account?* The answers set the mode: **Free play**, **Cash and bank transfer only**, or **Online payments** (connect the club's Stripe account right there). Cash and bank transfer clubs then enter bank details and choose cash-at-the-hall, confirm-before-paid and Akahu matching | One question per screen, plain words with an "Not sure?" explainer. Free play is a full, first-class choice. Cards are only offered to incorporated clubs with Stripe; everyone else gets a working cash and bank-transfer setup plus the "Getting incorporated" guide. Admin is configured from the answers |
| ⑤ Pick modules | Starter **presets**: *Free social club*, *Social club*, *Competitive club*, *Coaching academy*. Then grouped cards (Run your club · Money · Engage players) with on/off toggles. Money cards are hidden for Free play | Dependencies selected automatically with a note ("Memberships needs Play days"); 3–4 sensible defaults pre-selected; never more than one decision per card |
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
