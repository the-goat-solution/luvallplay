# Phase 4 runbook: the players' app on a typed API

Working notes for Phase 4 of the build plan (§4). Kept up to date as the work lands. The delivery log is in `luvallplay-build-plan.md` ("Phase 4 delivery log").

## 1. Preview policy: Vercel builds a preview only when asked

**Why:** Vercel used to build a preview of every project for every push to every branch. With two projects (soon three) that was two or three builds per push, most of them never opened.

**The rule** (`scripts/vercel-ignore.sh`, tested by `scripts/vercel-ignore.test.sh`, which CI runs):

| Push to | What Vercel does |
|---|---|
| `main` | Production build of each project **whose files changed** (as before). |
| a branch named `preview/...` | Preview of each project whose files changed. |
| any other branch, **first line** of the newest commit message contains `[preview]` | Preview of each project whose files changed. |
| any other branch, first line of the newest commit message contains `[preview web]`, `[preview site]` or `[preview app]` (names can be combined: `[preview web app]`) | Preview of the named projects only. |
| anything else | **Skipped.** The deployment shows as "Canceled" with the reason in its build log. No build minutes are used. |

"Files changed" compares with the project's last successful deployment on that branch. The lockfile, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, the ignore script itself and everything in `packages/*` count for every project. Docs and CI changes build nothing. On the first asked-for preview of a branch there is nothing to compare with, so the projects asked for all build.

**Projects** (team "Timba Le's projects"):

| Project | Root | Mode | Where the rule is set |
|---|---|---|---|
| `three-wolves-badminton` | `apps/web` | `web` | `apps/web/vercel.json` `ignoreCommand`, and the project's Ignored Build Step |
| `luvallplay-site` | `apps/site` | `site` | `apps/site/vercel.json` `ignoreCommand`, and the project's Ignored Build Step |
| `luvallplay-app` (created with the app shell) | `apps/app` | `app` | `apps/app/vercel.json` `ignoreCommand`, and the project's Ignored Build Step |

The `vercel.json` value wins where it exists. The project-level setting is a backstop for older branches whose `vercel.json` has no `ignoreCommand`; it applies the "only when asked" rule itself before calling the script:

```
case "$VERCEL_GIT_COMMIT_REF" in main|preview/*);;*) git log -1 --pretty=%s|grep -qiF '[preview'||exit 0;;esac; bash ../../scripts/vercel-ignore.sh <mode>
```

Older branches that already carry the previous `apps/site/vercel.json` keep the old behaviour for the site project (build when site files change) until they merge `main`.

**How to get a preview when you want one:**

1. Put `[preview]` (or `[preview app]` and so on) in the **first line** of the message of a commit that has real changes. Only the newest commit of a push is read, and only its first line, so a message that just mentions the tag further down doesn't start a build.
2. Or work on a branch named `preview/<anything>`.
3. Or redeploy a skipped deployment: Vercel dashboard → the project → Deployments → the canceled one → ⋯ → Redeploy. An agent can do the same with its deployment tool.

Don't push empty commits to start a build.

**Not built (an option, needs a decision):** "label a pull request to get a preview". It needs a Vercel token stored as a GitHub Actions secret, so a workflow can ask Vercel to deploy the PR's branch when the label is added.

**What did not change:**

- CI in GitHub Actions is the merge gate. End-to-end journeys run against a local production build, never against a preview.
- The Phase 0 protections for previews that do build: a preview cannot reach the production database (`lib/db-switch.ts`), side effects are off outside production (`lib/side-effects.ts`), and previews get their own Neon branch (phase-1 runbook §1).
- Production deploys from `main`.

**Check the script locally:** `bash scripts/vercel-ignore.test.sh`

## 2. The players' app API (`/api/v1/app`)

**Where things are**

| Piece | Path |
|---|---|
| The contract (zod schemas, one entry per endpoint) | `packages/api/src/contract.ts`, `schemas.ts` |
| The typed client, generated from the contract | `packages/api/src/client.gen.ts` (transport: `client.ts`; route table without the schemas: `routes.gen.ts`) |
| The snapshot released apps were built against | `packages/api/contract.snapshot.json` |
| The server wrapper every route goes through | `apps/web/lib/app-api.ts` |
| Route handlers | `apps/web/app/api/v1/app/...` |
| Queries | `apps/web/lib/repos/clubs.ts`, `sessions.ts` |

The older `/api/v1/*` routes (personal access keys, shared with the MCP server) are a different surface. They are untouched and keep `Access-Control-Allow-Origin: *`; the app API sits beside them under `/api/v1/app`.

