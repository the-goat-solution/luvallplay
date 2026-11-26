# Phase 4 handoff (players' app on a typed API)

Written 24 Nov 2026 for whoever continues Phase 4; updated 25 Nov 2026 after step 3a (Me). Read this first, then `docs/plans/phase-4-runbook.md` (how things work and how to run them) and build plan §4 and §4.7 (the delivery log and plan changes).

## 1. Where things stand

| Step | State | PR |
|---|---|---|
| 0. Vercel builds a preview only when asked | **Merged** | #126 |
| 1. API skeleton: `packages/api`, bearer sign-in, clubs, club config | **Merged** | #127 |
| 2. `apps/app` shell: Luvallplay frame, club look, switcher, tabs, layout, i18n | **Merged** | #128 |
| 3a. Me | **Merged** | #131, see §1a |
| 3b. Inbox | **Merged** | #132, see §1a |
| 3c. Settings, part A (account, no sign-in changes) | **Merged** | #133, see §1a |
| 3c. Settings, part B (admin handoff, delete, connected apps, name step) | **Merged** | #134, see §1a |
| 4. Arena and Leaderboard | **Merged** | #135, see §1a |
| 5a. Player tab | **Merged** | #136, see §1a |
| 5b. Shop (card payments through Stripe) | **Merged** | #137, see §1a |
| 5c. Membership: join, renew, change, cancel, billing; casual booking | **Merged** | #138 (into #137), see §1a |
| 6a. Vision: tab shell and labelling tool | **Merged** | #139, see §1a |
| 6b. Vision: upload-video analysis (shared package, WebAssembly) | **Merged** | #140, see §1a |
| 6c. Vision: live camera, heartbeat, recording, passes | **Same PR as 6b** | #140 |
| 7. Offline and PWA | **Merged** | #141, see §1a |
| Parity: rank art, versus splash, match stats, player card to the Arena | **Merged** | #142 |
| Parity: My photos on Me | **Merged** | #143, see §1a |
| 8. Final pass: every screen's error state, speed, old apps, screenshots, small parity gaps, docs | **Merged** | #144, see §1a |
| Vision: the tracker's words, any club | **Merged** | #145, see §1a |
| Extras: the fonts in the app, a club's words for a player and a pair | **PR open**, needs the owner's OK (website font headers); migration 0013 needs the owner's OK to run in production | see §1a |

`main` has steps 0 to 2. Since this file was first written, `main` also gained (from other threads): the website's profile tabs became **Me, Player, Arena, Leaderboard, Vision** with Settings behind a ⚙ (the app follows: same tabs, a new Leaderboard placeholder owned by the Arena module), **My photos moved onto the website's Me page**, and Phase 3b step 1 (junior profiles, PR #119) merged. No schema change was made. No existing `apps/web` route, page or sign-in function was changed. Nobody was signed out.

## 1a. Step 3a, Me

- **API**: `me.home` (`GET /clubs/{club}/me`), `me.absence` (`POST /clubs/{club}/me/absence`), `account.dismissWelcome` (`POST /account/welcome-dismissed`), and `club.webUrl` in the config. Server code: `apps/web/lib/app-me.ts` (reuses the website's functions) and three thin route files.
- **App**: `apps/app/src/screens/Me.tsx` and `src/screens/me/*` (header, next up, membership or join, calendar, inbox preview, welcome), `src/lib/format.ts`.
- **Still opens on the club's website** (says so on the link): manage or join a membership, and book a casual spot. They move into the app with step 5.
- **Inbox (3b)**: `messages.*` endpoints and `apps/app/src/screens/Inbox.tsx` (`/inbox`, `/inbox/new`, `/inbox/<id>`); Me's bell and Messages card open it.
- **Settings part A (3c)**: `account.profile`, `details`, `language`, `privacy`, `photo` (POST and DELETE), `export`; server code `apps/web/lib/app-account.ts`; app `apps/app/src/screens/Settings.tsx`, `src/screens/settings/*`, `src/lib/photo.ts`.
- **Settings part B (3c)**: `account.adminHandoff`, `account.delete`, `integrations.*`; app `settings/ClubAdmin.tsx`, `settings/ConnectedApps.tsx`, `screens/Welcome.tsx`. **Phone change and text-message sign-in are left for the native app** (owner's decision, 25 Nov: reCAPTCHA vs the app's Content-Security-Policy).
- **Arena (4)**: `arena.state`, `arena.action`; server `apps/web/lib/app-arena.ts`; app `apps/app/src/screens/Arena.tsx`, `src/screens/arena/*` (words, data, TeamUp, Board, Dialogs). Since step 7: the rank art (`apps/app/src/components/RankIcon.tsx`, drawings moved to `packages/core/src/rank-art.ts`), the versus splash (`arena/Versus.tsx`), match stats from the feed (`arena/Stats.tsx`, endpoint `arena.matchStats`) and `/arena?vs=<id>`.
- **Leaderboard (4)**: `leaderboard.board`, `leaderboard.player`; server `apps/web/lib/app-leaderboard.ts`; app `apps/app/src/screens/Leaderboard.tsx`, `src/screens/leaderboard/*`. With rank icons.
- **Player (5a)**: `player.stats`; app `apps/app/src/screens/Player.tsx`, `src/screens/player/*` (data, Charts, RankCard). With the rank art.
- **Shop (5b)**: `shop.*`; server `apps/web/lib/app-shop.ts`; app `src/screens/shop/*`, `src/components/CardPayment.tsx`, `src/lib/stripe.ts`. Stripe's hosts are in `apps/app/vite.config.ts`.
- **Membership (5c)**: `membership.*`, `play.book`; server `apps/web/lib/app-membership.ts` (join and booking mirror `app/api/create-subscription` and `app/api/create-payment-intent`: keep in step); app `src/screens/Membership.tsx`, `src/screens/membership/*`, booking in `src/screens/me/PlayCalendar.tsx`.
- **Vision (6a)**: `vision.*`; server `apps/web/lib/app-vision.ts`; app `src/screens/Vision.tsx`, `src/screens/VisionLabel.tsx`, `src/screens/vision/data.ts`.
- **Vision (6b and 6c, one step)**: the tracker (engine, screens, labelling tool) moved from `apps/web/lib/ma`, `lib/match-analyzer.ts`, `lib/wolf-vision-trial.ts` and `components/match-analyzer/*` into **`packages/vision`** (`@luvallplay/vision`). It imports nothing from the website: a `VisionHostProvider` (`src/host.tsx`) gives it the language, the club's words, links, full screen and a **transport** for its seven server calls (challenge, pass, stats, model, share, players, labels). The website wraps it in `components/match-analyzer/host.tsx` (its existing `/api/...` routes, unchanged URLs and behaviour; `lib/wolf-vision-trial.ts` re-exports the package). The app shows the same tracker at `/vision/track` (`src/screens/VisionTrack.tsx`) on the new endpoints `vision.pass`, `vision.buy`, `vision.use`, `vision.save`, `vision.beat`, `vision.model`, `vision.train`, `vision.share`, which answer as the website's routes (journey API22 compares them). The stats email is shared (`apps/web/lib/wolf-vision-share.ts`); the app's pass checkout is in `lib/stripe.ts` (`createVisionCheckout`, `visionCheckoutPaid`) and returns to the app's `/vision`. **Known gap**: the tracker's own text (`packages/vision/src/ui/copy.ts`) is still the website's ("Wolf 1", "Pack A", "shuttle", NZ$ prices); it must become club- and sport-neutral, with prices from the API, before another club turns Vision on.
- **Offline and installing (7)**: `apps/app/src/lib/offline.ts` (the saved screens and the queue), `src/lib/queue.ts` (sends the queue when the connection is back and at start), `sw/sw.js` (the service worker, built into `dist/sw.js` with the list of built files by the `serviceWorker()` plugin in `vite.config.ts`), `public/manifest.webmanifest` and the icons, `src/lib/install.ts` and `src/screens/settings/Install.tsx`. Only "Can't make it" and its undo wait offline (as the build plan says); other changes made offline say they failed, as before.
- **My photos**: `photos.list`, `photos.upload`, `photos.add`, `photos.delete` (module `gallery`); server `apps/web/lib/app-photos.ts` over `apps/web/lib/photos-service.ts` (the website's photo steps, now shared: its three `/api/profile/photos` routes call it); app `src/screens/me/Photos.tsx`, `src/screens/me/photos-data.ts`, `src/lib/image-prep.ts` (a copy of the website's `imagePrep.ts`, on `@luvallplay/core/exif-gps`). The real upload to Vercel Blob is stood in for in APP45 (this environment has no store); try one photo on a preview with a store connected before relying on it.
- **Final pass (8)**: `apps/app/src/components/LoadError.tsx` (one "couldn't load, Try again" on every screen and card; APP46), APP47 (speed on a mid-range phone), APP22's screenshots of every screen uploaded by CI (`app-screens`), `packages/api/scripts/compat.ts` (old apps keep working: the contract against main's, in CI), the "Your match is on" pill on every tab (`screens/arena/versus-store.ts`, read by `Shell.tsx` from the cached board) and "Set up {visionName} · Free now" on live games. Fixed on the way: the tracker scrolled sideways on phones (its own edge-to-edge style and the app's wrapper both pulled it out).
- **The tracker's words**: `packages/vision/src/ui/copy.ts` names no club and no money. `{player}`, `{players}`, `{Player}`, `{Pair}` and the prices `{priceLive}`, `{priceUpload}` are filled by the host (`packages/vision/src/words.ts`): the website passes Three Wolves' words ("wolf", "Pack", "Sói", "Bầy") and NZ$5/NZ$2, so it reads as before (the price lines now all say "NZ$5"); the app passes plain words ("Player 1", "Pair A") and the prices from `vision.status` in the club's money. "Shuttle" stays: the tracker follows a shuttle on a badminton court. Test: `apps/web/tests/vision-words.test.ts`.
- **Fonts**: Luvallplay's own (Barlow Condensed, Be Vietnam Pro) are bundled from `@fontsource` (only the weights used). A club's come from its own website: the theme's `fonts` list (Three Wolves' Copperplate and Montserrat in `packages/ui/src/club-theme.ts`; another club's from `tenants.theme.fonts`), sent in `clubs.config` with full addresses, added to the page by `apps/app/src/lib/club-fonts.ts`. The app's policy allows fonts from the API hosts; the website serves `/fonts/*` and `/uploads/Montserrat-*.ttf` with `Access-Control-Allow-Origin: *` (`apps/web/next.config.ts`). Journey APP48.
- **A club's words for a player and a pair**: optional terms `player_name`, `players_name`, `pair_name` (each language's own under `localized`), parsed in `packages/core/src/club-config.ts`, sent in `clubs.config`, used by the app's tracker (`apps/app/src/lib/club-words.ts`). Three Wolves' (Wolf, Wolves, Pack; Sói, Bầy) are in the built-in settings (`apps/web/lib/constants.ts`) and in migration **0013_terms_players**, which **ran in production on 26 Nov 2026, 00:47 UTC** (Phase 3 runbook §13.2). The website's tracker keeps its own words either way. A real photo upload on a preview with the store connected.
- **Not on Me yet**: My photos and My photos (with the Player step).
- **Words**: Me words are in the app's own dictionary (`packages/i18n/src/app.ts`), copied from the website's wording without the club's name or "$" (the website's `profile` dictionary still has both typed in).