**Endpoints so far**

| Endpoint | Who | What |
|---|---|---|
| `POST /auth/email/start`, `/auth/email/verify` | anyone | The same email code as the web. Verify answers with a session **token** (no cookie). |
| `POST /auth/sms/start`, `/auth/sms/verify` | anyone | The same text-message code as the web. |
| `GET /auth/session` | signed in | Who the token belongs to. |
| `POST /auth/logout` | signed in | Ends this session, or every session with `{ "all": true }`. |
| `GET /clubs` | signed in | The person's clubs, each with its role, its region's API base and whether the "Club admin" button shows. |
| `GET /clubs/{club}/config` | anyone | The club's look (semantic tokens, light and dark), modules that are on, terms, currency and exponent, country, region, payment mode, the club's website (`webUrl`) and the settings the app needs. Public so an invite link can apply the look before sign-in. |
| `GET /clubs/{club}/me` | signed in | The Me tab in one answer (so it opens from the cache at once): name and initials, the membership (plan, day, status, dates, days left, a paid follow-on) or the prices to join, the casual price, streak and month rank, the next five weeks of play days as this person sees them, the inbox's unread count and three latest conversations, and whether to show the welcome card. Memberships off: no membership and no join prices. |
| `POST /clubs/{club}/me/absence` | signed in | "Can't make it" (`{date, absent: true}`) and "I can come after all" (`absent: false`), as the web's `/api/profile/absence`: frees the spot and tells the waitlist. Past days (`past`), non-members (`no_membership`) and impossible dates (`bad_request`) are refused. |
| `POST /account/welcome-dismissed` | signed in | The welcome card's Done; kept on the account. |
| `GET /clubs/{club}/messages` | signed in | The person's conversations with the club (subject, preview, unread, open or closed, who wrote last). |
| `POST /clubs/{club}/messages` | signed in | Start a conversation (`{subject, body}`); the club's admins are emailed. Same limit as the web (10 an hour, one bucket for both). |
| `GET /clubs/{club}/messages/{id}` | signed in | One conversation; reading it marks it read. Somebody else's, or an id that can't exist, is `404 not_found`. |
| `POST /clubs/{club}/messages/{id}` | signed in | Reply (`{body}`); reopens a closed conversation; the admins are emailed. Same limit as the web (30 an hour). |
| `GET /account/profile` | signed in | The account for Settings (the same in every club): names, display name (and whether it is the person's own or the default), email, phone and whether it is confirmed, language, leaderboard switch, picture. |
| `POST /account/details` | signed in | First name, last name and display name (`null` = the default). The phone and its confirmation are left as they are; changing the phone is the sign-in step. |
| `POST /account/language` | signed in | `{lang: "en" | "vi"}`, kept on the account so the website and the club's emails follow. |
| `POST /account/privacy` | signed in | `{leaderboardVisible}`, as the website's switch; the leaderboard is refreshed. |
| `POST /account/photo`, `DELETE /account/photo` | signed in | A new picture (`{image}`: a JPEG, PNG or WebP data URL up to 2 MB, already squared and shrunk by the app) or none. Same storage and limits as the website (10 an hour). Without picture storage: `503 not_configured`. |
| `GET /account/export` | signed in | Everything kept about the person, as the website's Download my data (10 an hour). |
| `POST /account/admin-handoff` | signed in | The "Club admin" button: a single-use link (about a minute) that opens the club's admin already signed in, as the web's `/api/admin/handoff` (an admin role, a sign-in within 12 hours, audited). Not an admin: `403 forbidden`. Signed in more than 12 hours ago: `403 step_up` (not 401, so the app doesn't sign out); the app then confirms with an emailed code. |
| `POST /account/delete` | signed in | Deleting the account (`{confirm: "DELETE"}`), as the website: the club's only owner hands over first (`409 last_owner`), the arena and picture go, every session ends, the admins are emailed. |
| `GET /account/integrations` | signed in | Connected apps: the person's access keys and webhooks (never a key or secret). |
| `POST /account/integrations/tokens`, `DELETE …/tokens/{id}` | signed in | A new access key (`{name, scopes}`; the key is in this answer only; ten at most, `409 too_many`), or disconnect one. |
| `POST /account/integrations/webhooks`, `DELETE …/webhooks/{id}` | signed in | A new webhook (public `https://` only, `400 invalid_url`; five at most; the signing secret is in this answer only), or remove one. |
| `GET /clubs/{club}/arena` | signed in, Arena on | The Arena board as this person sees it: their pair, rank and requests, their challenges, games live now, open challenges (with why they can't take one), the crown, pack leader, champion, hot streak and the feed. The website's `/api/arena` snapshot, from the same function; poll it while the tab is open. |
| `POST /clubs/{club}/arena` | signed in, Arena on | One Arena action (pair codes and invites, requests, rename, split, post, take down, accept, check in, call off, score, retired, confirm, dispute, after-game, rank seen), answered with the fresh board and a code to show when the action made one. A rule the Arena refuses is `409` with its own code (`bad_code`, `not_open`, `too_soon`…). Same limit and bucket as the website (60 a minute). |
| `GET /clubs/{club}/leaderboard` | signed in, Arena on | The points board, as the website's Leaderboard tab: `?source=` all, challenges, play or rr; `?period=` month, quarter, year or lifetime; `?key=` a past period. Up to 200 rows (people who hide are left out), the keys of the periods before and after, and for you: whether you show, your own rank if you hide, and your place on the ladder. |
| `GET /clubs/{club}/players/{id}` | signed in, Arena on | A player's card: rank, points all time and in 90 days, the last five results, and their pair's open challenge (for "Challenge"). Someone who hides is `404`, except to themselves. |
| `GET /clubs/{club}/me/stats` | signed in | The Player tab's stats, the website's own: play days by period, the week streak, round robin totals and history, your places on the play-days and round-robin boards, the days you played and the days the club played (26 weeks). |

**Rules the wrapper applies to every route**

- **Who is calling:** `Authorization: Bearer <session token>` (the app) or the web's `tw_player` cookie. Both are rows in `player_sessions`; only the token's SHA-256 is stored. Signing in through the API never ends another session. A `tw_…` access key is not a session.
- **CORS:** an allow-list, never `*`: `https://app.luvallplay.com`, `capacitor://localhost`, `https://localhost`, plus exact origins in the `APP_ORIGINS` environment variable (comma-separated; use it for the app's Vercel URL until DNS exists). Local dev servers (`http://localhost:5173`, `:4173`) are allowed outside production only.
- **Cookie writes from another site are refused** (`403 bad_origin`); a bearer token is fine from anywhere.
- **Validation at the edge:** params, query and body are parsed with the contract's schemas. Bad input is `400` with a code (`404` for a malformed club), never `500`.
- **Rate limits:** per endpoint, per signed-in person or address. The sign-in endpoints share the web's buckets, so using both surfaces doesn't double the allowance.
- **Club scope:** `/clubs/{club}/...` answers only for the club this deployment serves (`TENANT_SLUG`); any other slug is `404 club_not_found`. An endpoint that names a `module` answers `404 module_off` when the club has it off.
- **Answers are parsed with the contract** before they are sent, which also drops any field the contract doesn't name.

**Changing the contract**

1. Edit `packages/api/src/schemas.ts` / `contract.ts`, add the route file under `apps/web/app/api/v1/app/` using `appRoute("<id>", ...)`.
2. `pnpm --filter @luvallplay/api generate` (client and route table) and `pnpm --filter @luvallplay/api snapshot` (snapshot).
3. Adding a response field or an optional request field is fine. Removing or renaming a field, changing a type, making a request field required or a public endpoint private is refused by the snapshot script and fails `tests/api-contract.test.ts`: bump `API_VERSION` and keep serving the old version beside the new one.

**Tests**

- `apps/web/tests/api-contract.test.ts`: the snapshot, the generated client is current, contract and route files match one to one (generated from the route list, so a new route without a contract entry fails), every route goes through the wrapper.
- `apps/web/tests/app-api.test.ts`: the CORS allow-list and where a session token is read from.
- `apps/web/tests/e2e/journeys.mjs`, group "API" (API1–API7): sign in by email code and get a token, the web session is untouched, sign out and sign out everywhere, the club config, permissions for every signed-in endpoint as nobody / a made-up token / an access key / an expired session, bad input on every public POST, CORS. T1 also asks the second club's deployment for the first club's config (404) and checks a person's club list there.

Run locally (needs a local Postgres; the schema-drift suite needs Postgres 18):

```
pnpm --filter web test
pnpm --filter web e2e        # builds, then runs every journey
```

**Environment variables (all optional)**

| Name | Meaning |
|---|---|
| `APP_ORIGINS` | Extra exact origins allowed to call the API from a browser. |
| `API_BASE_<REGION>` | The API host of a region (for example `API_BASE_SYD=https://api.luvallplay.com`). Without it, a club in this deployment's region gets this deployment's own host. |

## 3. The players' app (`apps/app`)

A client-side app (Vite, React 19, TanStack Router and Query) built to static files. It talks only to the API in §2, through the client generated from the contract.

**Run it**

```
pnpm --filter web dev          # the API, on http://localhost:3000
pnpm --filter app dev          # the app, on http://localhost:5173 (proxies /api to :3000)
```

Sign in with an email; without `RESEND_API_KEY` the code is printed in the API's terminal.

**What is there now (the shell)**

| Piece | Where |
|---|---|
| The Luvallplay frame: sign-in, splash, the "on Luvallplay" mark | `src/Frame.tsx`, `src/screens/SignIn.tsx` |
| A club's invite or QR link, `/c/<club>`: the club's look before sign-in | `src/screens/Invite.tsx` |
| The signed-in shell: the club's look, name and logo, navigation, club switcher | `src/screens/Shell.tsx` |
| Tabs (Me, Player, Arena, Leaderboard, Vision, as on the website), each its own chunk; Settings behind the ⚙ in the header | `src/router.tsx`, `src/screens/*.tsx` |
| Me: header, next up, membership or join, play calendar, inbox preview, welcome card | `src/screens/Me.tsx`, `src/screens/me/*` |
| The inbox: list, conversation, new message | `src/screens/Inbox.tsx`, `src/screens/inbox/data.ts` |
| Dates, times and money in the club's country, time zone and currency | `src/lib/format.ts` |
| Theme → CSS custom properties, light and dark | `src/lib/theme.ts` |
| Window classes and the navigation for each | `src/lib/window-class.ts`, `src/styles/app.css` |
| Which tabs a club shows (a module that is off takes its tab away) | `src/lib/nav.ts` |
| The token and the person's choices (one interface; secure storage in Phase 5) | `src/lib/storage.ts`, `src/lib/store.ts` |
| Text in English and Vietnamese | `packages/i18n/src/app.ts` |

**Me** is the real screen (step 3, see below). Player, Arena, Leaderboard and Vision are honest placeholders until their screens move in. Settings has the account's details, picture, language, appearance, privacy, Download my data and signing out (step 3c, below). The **Club admin** button shows for people who can open the admin, but is disabled with an explanation until the handoff endpoint is in the contract.

**Me (step 3)**

The website's Me page (`apps/web/app/profile/page.tsx`), card for card, from one call (`me.home`):

- **Header**: picture or initials, name, the membership pill ("Active · renews Fri 18 Dec"), and the inbox bell with the unread count (it takes you to the Messages card).
- **Next up**: the first play day they're in, with **Can't make it** on a membership day.
- **Membership** (plan · day, status, days left, renews or ends, a paid follow-on) or **Become a member** (both plans in the club's money). Hidden when the club has Memberships off.
- **Play calendar**: five weeks by month; their days marked, Can't make it on each, casual spots left, paused and closed days.
- **Messages**: the three latest conversations, each opening in the inbox; **Welcome card** for a new account, until Done.

Can't make it and Done change the screen at once and are put back (with a message) if the server refuses them.

**Opens on the club's website for now** (a link that says so; the app has no card payments yet): managing or joining a membership and booking a casual spot (the membership and shop step). The address comes from the club's config (`webUrl`).

**Inbox (step 3b)**

`/inbox` (the list), `/inbox/new` (a new message) and `/inbox/<id>` (one conversation), opened from Me's bell and Messages card; not a tab, as on the website. On a phone the list and a conversation are one screen each with "All messages" to go back; when the screen is wide enough (a container query) they sit side by side. An open conversation refreshes every 20 seconds while it is on screen, as on the website; reading it updates the list and Me's bell. A refused send keeps what was written and says why (too many messages, or try again).

**Arena (step 4)**

The Arena tab, as on the website: the header with how many pairs are up, live and played this week; **team up** by QR (an invite link `/arena?join=<code>` that pairs whoever opens it), by scanning a partner's QR with the camera, or by a 5-digit code read out and typed in; a request to accept or decline; **your pair** (record, put up for a challenge for today, 3 or 7 days with a note, take it down, name it, split up); **your challenges** under way (check in, call off, enter the score, confirm it or say it's wrong); **live now**; **open challenges** with the bonuses on offer and why you can't take one; the **crown**, pack leader, season champion, the **feed** and who's on fire. Dialogs for the final score (only valid scores to 21 can be sent; retirements), the after-game card (points won, keep the pair, another challenge?) and a rank-up. The board refreshes every 5 seconds while the tab is on screen. Words come from the website's own Arena dictionary, with the club's name in place of Three Wolves. The QR and scanner libraries load only when used. **Not in the app yet**: match stats, Wolf Vision links (with the Vision step), the player card sheet and the versus splash.

**Player (step 5a)**

As on the website: your rank when the club has the Arena (points, league step, how far to the next rank, the split by source, how points work), the kit bag (tap an item for what it takes) and achievements; your play days by period, the week streak, round robin points, win rate and best finish; your places on the boards (with a note when you hide); the last 26 weeks as a chart, round robin points per day, your history; and the whole ladder with your tier marked. Without the Arena: the stats only. Rank art is not in the app yet (names are).

**Leaderboard (step 4)**

The Arena module's second tab, as on the website: the club's points for a month, quarter, year or all time, from every source or from challenges, play days or round robin; step back to earlier periods; the tiers marked down the list; your next tier and how far; your row pinned when you're below the top 50; a note with your own rank when you hide. A row opens the player's card (rank, points, recent form) whose **Challenge** accepts their pair's open challenge, or opens the Arena to put yours up.

**Settings (step 3c)**

Behind the ⚙ in the header, as on the website:
- **Club admin** (for admins): opens the club's admin signed in, through a one-use link; someone who signed in more than 12 hours ago confirms with an emailed code first, right there.
- **Picture**: chosen on the device, cut square and shrunk to 512 px in the browser (never enlarged).
- **Your details**: first, last and display name; the email and phone are shown, with whether the phone is confirmed.
- **Language** (on the device at once and saved to the account), **appearance**, the **leaderboard switch** (moves at once, goes back if refused).
- **Connected apps**: access keys (shown once), webhooks, and where the MCP server and calendar feed live.
- **Your data**: Download my data, and Delete my account (type DELETE).
- **Signing out**, here or everywhere.

A brand-new account is asked its name after its first code (`/welcome`); skipping leaves a reminder with a link back until a name is saved anywhere.

**Not in the app yet: changing the phone number and text-message sign-in.** Both need a text-message code, which on the website goes through Google reCAPTCHA; the app's Content-Security-Policy allows only its own scripts. The owner decided (25 Nov) to leave both for the native app (Capacitor), where phone checks work differently; until then the phone is shown read-only.

**Not on Me yet**: the **shop** (with the shop step) and **My photos** (with the Player step).

**How the look works (decision AM)**

- Signed out, the page wears Luvallplay's own theme (`packages/ui/tokens.css`, Court Green).
- After sign-in the app asks for the person's clubs, then the current club's config, and sets the club's semantic tokens as custom properties on `<html>`; `data-theme` is `light` or `dark` (the device's setting unless one is chosen in Settings). The last config seen is kept on the device, so the look is there at once on the next start.
- Switching clubs swaps the tokens, name, logo, words and tabs; tokens the new club doesn't set are removed.
- `/c/<club>` loads that club's public config and wears its look through sign-in, then opens that club.
- Components and the stylesheet use only semantic tokens; a test fails on a brand name or a colour literal.

**Layout**

| Window class | Width | Navigation |
|---|---|---|
| compact | under 600 | bottom tab bar |
| medium | 600 to 839 | navigation rail |
| expanded | 840 to 1199 | navigation rail; screens lay panes side by side (container queries) |
| large | 1200 and up | sidebar |

Safe areas on every edge, `dvh`, 44px touch targets, rem type (text scales to 200%), reduced motion, and on a foldable opened flat the navigation takes the first screen and the content the second (Viewport Segments).

**Environment variables (build time)**

| Name | Meaning |
|---|---|
| `VITE_API_BASE` | The home API host, for example `https://api.luvallplay.com`. Empty means the app's own origin. |
| `VITE_API_HOSTS` | More API hosts (other regions), space or comma separated. |

These, plus `https://api.luvallplay.com`, are the only hosts the built page may talk to: the build writes them into the page's Content-Security-Policy (`connect-src`), and the app only sends a session token to a host on that list. Images may come from any `https:` host (a club's logo on its own site, profile photos in Blob storage); an image can't read the page or carry the token. The API must allow the app's origin in turn (`APP_ORIGINS`, §2).

**Tests**

```
pnpm --filter app typecheck
pnpm --filter app test                    # pure logic, the stylesheet's rules, both languages
pnpm --filter app build && pnpm --filter app budget
(cd apps/web && E2E_BUILD=1 npm run build) && pnpm --filter app e2e
```

- `tests/lib.test.ts`: theme to custom properties (and what it refuses), window classes, tabs and modules, storage, which host gets the token, messages complete in both languages and sport-neutral, the stylesheet's rules.
- `tests/format.test.ts`: dates in the club's country and time zone, money in minor units, months, next up, and the Me words complete in Vietnamese with no club name or currency typed in.
- `tests/e2e/app.mjs` (APP1 to APP36): the real API on a fresh local Postgres, the app built and served on its own origin. Sign in by email code; Luvallplay's look before, the club's after; an invite link applies the club's look first; switching clubs changes look, words and tabs at once (the second club is simulated in the browser, since one deployment serves one club); a module that is off; a refused token; languages; light and dark; the Club admin button; five widths with the right navigation and no sideways scroll; text at 200%; reduced motion; axe in light and dark; the Content-Security-Policy; screens as separate chunks. Me (APP16 to APP21): a member's Me matches the API's own answer card for card; Can't make it flips at once, is saved, survives a reload and undoes, and a refused one is put back; a newcomer sees the join card in the club's money and the welcome card, and Done stays done; Memberships off hides both cards; Me in Vietnamese; Me that can't load offers Try again. The inbox (APP23 to APP25): from Me to a conversation and back on a phone, reply, and the bell catches up; a new message side by side on a tablet, and the admins are emailed; a refused send keeps the text and says why; a conversation that isn't yours isn't there. Settings (APP26 to APP29): names saved and shown on Me at once; language saved to the account; the leaderboard switch saved and put back when refused; a picture sent small and square, no storage said plainly, and removed; Download my data gives a JSON file (APP26 to APP29); Club admin opens admin and an old sign-in confirms by code first (APP9); deleting the account, and the only owner told to hand over (APP30); connected apps (APP31); the name step for a new account (APP32); the Arena (APP33, APP34: pairing by code, putting a challenge up and down, an invite link, and a whole game between two pairs through to the after-game card); the Leaderboard (APP35: the board as the API has it, periods and sources, a player's card whose Challenge opens the Arena); the Player tab (APP36, with and without the Arena). APP22 also takes the Player tab, the Arena and the Leaderboard takes screenshots (`E2E_SHOTS=<folder>`) for people to look at.
- CI job "Players' app" runs all of it.

**Performance budget**

The app shell (the entry script and what it preloads) must stay at or under **150 KB gzipped JavaScript**; `scripts/check-budget.mjs` fails the build over that. Today it is about 111 KB; the Me screen is a separate 5.4 KB chunk. The client carries no zod: it uses a generated route table (`packages/api/src/routes.gen.ts`), and the schemas stay on the server.

**Vercel project and domain (24 Nov 2026)**

- Project **`luvallplay-app`** (`prj_ZjHXLpD1IUVPgpWsED5bkKXdeuk9`), root `apps/app`, framework Vite, connected to this repository, with the §1 ignore rule as its Ignored Build Step and in `apps/app/vercel.json`.
- **`app.luvallplay.com`** is attached to it and verified. luvallplay.com's DNS is on Vercel's name servers, so Vercel created the record itself: **no DNS step is needed**. If the DNS ever moves away from Vercel, the records are: CNAME `app` → `0614f58185a129ba.vercel-dns-017.com.` (older value `cname.vercel-dns.com.`), or A `216.198.79.1` and `64.29.17.1`.
- **Live since 25 Nov 2026.** `VITE_API_BASE` = `https://www.threewolvesbadminton.org` (Production and Preview) is set on `luvallplay-app`, the project was unpaused and `main` deployed to production; `app.luvallplay.com` serves it. Checked: the page's policy names the API host, and the API answers the app's origin (preflight 204, the club's config with `Access-Control-Allow-Origin: https://app.luvallplay.com`). Nobody is pointed at it yet; the cutover is a separate step. (It was paused on 24 Nov because Vercel promoted the project's very first deployment, from a feature branch, to production.)
- On `three-wolves-badminton` nothing was needed: `https://app.luvallplay.com` is in the API's built-in allow-list. Only if a `*.vercel.app` preview of the app should be able to sign in, add that exact origin to `APP_ORIGINS` there.

**Not yet**

- Offline, the service worker and the PWA manifest (step 7).
- Text-message sign-in in the app (the API has it; the screen is an extension point in `SignIn.tsx`).
- The club's and Luvallplay's web fonts in the app (system fallbacks for now; part of the visual-parity pass).