## 2. What exists now

**Preview policy (runbook §1).** `scripts/vercel-ignore.sh` (modes `web`, `site`, `app`), tested by `scripts/vercel-ignore.test.sh` (146 checks, in CI). A preview builds only when the **first line** of the newest commit message has `[preview]` (or `[preview web]`, `[preview site]`, `[preview app]`), or the branch is `preview/...`. Production builds from `main` when a project's files changed. The rule is in each `vercel.json` and in each Vercel project's Ignored Build Step.

**API (runbook §2).**
- `packages/api`: `src/contract.ts` and `src/schemas.ts` (zod, one entry per endpoint), `contract.snapshot.json`, generated `src/client.gen.ts` and `src/routes.gen.ts`, transport `src/client.ts`. The client carries no zod; answer validation is opt-in (`@luvallplay/api/validate`).
- `apps/web/lib/app-api.ts`: the wrapper every route uses (`appRoute("<id>", handler)`). It handles bearer token or the `tw_player` cookie on the same `player_sessions`, a CORS allow-list, validation (400, never 500), rate limits, club scope, module gating per endpoint, and parses answers with the contract.
- Routes under `apps/web/app/api/v1/app/`: `auth/email/start`, `auth/email/verify`, `auth/sms/start`, `auth/sms/verify`, `auth/session`, `auth/logout`, `clubs`, `clubs/[club]/config`.
- Queries in `apps/web/lib/repos/clubs.ts` and `sessions.ts`.
- `packages/ui`: `threeWolvesTheme(mode)` and `resolveClubTheme(stored, slug)`.
- The older `/api/v1/*` access-key routes and MCP are a separate surface and must keep their shapes.

**App (runbook §3).** `apps/app`: Vite, React 19, TanStack Router and Query, static build. Email-code sign-in in the Luvallplay frame, the club's look as CSS variables after sign-in (light and dark), invite link `/c/<club>`, club switcher, tabs Me, Arena, Vision, Player, Settings as lazy **placeholder** screens (Arena and Vision hide when the module is off), bottom tabs / rail / sidebar by window class, English and Vietnamese (`packages/i18n/src/app.ts`). Shell is about 113 kB gzipped JavaScript; the budget is 150 kB (`pnpm --filter app budget`).

**Tests.**
- `apps/web/tests/api-contract.test.ts`, `app-api.test.ts` (unit).
- `apps/web/tests/e2e/journeys.mjs`: group "API" (API1 to API7) and T1 (tenant isolation) cover the new routes. This file is not run in CI; run it locally.
- `apps/app/tests/*.test.ts` (29) and `apps/app/tests/e2e/app.mjs` (APP1 to APP15, with axe). CI job "Players' app" runs these.

## 2a. Design system and several clubs

**Design system.** `packages/ui/src/system.css`, on the semantic tokens: derived roles (`primary-strong`, `surface-sunken`, `success`, soft tints), brand-tinted elevation, radii, type scale and motion. A theme may set the four optional tokens (`EXTRA_TOKENS` in `semantic.ts`; optional in the contract); Three Wolves sets its website's navy-dark and cream-dark. The app's CSS uses only semantic and system tokens (`apps/app/tests/lib.test.ts` checks it).

**Home and My profile.** Tabs: Home · Player · Arena · Leaderboard · Vision. Home (`/home`; `/me` redirects) is "what's next": a greeting by time of day ("Good morning, Mia"), Next up, the calendar, messages, the welcome card, the shop, and the way in for a non-member. My profile (`/profile`, the person's picture at the top right; `/settings` redirects to its settings) is who they are: picture, name, email, the membership pill, memberships, My photos, then every setting. The top bar carries the inbox bell (unread across clubs) and the picture on every screen.

**Icons.** One set, `apps/app/src/components/Icon.tsx`: 24px grid, 2px round stroke, no fills; decorative unless given `label`. No emoji or arrow characters stand in for icons in the app's own screens (dictionary text shared with the website keeps its own).

**Several clubs** (two or more in `clubs.list`; one club sees no change):
- **Home**: `/home`, `/profile`, `/inbox*`, `/welcome` (`isHomePath` in `apps/app/src/lib/nav.ts`). Luvallplay's look; every club's Me brought together (`screens/me/Home.tsx`, merging in `lib/home.ts`): next up across clubs, one membership card per club, one calendar, the latest messages, each club's shop and photos (when on). A filter (all clubs or one) is kept on the device (`homeClub`).
- **Club spaces**: every other screen (Player, Arena, Leaderboard, Vision, Membership). The club's look; the top bar is the club's crest and name, a picker of the clubs that have that space; the choice is kept (`club`). A club without the space's module is never shown there (`spaceClub`). Tabs are the union across clubs, each in the words of the club it opens.
- **Club scope**: `ClubScopeProvider` (hooks.tsx). Inside it `useCurrentClub()` is that club, so a card or row on Home acts on its own club (absence, booking, payment, shop, photos, messages). `ScopeTag` labels it.
- **Inbox**: one list across clubs; a conversation is `/inbox/<id>?club=<slug>`; a new message starts by choosing the club.
- **Settings**: Club admin for each club the person administers, through that club's API.
- Journeys APP4, APP4b, APP4c and APP13b (axe) use a synthetic second club, Harbour Smash (`withSecondClub` in `apps/app/tests/e2e/app.mjs`).

## 3. Vercel state (needs the owner)

- Team "Timba Le's projects" (`team_4ZLaiQ8NFFhJslfVJEANgxVH`). Projects: `three-wolves-badminton` (`apps/web`), `luvallplay-site` (`apps/site`), `luvallplay-app` (`apps/app`, `prj_ZjHXLpD1IUVPgpWsED5bkKXdeuk9`).
- `app.luvallplay.com` is attached to `luvallplay-app` and verified. DNS is on Vercel's name servers, so no DNS step is needed.
- **`luvallplay-app` is live since 25 Nov 2026**: `VITE_API_BASE` = `https://www.threewolvesbadminton.org` (Production and Preview), unpaused, `main` deployed to production. `app.luvallplay.com` serves it, and the API answers its origin. It was paused on 24 Nov because Vercel promoted the project's first deployment (from a feature branch) to production. Nobody is pointed at it yet: that is the cutover.
- Feature-branch pushes of `three-wolves-badminton` sometimes fail with "Resource provisioning failed" before the skip rule runs (likely the Neon preview-branch integration). Being looked into; report only, no settings changed.

## 4. What to build next, in order

Use the strangler method: one tab at a time, the server-rendered pages in `apps/web/app/profile` stay live until parity is proven.

For each screen: add endpoints to the contract, add route files with `appRoute`, run `pnpm --filter @luvallplay/api generate` and `snapshot`, put queries in `apps/web/lib/repos` (no SQL in route files; a test enforces it), then build the screen in `apps/app/src`, add journeys, update the runbook and the delivery log (§4.7).

1. ~~**Me**~~: done in step 3a, except the shop and My photos (see §1a).
2. **Settings** is done except **phone change and text-message sign-in**, which the owner decided to leave for the native app (Capacitor), because reCAPTCHA doesn't fit the app's Content-Security-Policy (the API has `auth.smsStart`/`smsVerify`; `SignIn.tsx` has the extension point).
3. ~~**Arena**~~: done in step 4, except match stats and Wolf Vision links (Vision step) and the player card (with the Leaderboard). The **Leaderboard** is done too. The **Player** tab is done too (5a). My photos is on the website's Me page; it joins the app's Me with the shop.
4. **Player, shop orders, membership and cancel flows**. Payments stay on the existing Stripe flows; show money through `@luvallplay/core/money`. Load Stripe only when used.
5. **Vision**: set-up, analyzer (MediaPipe lazy-loaded), labelling.
6. **Offline and PWA**: app-shell service worker, persisted query cache, queued writes (for example "I can't make it"), offline banner, update prompt, manifest.
7. **Final pass**:
   - Bundle the club's fonts (Copperplate, Montserrat) and Luvallplay's; today the app shows fallbacks, so "Three Wolves identical to today" is **not met**.
   - Visual snapshots at 320, 375, 600, 840, 1200 plus foldable and tablet splits.
   - Measure cold start on a throttled mid-range Android (target under 1.5 s). Not measured yet.
   - Old-client tests: keep the previous two released bundles and run their smoke suite against the new API. Not built.
   - Journeys A1 to A6, M1 to M5, G1, G2, P1, P3 against the new app.
   - Junior "Family" features: port if Phase 3b (PR #119) has merged; otherwise leave an extension point.
   - Update `apps/site/content/availability.ts` when a players' app feature goes live (Phase 6 runbook §3a; a test fails otherwise).

## 5. Rules agreed with the owner

- Branches: `claude/luvallplay-phase-4-<step>`, one small PR per step, each deployable and revertable alone.
- The agent may merge PRs that only add new, unused API routes, `apps/app` and docs, once CI is green. **Ask the owner before** merging anything that changes existing `apps/web` routes or pages, anything touching sign-in, any production setting or data step, and the cutover.
- **Cutover** (making `app.luvallplay.com` the path Three Wolves members use, with the one-time session handover so nobody is signed out) is a separate step the owner schedules. Not started.
- If a migration becomes unavoidable, follow the data protocol in the test plan (expectations file, rehearsal on a Neon branch, restore point, ask before each production step).
- No "label a PR for a preview" flow (the owner declined it).
- No secrets or personal emails in commits. No model names in commits or PRs. Don't push empty commits to start builds.

## 6. How to run things

```
pnpm install
bash scripts/vercel-ignore.test.sh

# web: unit tests need a Postgres; the schema-drift suite needs Postgres 18
DATA_GUARD_TEST_URL=postgres://postgres:postgres@localhost:5432/dg_test \
DATA_GUARD_REQUIRE_DB=1 ROLES_TEST_URL=$DATA_GUARD_TEST_URL pnpm --filter web test
pnpm --filter web e2e                 # builds, then every journey (local Postgres)

# app
pnpm --filter app typecheck && pnpm --filter app test
pnpm --filter app build && pnpm --filter app budget
(cd apps/web && E2E_BUILD=1 npm run build) && pnpm --filter app e2e

# after changing the contract
pnpm --filter @luvallplay/api generate && pnpm --filter @luvallplay/api snapshot
```

## 7. Things that bit us

- A commit message that only *mentions* `[preview]` in its body used to start builds. Only the subject line counts now.
- A new Vercel project promotes its first deployment to production whatever the branch. Create projects only when the code is on `main`, or pause first.
- `clubConfig()` answers with the built-in Three Wolves values when `CLUB_SETTINGS_SOURCE` is `constants`, whatever `TENANT_SLUG` is. Club routes use `deploymentClub()` in `lib/app-api.ts` instead; keep using it.
- One deployment serves one club today (`TENANT_SLUG`). The club switcher's second club is simulated in the app's journeys.
- Squash merges make stacked branches conflict in the docs; resolve by keeping the branch's side.
- Other open work: PR #119 (Phase 3b, juniors) and the Phase 6 thread (marketing site, `docs/plans/phase-6-runbook.md`).
