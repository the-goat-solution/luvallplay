# Players' app: parity with the website's `/profile`, and the cutover plan

Lane N, 25 Nov 2026. Read from `main` at `d7bd02d`. Nothing here has been done: **the cutover is scheduled by the owner, and every step in §4 is asked first.** Decision AO (25 Nov) is the frame: after the cutover the website's player pages get fixes only, and are retired (redirecting to the app) after two quiet weeks.

Paths: website = `apps/web/...`; app = `apps/app/src/...`.

## 1. Summary

- **48 things a member can do were compared.** 32 are the same in the app, 5 exist only in the app, 3 are partly there, 8 are missing.
- **Nothing a member pays for or books is missing.** Membership (join, renew, change, cancel, billing, card), casual booking, the shop, the Arena, the Leaderboard, Vision, the inbox, photos, settings, export and deletion are all in the app.
- **Three things must be fixed before anyone is moved** (§3, "Before the cutover"): the app's sign-in sends no bot-check token (not refused today, because the check is switched off in production, but it would be the day it is switched on); a link opened while signed out forgets where it was going; and emails (including the app's own sign-in email) link to the website.
- **Two gaps are the owner's earlier decision** (text-message sign-in and changing the phone number wait for the store apps). Nobody is stranded by that: every live account has a usable email address (counted on production, 25 Nov).
- **The website session doesn't go away.** Admin and the public join and booking forms keep using it. Only the `/profile` pages are retired.

## 2. Parity checklist

States: **Same** = a member can do the same thing; **Partial** = there, with a difference that a member would notice; **Missing** = not in the app; **App only** = the app has it, the website does not.

### Signing in and the session

| Feature | Website (file) | App (file) | State | Note |
|---|---|---|---|---|
| Sign in with a 6-digit email code | `app/login/page.tsx`, `components/profile/LoginForm.tsx`, `app/api/auth/email/{start,verify}` | `screens/SignIn.tsx`, `app/api/v1/app/auth/email/{start,verify}` | Same | **Check before cutover:** the app never sends a Turnstile token (no Turnstile code in `apps/app/src`), and `auth.emailStart` answers 403 `captcha` when `TURNSTILE_SECRET_KEY` is set and no token is sent (`app/api/v1/app/auth/email/start/route.ts:11`, `lib/security.ts:37-39`). If production has that key, app sign-in fails. The website's form does send one. |
| One-tap "Sign in" button in the code email | `app/api/auth/email/link/route.ts` | none | Missing | The email sent for an app sign-in carries the same button, and it signs the person in **on the website** and lands on `/profile` (`app/api/v1/app/auth/email/start/route.ts:15`). In the app only the typed code works. |
| Sign in by text message | `LoginForm.tsx` (method "sms"), `app/api/auth/sms/{start,verify}` | none (API exists: `auth.smsStart`, `auth.smsVerify`; `SignIn.tsx:2` marks the spot) | Missing | Owner's decision: left for the native app (reCAPTCHA vs the app's CSP). A member who only ever signed in by text must use their email in the app. |
| Land on the page you asked for after signing in (`?next=`) | `proxy.ts:63-68`, `lib/safe-next` | none | Missing | The app's guard sends a signed-out visitor to `/signin` and then always to `/home` (`router.tsx:30-37`, `SignIn.tsx:44`). A link such as `/inbox/12` or `/arena?join=…` opened signed out loses its target. Matters once emails point at the app. |
| First sign-in: name step | `app/login/details/page.tsx`, `components/profile/DetailsForm.tsx` | `screens/Welcome.tsx` (`/welcome`) | Partial | Web asks name and, optionally, phone. App asks name only. |
| Sign out (this device) | `components/profile/AccountSections.tsx` (AppCard), header menu in `ProfileShell.tsx` | `screens/Settings.tsx` | Same | |
| Sign out everywhere | `AccountSections.tsx` → `/api/auth/logout?all=1` | `screens/Settings.tsx` → `auth.logout {all:true}` | Same | Both delete every `player_sessions` row of the person, so each signs the other out too. |
| Stay signed in for 90 days | `lib/player-auth.ts:12,42-50,77-83` | `lib/app-api.ts:98-110` | Same | Web: the cookie itself lasts 90 days from sign-in and is never re-issued, so the browser drops it then even if used daily. App: the token slides and never ends while used. |
| Admin's fresh sign-in (12 hours) | `/login?stepup=1` | `screens/settings/ClubAdmin.tsx` (code typed in place) | Same | |

### Me / Home

| Feature | Website (file) | App (file) | State | Note |
|---|---|---|---|---|
| Header: picture, name, membership pill | `components/profile/me/MeHeader.tsx` | `screens/Profile.tsx` (Head), `components/Greeting.tsx` | Same | In the app the pill is on My profile (picture, top right); Home has a greeting. |
| Next up, with "Can't make it" and undo | `me/NextUpCard.tsx` → `/api/profile/absence` | `screens/me/NextUp.tsx` → `me.absence` | Same | App also queues it offline (`lib/queue.ts`). |
| Membership card (status, days left, renews/ends) | `membership/MembershipCard.tsx` | `screens/me/Membership.tsx`, `screens/membership/ManageCard.tsx` | Same | App: summary on Home/My profile, "Manage" opens `/membership`. |
| "Payment failed" / "ending soon" alert on Home | status label only | `screens/me/MembershipAlert.tsx` | App only | |
| Join a membership (plan, day, card, auto-renew) | `membership/JoinPanel.tsx` → `/api/create-subscription` | `screens/membership/JoinPanel.tsx` → `membership.join` | Same | |
| Renew, and turn on auto-renew | `MembershipCard.tsx` → `/api/profile/membership/action` (renew, autorenew_setup, autorenew_confirm) | `ManageCard.tsx` → `membership.action` | Same | |
| Change plan or day; cancel a pending change | same route (change, cancel_change) | `ManageCard.tsx` | Same | |
| Cancel (leave flow with reasons and alternatives); resume | `membership/LeaveFlow.tsx` (cancel, resume) | `screens/membership/LeaveFlow.tsx` | Same | "Message us instead" goes to `/profile?inbox=1` on web, `/inbox/new` in the app. |
| Billing history and receipts | `/api/profile/membership/billing` | `membership.billing` | Same | Receipts open Stripe's page in both. |
| Update card (Stripe portal) | `/api/profile/membership/portal` (returns to `/profile?card=updated`) | `membership.portal` (returns to the app's `/membership?card=updated`, `lib/app-membership.ts:123`) | Same | |
| Play calendar; book a casual spot by card | `membership/PlayCalendar.tsx` → `/api/create-payment-intent` | `screens/me/PlayCalendar.tsx` → `play.book` | Same | |
| Shop: order by card or cash, confirm, cancel, my orders | `shop/ShopSection.tsx` → `/api/profile/shop/order…` | `screens/shop/ShopSection.tsx` → `shop.*` | Partial | App lacks the **size guide** (the API already sends `sizeChartMen/Women`, `packages/api/src/schemas.ts:665-666`) and the **full-screen photo viewer** (swipe, zoom). Photos are shown inline only. |
| Inbox: bell with unread count, preview, list, read, reply, new message | `me/MeHeader.tsx`, `me/InboxPreview.tsx`, `MessagesPanel.tsx` → `/api/profile/messages…` | `screens/Shell.tsx` (bell), `screens/me/Inbox.tsx`, `screens/Inbox.tsx` (`/inbox`, `/inbox/new`, `/inbox/$id`) | Same | Web opens a sheet on `/profile`; the app has its own pages. |
| Welcome card (dismiss) | `AccountSections.tsx` WelcomeCard → `/api/profile/event` | `screens/me/Welcome.tsx` → `account.dismissWelcome` | Same | |
| My photos (upload, consent, delete) | `player/PhotosPanel.tsx` → `/api/profile/photos…` | `screens/me/Photos.tsx` → `photos.*` | Same | Handoff note: a real upload from the app to the photo store has not been tried on a deployment with the store connected. |
| Club admin button | `MeHeader.tsx` ClubAdminButton, `me/SettingsAdminCard.tsx` (plain link to `/admin`, same cookie) | `screens/settings/ClubAdmin.tsx` (single-use link, opens the website's admin) | Same | From the website's admin, "My profile" goes back to the website's `/profile` (`components/admin/shell/AdminShell.tsx:107`), not the app. |
| Red count on the Arena tab (a score to confirm, a team-up request) | `lib/profile-badges.ts`, `ProfileShell.tsx` | none (`screens/Shell.tsx` has only the inbox bell's count) | Missing | Unread messages are covered by the bell. |
| "Your match is on" pill on other tabs | `ProfileShell.tsx` MatchPill | `screens/Shell.tsx`, `screens/arena/versus-store.ts` | Same | |
| Link back to the club's website | `ProfileShell.tsx` ("Back to site", "View site") | none (`webHref` in `screens/me/parts.tsx` is unused) | Missing | Minor. **Built, 28 Nov (lane N).** |
| Pull down to refresh (installed web app) | `ProfileShell.tsx` usePullToRefresh | none | Missing | Minor; the app refetches on its own. |

### Player, Arena, Leaderboard, Vision

| Feature | Website (file) | App (file) | State | Note |
|---|---|---|---|---|
| Player: rank card, stats, charts, rank ladder | `app/profile/player/page.tsx`, `components/profile/player/PlayerStatsView.tsx`, `components/arena/RankCard.tsx`, `RankLadder.tsx` | `screens/Player.tsx`, `screens/player/*` | Same | |
| Arena: pair up (QR, scan, code), challenges, scores, feed, versus screen, match stats, rank-up | `app/profile/arena/page.tsx`, `components/arena/ArenaView.tsx`, `MatchStatsModal.tsx` → `/api/arena…` | `screens/Arena.tsx`, `screens/arena/*` → `arena.*` | Same | Invite links carry their own address: web makes `www…/profile/arena?join=CODE` (`ArenaView.tsx:748`), the app makes `app.luvallplay.com/arena?join=CODE` (`arena/TeamUp.tsx:25`). The app's in-app scanner accepts either; a phone's own camera opens whichever site made the code, where the partner may not be signed in. |
| Leaderboard: board by source and period, own rank when hidden, player card with "Challenge" | `app/profile/leaderboard/page.tsx`, `components/leaderboard/LeaderboardView.tsx`, `components/arena/PlayerCardSheet.tsx` | `screens/Leaderboard.tsx`, `screens/leaderboard/*` | Same | Web keeps the chosen board in the address (`?source=&period=…`); the app does not, so a shared link opens the default board. |
| Vision: tracker (live, upload), free trial, buy a pass, share stats by email | `app/profile/wolf-vision/page.tsx`, `components/match-analyzer/*` (the shared `packages/vision`) | `screens/Vision.tsx` (`/vision`), `screens/VisionTrack.tsx` (`/vision/track`) | Same | Same engine. The app adds a start page; its words say "Player 1 / Pair A" until migration 0013 runs in production (handoff §1a). Pass checkout returns to the app's `/vision…` (`lib/app-vision.ts:85`). |
| Vision labelling tool | `app/profile/wolf-vision/label/page.tsx` | `screens/VisionLabel.tsx` (`/vision/label`) | Same | |

### Settings

| Feature | Website (file) | App (file) | State | Note |
|---|---|---|---|---|
| Profile picture: add, change, remove | `components/profile/AvatarCard.tsx` → `/api/profile/avatar` | `screens/settings/Account.tsx` (Photo) → `account.photo` | Same | |
| Name and display name | `AccountSections.tsx` DetailsCard → `/api/profile/details` | `Account.tsx` (Details) → `account.details` | Same | |
| Add or change the phone number | DetailsCard (phone field), `/api/profile/details` | shown read-only (`Account.tsx`, "facts" list) | Missing | Owner's decision (native app). Also true for a brand-new account: no way to add a number in the app. |
| Confirm the phone number by text | `AccountSections.tsx` PhoneCard → `/api/auth/sms/*` (`purpose: "phone_confirm"`) | none (shows "confirmed" / "not confirmed") | Missing | Same decision. |
| Language (English, Tiếng Việt), saved on the account | DetailsCard select | `screens/Settings.tsx` → `account.language` | Same | |
| Leaderboard visibility | PrivacyCard → `/api/profile/privacy` | `Account.tsx` (Privacy) → `account.privacy` | Same | |
| Download my data | `/api/profile/export` | `Account.tsx` (YourData) → `account.export` | Same | |
| Delete my account (type DELETE) | PrivacyCard → `/api/profile/delete` | `Account.tsx` → `account.delete` | Same | |
| Connected apps: access keys, webhooks, MCP and calendar addresses | `player/ConnectedApps.tsx` → `/api/profile/integrations/*` | `screens/settings/ConnectedApps.tsx` → `integrations.*` | Same | |
| Add to home screen | `components/profile/InstallGuide.tsx` (step-by-step per browser, shown once automatically), AppCard | `screens/settings/Install.tsx`, `lib/install.ts` | Partial | App: the browser's own prompt, or one line of text on iPhone; no guided steps, never shown automatically. The website also records installs (`/api/profile/event`), which admin's Players page shows as "App on home screen"; the app records nothing. |
| Light / dark appearance | none | `screens/Settings.tsx` | App only | |
| Works offline (saved screens, queued "Can't make it") | offline page only (`public/sw.js`) | `lib/offline.ts`, `lib/queue.ts`, `sw/sw.js` | App only | |
| Several clubs in one place | none | `screens/me/Home.tsx`, `lib/nav.ts` | App only | |
| "Get the app" offer (store apps, when live) | none | `components/GetTheApp.tsx` | App only | Off until store links are set. |

### Counts

Same 32 · Partial 3 · Missing 8 · App only 5 (48 rows).

**Missing:** one-tap sign-in button; text-message sign-in; return to the asked-for page after sign-in; add/change phone; confirm phone by text; Arena tab count; link to the club's website; pull to refresh.
**Partial:** first sign-in step (no phone); shop (no size guide, no photo viewer); add to home screen (no guide, installs not recorded).

### Website entry points that lead into `/profile` or need its session (not part of `/profile`)

| Entry point | File | What it does today |
|---|---|---|
| Header "My profile" / "Sign up / Sign in" | `components/Navigation.tsx:15,27` | Reads the `tw_signed_in` hint cookie; links to `/profile` or `/login`. |
| Footer "Cancel membership" | `components/Footer.tsx:90` | Links to `/profile`. |
| Home page "app features" block | `components/AppFeatures.tsx:179` | Links to `/login` (lands on `/profile`). |
| Public booking modal | `components/modals/BookingModal.tsx:66,210,304` | Reads `/api/profile/me` with the web cookie to prefill; offers "sign in" and "create my account" → `/login?…next=/profile`. |
| Public join modal | `components/modals/MembershipModal.tsx:109,270,307,549` | Same prefill; saves details via `/api/profile/details`; sends a sign-in code with `next: "/profile"`. |
| Public join and casual payment routes | `app/api/create-subscription/route.ts:42`, `app/api/create-payment-intent/route.ts:35` | Use the web cookie when present. |
| Home page leaderboard teaser | `components/leaderboard/LeaderboardTeaser.tsx:51` | `/login?next=/profile/arena?tab=leaderboard`. |
| `/leaderboard` | `lib/redirects.ts:34-35` | Signed in (cookie) → `/profile/leaderboard`; else → `/#leaderboard`. |
| `/challenges` | `app/challenges/page.tsx:5` | → `/profile/arena`. |
| `/match-analyzer`, `/match-analyzer/label` | `lib/redirects.ts:26-27` | → `/profile/wolf-vision…`. |
| `/cancel-membership/confirm` | `app/cancel-membership/confirm/page.tsx:6` | → `/login?next=/profile`. |
| `/login` with no `next` | `packages/core/src/safe-next.ts:7` | Default landing after any website sign-in is `/profile`. |
| Admin console | `components/admin/shell/AdminShell.tsx:107`, `proxy.ts:94`, `app/admin/(console)/page.tsx:75` | "My profile" link, the "no admin access" page, and a redirect all go to `/profile`. Admin itself runs on the web cookie. |
| Installed home-screen web app | `app/manifest.ts:10-11,26-28` | Opens `/profile?source=homescreen`; shortcuts to `/profile`, `/profile/player`, `/profile/leaderboard`. Scope is `/`. |
| Proxy guard | `proxy.ts:24-25,63-68,185` | `/profile…` without a `tw_player` cookie → `/login?next=<path>`. |
| Module map | `packages/modules/src/routes.ts:25-28`, `registry.ts:52,253,266` | Which module owns each `/profile…` path (used to hide switched-off modules). |

The website session cannot simply go away with `/profile`: the public join and booking flows, and all of admin, still use the `tw_player` cookie.

## 3. What the gaps mean, and what to do about each

### Before the cutover (blocking)

| # | Gap | Why it blocks | Proposed fix | Needs the owner's OK to merge |
|---|---|---|---|---|
| B1 | **The app sends no bot-check (Turnstile) token.** The app's "send my code" route refuses with `captcha` whenever `TURNSTILE_SECRET_KEY` is set on the website's deployment (`app/api/v1/app/auth/email/start/route.ts:11`). | **Checked 25 Nov: the key is not set in production, so app sign-in works today.** It would stop the day the key is set (and lane H's "fail closed in production" work would do the same), so the app must send a token first. | Add the Turnstile widget to the app's sign-in (its script and frame hosts added to the app's Content-Security-Policy), sending the token the route already accepts. The route is unchanged. | Yes (sign-in) **Built, 28 Nov (lane N):** `components/Turnstile.tsx`, on with `VITE_TURNSTILE_SITE_KEY` at build (CSP hosts added only then); a fresh token for each code sent. **Before setting `TURNSTILE_SECRET_KEY`:** add the app's hostnames to the site key in Cloudflare and try sign-in in a browser *and* in both store apps (their pages run at `https://localhost` and `capacitor://localhost`); not yet tried against Cloudflare. |
| B2 | **Session handover** (§4.1): a member signed in on the website must arrive in the app signed in. | Without it, everyone is asked for a code on cutover day. | A website route that makes a 60-second single-use token and sends the browser to the app; an app endpoint that swaps it for an app session. | Yes (sign-in, new website route) **Built, 28 Nov (lane N), off:** option (a) (`admin_handoffs`, no migration). Website `/app-handover?to=`, app `/handover`, endpoint `auth.handover`; tested on Postgres. On when `PLAYER_APP_URL` is set; pointing `/profile` at it is step 3. |
| B3 | **A link opened signed out loses its target** (the app always lands on Home after sign-in). | Email links such as "the club replied" would open Home, not the message. | `/signin?next=<path>` in the app, with the same safe-path rule as the website. | Yes (sign-in) **Built, 28 Nov (lane N).** |
| B4 | **Emails link to the website's `/profile`**, also for things done in the app. | After the redirect they still work (through the handover), but each costs a hop, and the app's own sign-in email offers a button that signs in on the website instead. | One setting, the players' app address (`PLAYER_APP_URL`): when set, player emails link to the app; when unset, today's links. The one-tap button is left out of app sign-in emails. Email files are lane A's: a small `[lane N]` pull request through the coordinator. | Yes (emails, production setting) **Built, 28 Nov (lane N), off:** `lib/player-links.ts`; with `PLAYER_APP_URL` set, the club's reply opens `/inbox/<id>`, the renewal reminder `/membership`, the casual booking's "create my account" the app's sign-in, and the app's code email has no website button. Unset: every email as today (tested on the rendered emails). One commit of its own, so lane A's coordinator can take it separately. |
| B5 | ~~Members who sign in by text only.~~ **Cleared, 25 Nov.** | Lane T counted on production (read-only): 19 live accounts, 16 with a phone (6 confirmed), and **none with a phone but no usable email**. Everyone can sign in to the app with an email code. | Nothing to do. Text-message sign-in still comes with the store apps. | — |
| B6 | **A real photo upload from the app** has never been tried against the real photo store (handoff §1a). | It may fail for every member. | Try one photo on a preview with the store connected. | No (a test) |
| B7 | **Migration `0013`** (the club's words for a player and a pair) is approved but not run. | Until then the app's tracker says "Player 1 / Pair A" where the website says "Wolf 1 / Pack A". | Lane T runs it (already booked). | Lane T |

### Small gaps (not blocking; fix in the app before or just after)

| Gap | Proposal |
|---|---|
| Red count on the Arena tab (a score to confirm, a team-up request) | Add it to the app's tab (the data is in `arena.state`). Before cutover if time allows: it is the one thing members would notice daily. **Built, 28 Nov (lane N).** |
| Shop: size guide and full-screen photos | Add both (the API already sends the size charts). **Built, 28 Nov (lane N).** |
| Link back to the club's website | One row in My profile. **Built, 28 Nov (lane N).** |
| Leaderboard: the chosen board isn't in the address | Put it in the address, so shared links open the same board. **Built, 28 Nov (lane N).** |
| Arena invite codes made on the website open the website | Covered by the `/profile/arena?join=` redirect (§6). |
| Pull to refresh | Leave: the app refreshes itself. The store apps get the native gesture. |
| "Add to home screen" guide, and recording installs for admin | Leave: the store apps replace home-screen installs. Tell admin the "App on home screen" column stops counting. |
| First sign-in asks for a name but not a phone; adding or changing a phone; confirming it by text | With the store apps (the owner's decision of 25 Nov). Until then the app shows the number read-only, and the public join form still collects it. |

## 4. The cutover plan

Each numbered step is a separate, reversible action, and **each is asked of the owner before it happens.**

### 4.1 The one-time session handover

Why it is needed: the website keeps its session in a cookie that only the club's domain can read; the app keeps its own token on `app.luvallplay.com`. Neither side can see the other's (§5).

How it works (the admin handoff of Phase 1, mirrored):

1. A member opens any `/profile…` address on the club's website (a bookmark, an old email, the header's "My profile", the installed home-screen copy).
2. **Signed in on the website:** the website makes a random token, stores only its hash with a 60-second life, and sends the browser to `https://app.luvallplay.com/handover#t=<token>&to=<screen>`. The token is in the part of the address after `#`, which browsers never send to a server or put in a referrer; the answer is `no-store`.
3. The app's `/handover` screen:
   - **already signed in to the app:** the token is ignored (never replaces a session), and the screen opens;
   - otherwise it sends the token once to a new endpoint (`auth.handover`), gets an app session for the same person, removes the token from the address, and opens the screen.
4. **Not signed in on the website, or the token is refused** (used, older than 60 seconds): the app's sign-in opens with `next=<screen>`, so after the code they land where they were going.

Rules:

- The token works once, for 60 seconds, for one person, and is useless at `/admin/handoff` (and an admin's token is useless here).
- The new app session keeps the **sign-in time of the website session** it came from, so a handover never counts as a fresh sign-in for admin's 12-hour check.
- The website session is left as it is (admin and the public forms use it). Signing out everywhere still ends both.
- Members whose website cookie has lapsed (it lasts 90 days from sign-in) have nothing to hand over: they get the app's sign-in. That is the same code email they know.
- Audit rows: handover made, handover used (as the admin handoff has).

Where the token is stored, to decide with the coordinator: **(a)** the existing `admin_handoffs` table with the hash made over a different prefix, so the two kinds can never be swapped (no migration, no production data step); or **(b)** a new `app_handoffs` table (clean name; a migration through the queue and a production step). Recommended: (a) now, (b) folded into a later migration if wanted.

### 4.2 Steps

| Step | What happens | Who sees a change | Undo |
|---|---|---|---|
| **0. Fixes** | B1 to B7 above, and this branch's audit fixes, merged and live. The handover, `next` and the email setting are merged **switched off** (`PLAYER_APP_URL` unset: the website behaves exactly as today). | Nobody | Revert the pull requests |
| **1. Rehearsal** | On a preview of the website pointed at a preview of the app: sign in on the website, open every address in §6's mapping, arrive signed in on the right screen. Signed out, expired token, token used twice, already signed in to the app as someone else, an admin (no fresh sign-in gained). Journeys added to CI for each. | Nobody | — |
| **2. Pilot** | In production, the handover is reachable only through a special link (`/profile?app=1`). The owner and a few members the owner picks use the app for some days. | The pilot group | Stop using the link |
| **3. Cutover** | `PLAYER_APP_URL` is set on the website's production deployment. From that moment `/profile…` sends members to the app (through the handover), emails link to the app, and the website's header says "Open the app". A short message to members beforehand (the owner's words; a draft is offered). | Every member | Unset `PLAYER_APP_URL` and redeploy: the website's pages are still there and work on the same data. Nothing a member did in the app is lost. |
| **4. Freeze (AO)** | From the cutover, `apps/web/app/profile/**` and `components/profile/**` get fixes only. A CI check fails a pull request that adds a file there. | Nobody | — |
| **5. Watch for two quiet weeks** | "Quiet" means, each day: no rise in sign-in codes sent or failed, no handover failures beyond expired links, no member messages about the app that point to a missing feature, error reports (Sentry, lane H) flat. Reported to the owner at the end of each week. | Nobody | Step 3's undo still works |
| **6. Retire** | The `/profile` pages and the `/api/profile/*` routes only they use are removed; the redirects stay (emails already sent keep old links for years). §6 lists what must stay. | Nobody (they've been redirected for two weeks) | Revert the pull request |

Best day for step 3: a day with no play session, in the morning (NZ), so a problem shows before the evening.

### 4.3 What is not part of the cutover

- The store apps (Phase 5). Members use `app.luvallplay.com` in the browser or on the home screen until then.
- Members who installed the **website** on their home screen: that copy opens `/profile`, which will redirect and so open the app in a browser tab. The message to members should say "open app.luvallplay.com and add it to your home screen" (the app's own Install card does this).
- Text-message sign-in and phone changes (with the store apps).

## 5. Session facts the handover is built on

**One table, two carriers.**
- A session is a row in `player_sessions`: `player_id, token_hash (unique), user_agent, created_at, last_seen_at, expires_at` (`packages/db/schema.ts:642-656`).
- The token is 32 random bytes, base64url (`apps/web/lib/player-auth.ts:57`). Only its SHA-256 is stored (`player-auth.ts:29-31,58-62`); the server cannot recover a token from a row.
- Website: the token is in the httpOnly cookie `tw_player` (`player-auth.ts:11`), `secure`, `SameSite=Lax`, path `/`, no `Domain` (so only the host that set it), max-age 90 days (`player-auth.ts:42-50`). A second readable cookie `tw_signed_in=1` only tells the header someone is signed in (`lib/player-cookies.ts:4-13`).
- App: the same kind of token, returned as JSON by `auth.emailVerify` (`app/api/v1/app/auth/email/verify/route.ts:17-18`, via `lib/app-api-session.ts:6-10` → `createPlayerSession`), kept in `localStorage` as `lp.token` (`apps/app/src/lib/storage.ts:22`, `lib/store.ts:28`) and sent as `Authorization: Bearer …` (`packages/api/src/client.ts:88`). The app's requests omit cookies (`client.ts:109`).
- The app API accepts either carrier: bearer first, then the cookie (`lib/app-api.ts:87-94`), both resolved by `sessionForToken` (`player-auth.ts:92-103`). A bearer starting `tw_` is an access key, not a session (`app-api.ts:90-91`).
- **Can a cookie and a bearer be the same row?** Technically yes: the lookup is by token hash only and does not record how the token arrived. But the website's page scripts cannot read the httpOnly cookie, so the only way to reuse the row is for a server route to read the cookie and hand its value to the app, which puts a 90-day secret in a URL or page. The existing admin handoff avoids that: it passes a 60-second single-use token and creates a **new** session row on the other side. Mirroring that gives the app its own row and leaves the website's cookie session untouched.

**Lifetime.**
- 90 days, sliding: on use, at most once an hour, `expires_at` moves to now + 90 days (website pages: `player-auth.ts:13,77-83`; app API: `app-api.ts:26,103-108` with `lib/repos/sessions.ts:11-16`).
- The website cookie's own 90-day age is set only at sign-in (`setPlayerCookies` is called only from the sign-in routes and `/admin/handoff`), so the browser drops it 90 days after sign-in. Members whose cookie has already lapsed have nothing to hand over and will sign in to the app with a code.
- `created_at` is the sign-in time; admin step-up needs it within 12 hours (`packages/auth/src/index.ts:14,70-74`). **A handover that calls `createPlayerSession` makes a row with `created_at = now`, which would count as a fresh sign-in for admin.** The admin handoff wants that; a member handover probably should not (carry the old session's `created_at`, or accept it knowingly).
- A website sign-in ends the session the device had (`endSessionFromRequest`, `app/api/auth/email/verify/route.ts:33`, `email/link/route.ts:15`). An app sign-in ends nothing (`app/api/v1/app/auth/email/verify/route.ts:7-8`).
- Sign out: this session (`endPlayerSession`, `player-auth.ts:123-126`) or all of the person's (`endAllPlayerSessions`, `:143-145`); `auth.logout` also clears the web cookies when it was called with them (`app/api/v1/app/auth/logout/route.ts:13-18`). Deleting the account ends every session.
- The app signs itself out on any 401 from a session endpoint (`apps/app/src/app.ts:22`, `client.ts:130`).

**Why the handover must be a page navigation, not a background call.**
- The cookie is `SameSite=Lax` and host-only on the club's domain; the app is on `app.luvallplay.com`, a different site. A `fetch` from the app never carries it (and the app sends `credentials: "omit"`). A top-level GET to the website does carry it.
- CORS already allows `https://app.luvallplay.com` with credentials (`lib/app-api.ts:30-50`), and a cookie-authenticated write from an allowed origin passes the origin check (`app-api.ts:117-126,197`), but with Lax that cookie does not arrive from the app's origin.
- The app's CSP has `form-action 'self'` and a fixed `connect-src` (`apps/app/vite.config.ts:43-55`); the API host is already allowed.
- The app has no route for arriving with a token, and no "go here after sign-in" (`apps/app/src/router.tsx:10-37`). Both would be new.

**The existing admin handoff (app → website), to mirror in the other direction.**
- Table `admin_handoffs`: `token_hash (unique), player_id, created_at, expires_at, used_at` (`apps/web/scripts/migrations/2026-11-phase1-admin-roles.sql:66-73`, `packages/db/schema.ts:34-48`).
- Create: `createHandoff(db, playerId)` makes 32 random bytes, stores the SHA-256 with `expires_at = now + 60 s`, deletes rows expired more than a day ago, returns the raw token (`lib/admin-roles.ts:54,441-450`).
- Use: `consumeHandoff(db, token)` is one `UPDATE … SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING player_id`, so only one request wins (`lib/admin-roles.ts:453-462`).
- App side: `account.adminHandoff` (`packages/api/src/contract.ts:150-154`, response `{ url, expiresInSeconds }` in `schemas.ts:394-397`), route `app/api/v1/app/account/admin-handoff/route.ts`, logic `adminHandoff()` in `lib/app-account.ts:63-72` (admin role, sign-in within 12 h else 403 `step_up`, audit `admin.handoff_created`, URL `/admin/handoff?token=…`). The app calls it from `apps/app/src/screens/settings/ClubAdmin.tsx` and does `window.location.assign(url)`.
- Website side: `GET /admin/handoff` (`app/admin/handoff/route.ts:14-34`) consumes the token, re-checks the player and role, calls `createPlayerSession`, sets the cookies, sends `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, audits `admin.handoff_used`, and redirects to `/admin`; any failure goes to `/login?next=/admin`. The proxy lets `/admin/handoff` and `/api/admin/handoff` through without a cookie (`proxy.ts:70-71`).
- An older twin for a cookie or bearer caller: `POST /api/admin/handoff` (`app/api/admin/handoff/route.ts`).

**What a mirrored member handover would need (facts, not a design).**
- A website route under the cookie (top-level GET, for example reached by the `/profile` redirect) that mints a short single-use token for `player.id` and redirects to the app with it. `admin_handoffs` has the right shape but its name and audit trail are admin's; a new table or a `purpose` column is a migration (data protocol, owner's OK).
- A public app API endpoint that swaps that token for `{ token, expiresAt }` like `auth.emailVerify` (`newAppSession`), plus a contract entry, generated client and snapshot.
- An app route that reads the token, stores `lp.token`, removes the token from the address, and continues to the mapped screen.
- Decide: keep or end the website session after handover (admin and the public join/booking flows still use it); whether the new row keeps the old `created_at`; what a member with an existing app token sees (do not replace it).
- Sign-in routes and `apps/web` pages are "ask the owner before merging" (handoff §5).

## 6. Links to change at cutover

App routes are from `apps/app/src/router.tsx`: `/home`, `/profile` (My profile; `#settings`), `/player`, `/arena`, `/leaderboard`, `/vision`, `/vision/track`, `/vision/label`, `/inbox`, `/inbox/new`, `/inbox/$id`, `/membership`, `/welcome`, `/signin`, `/c/$club`; `/me` → `/home`, `/settings` → `/profile#settings`.

### Path mapping

| Website path | App route | Note |
|---|---|---|
| `/profile` | `/home` | The app's `/profile` is a different screen (My profile). |
| `/profile?source=homescreen` | `/home` | Installed web app's start address. |
| `/profile?thread=<id>` | `/inbox/<id>` | With several clubs add `?club=<slug>`. |
| `/profile?inbox=1` | `/inbox` | |
| `/profile?card=updated` | `/membership?card=updated` | Stripe portal return for portals opened from the website. |
| `/profile#shop` | `/home` | The app's shop section has no `id="shop"`, so there is nothing to scroll to. |
| `/profile/settings` | `/profile#settings` (or `/settings`) | |
| `/profile/player` | `/player` | |
| `/profile/arena` | `/arena` | |
| `/profile/arena?join=<code>` | `/arena?join=<code>` | Handled (`screens/Arena.tsx:41`). |
| `/profile/arena?vs=<id>` | `/arena?vs=<id>` | Handled (`Arena.tsx:53`). |
| `/profile/arena?tab=leaderboard` | `/leaderboard` | Web already redirects this to `/profile/leaderboard`. |
| `/profile/arena?tab=ranks` | `/player` | |
| `/profile/leaderboard` (`?source=&period=…`, `?hidden=1`) | `/leaderboard` | The app ignores the query. |
| `/profile/wolf-vision` | `/vision/track` | Web opens the tracker directly; the app's `/vision` is a start page. |
| `/profile/wolf-vision?challenge=<id>` | `/vision/track?challenge=<id>` | `/vision?challenge=<id>` also works. |
| `/profile/wolf-vision?wv_paid=…&session_id=…` | `/vision/track?wv_paid=…&session_id=…` | Return from a pass bought on the website; the tracker reads both (`packages/vision/src/ui/MatchAnalyzer.tsx:170-171`). |
| `/profile/wolf-vision?demo=1` | `/vision/track?demo=1` | |
| `/profile/wolf-vision/label` | `/vision/label` | |
| `/profile/account`, `/profile/membership`, `/profile/me` | `/home` (membership: `/membership`) | Old paths, today redirected to `/profile` (`lib/redirects.ts:29-31`). |
| `/login`, `/login?email=…&next=/profile` | `/signin` | The app's sign-in takes no `email` or `next`. |
| `/login/details` | `/welcome` | |

A link opened signed out in the app goes to `/signin` and then `/home`; the target is lost (see checklist).

### Emails

| File:line | Email | Link today | Should become |
|---|---|---|---|
| `apps/web/lib/message-notify.ts:39` | Club replied to your message | `/profile?thread=<id>` | app `/inbox/<id>` |
| `apps/web/lib/shop-notify.ts:36` | Shop order paid / reserved | `/profile#shop` | app `/home` |
| `apps/web/lib/shop-notify.ts:75` | Shop reservation ends soon | `/profile#shop` | app `/home` |
| `apps/web/lib/shop-notify.ts:93` | Shop reservation ended | `/profile#shop` | app `/home` |
| `apps/web/lib/membership-self-service.ts:377` | Auto-renew turned off | `/profile` | app `/membership` |
| `apps/web/lib/membership-renewal.ts:25` (used at `:55`; button in `lib/email.ts:753`) | Renewal reminder | `/login?email=…&next=/profile` | app `/membership` |
| `apps/web/lib/email.ts:415` (button `:421`, text `:429`) | Casual booking confirmed: "Create my account" | `/login?email=…&next=/profile` | app `/signin` |
| `apps/web/lib/welcome-email-template.ts:21` (button `:82`, text `:261`) | Welcome: "Open my profile" | `/login?email=…` | app `/signin` |
| `apps/web/lib/welcome-email-template.ts:159` | Welcome: club leaderboard | `/leaderboard` | app `/leaderboard` (or leave: public teaser) |
| `apps/web/lib/welcome-emails.ts:20` | Welcome: "hide me" one-click | `/api/profile/leaderboard-optout?token=…` → `/?hidden=1#leaderboard` | Keep the route when `/api/profile/*` is retired. |
| `apps/web/lib/wolf-vision-email.ts:59` (button `:148`) | Vision stats shared with you: join | `/login` | app `/signin` |
| `apps/web/app/api/auth/email/start/route.ts:29-30` | Website sign-in code: one-tap button | `/api/auth/email/link?token=…&next=<next>` | Stays for website sign-ins (admin, public join); its default `next` is `/profile`. |
| `apps/web/app/api/v1/app/auth/email/start/route.ts:15` | **App** sign-in code: one-tap button | `/api/auth/email/link?…&next=/profile` (signs in on the website) | Drop the button for app codes, or make it open the app. |
| `apps/web/lib/player-email.ts:103,126` | (where every `cta.path` above becomes `getSiteUrl() + path`) | website base | Needs an app base address for player links. |

The same emails are sent when the action was done in the app (the app's server code reuses these functions), so app users already receive links to the website's `/profile`.
Emails already sent keep their old links, so `/profile…` redirects must stay for a long time.

### Website pages, redirects and settings

| File:line | What | Today | At cutover |
|---|---|---|---|
| `apps/web/components/Navigation.tsx:27` | Header account link | `/profile` or `/login` | app `/home` (or the handover address) / app `/signin` |
| `apps/web/components/Footer.tsx:90` | "Cancel membership" | `/profile` | app `/membership` |
| `apps/web/components/AppFeatures.tsx:179` | Home page app block | `/login` | app `/signin` |
| `apps/web/components/modals/BookingModal.tsx:210` | "Sign in to prefill" | `/login?next=/profile` | Keep on the website if the modal keeps using the web session (then `next` should return to the page, not `/profile`). |
| `apps/web/components/modals/BookingModal.tsx:304` | "Create my account" after booking | `/login?email=…&next=/profile` | app `/signin` |
| `apps/web/components/modals/MembershipModal.tsx:307` | Sign-in code during public join | `next: "/profile"` | Decide where a new member lands (app `/home`). |
| `apps/web/components/modals/MembershipModal.tsx:549` | "Sign in to prefill" | `/login?next=/profile` | As BookingModal:210. |
| `apps/web/components/leaderboard/LeaderboardTeaser.tsx:51` | Home page teaser CTA | `/login?next=/profile/arena?tab=leaderboard` | app `/leaderboard` |
| `apps/web/components/leaderboard/LeaderboardView.tsx:59,238` | Board's base path and signed-out CTA | `/profile/leaderboard` | Goes with `/profile`. |
| `apps/web/components/arena/ArenaView.tsx:579,1435` | Signed-out "sign in" in the Arena | `/login?next=/profile/arena` | Goes with `/profile`. |
| `apps/web/components/arena/ArenaView.tsx:748` | Pair invite QR/link | `<site>/profile/arena?join=<code>` | Codes last minutes; redirect to app `/arena?join=<code>`. |
| `apps/web/components/arena/ArenaView.tsx:1306,1313,1509` | Arena → Vision for a challenge | `/profile/wolf-vision?challenge=<id>` | Goes with `/profile`. |
| `apps/web/components/arena/ArenaView.tsx:1991` | Rank-up share link | `<site>/challenges` | `/challenges` must then lead to app `/arena`. |
| `apps/web/components/arena/PlayerCardSheet.tsx:60,85` | Player card "Challenge" | `/profile/arena?vs=<id>`, `/profile/arena` | Goes with `/profile`. |
| `apps/web/components/match-analyzer/host.tsx:42-45` | Tracker's links (arena, tracker, label, sign in) | `/profile/arena`, `/profile/wolf-vision`, `/profile/wolf-vision/label`, `/login?next=…` | Goes with `/profile`. |
| `apps/web/components/profile/InstallGuide.tsx:206` | "Copy link" in the install guide | `<site>/profile` | Goes with `/profile`. |
| `apps/web/components/profile/membership/LeaveFlow.tsx:155` | "Message us" | `/profile?inbox=1` | Goes with `/profile`. |
| `apps/web/components/admin/shell/AdminShell.tsx:107` | Admin "My profile" | `/profile` | app `/home` |
| `apps/web/proxy.ts:94` | "No admin access" page link | `/profile` | app `/home` |
| `apps/web/app/admin/(console)/page.tsx:75` | Admin with no page to open | `redirect("/profile")` | app `/home` |
| `apps/web/app/admin/(console)/challenges/page.tsx:72` | Help text link | `/profile/arena` | app `/arena` |
| `apps/web/app/challenges/page.tsx:5` | `/challenges` | → `/profile/arena` | → app `/arena` |
| `apps/web/app/cancel-membership/confirm/page.tsx:6` | Old cancel link | → `/login?next=/profile` | → app `/membership` |
| `apps/web/lib/redirects.ts:26-27` | `/match-analyzer…` | → `/profile/wolf-vision…` | → app `/vision/track`, `/vision/label` |
| `apps/web/lib/redirects.ts:29-31` | `/profile/account`, `/membership`, `/me` | → `/profile` | → app |
| `apps/web/lib/redirects.ts:34` | `/leaderboard` signed in | → `/profile/leaderboard` | → app `/leaderboard` |
| `apps/web/proxy.ts:24-25,63-68,185` | `/profile…` guard | no cookie → `/login?next=…` | Becomes the redirect (with handover when a cookie is present). |
| `apps/web/app/profile/layout.tsx:25` | Layout guard | `/login?next=/profile` | Goes with `/profile`. |
| `packages/core/src/safe-next.ts:7` | Default after website sign-in | `/profile` | New default (admins: `/admin`; others: app). Used by `app/api/auth/email/{start,link,verify}` and `sms/verify`. |
| `apps/web/app/api/auth/logout/route.ts:23`, `components/profile/AccountSections.tsx:325` | After sign-out / delete | `/login?signed_out=1` | Fine while `/login` stays. |
| `apps/web/app/manifest.ts:10-11,26-28` | Installed web app | `id` and `start_url` `/profile…`, three shortcuts | Installed copies keep opening `/profile?source=homescreen`; the redirect leaves the installed app's scope, so it opens the app in a browser tab. Members need to install the new app. |
| `apps/web/components/profile/ProfileShell.tsx` (register `/sw.js`), `apps/web/public/sw.js` | Website service worker | Caches static files only; navigations go to the network | No stale `/profile` pages; nothing to unregister for the redirect to work. |
| `apps/web/app/api/profile/membership/portal/route.ts:10` | Card-update return (website) | `<site>/profile?card=updated` | Goes with `/profile`; portals already open return there. |
| `apps/web/lib/app-membership.ts:123` | Card-update return (app API, unknown origin) | falls back to `<site>/profile?card=updated` | Fallback should be the app. |
| `apps/web/app/api/wolf-vision/pass/route.ts:62,82-83` | Vision pass checkout return (website) | `<site>/profile/wolf-vision…?wv_paid=…` | Goes with `/profile`; checkouts in flight return there. |
| `apps/web/lib/app-vision.ts:85` | Vision pass return (app API, unknown origin) | falls back to `<site>/profile/wolf-vision` | Fallback should be the app. |
| `apps/web/components/profile/membership/JoinPanel.tsx:176`, `MembershipCard.tsx:398`, `PlayCalendar.tsx:195`, `shop/ShopSection.tsx:259` | Stripe card `return_url` | `/profile` | Goes with `/profile`; a 3-D Secure redirect in flight returns there. |
| `apps/web/app/admin/(console)/shop/page.tsx:119,155`, `lib/app-membership.ts:109`, `lib/photos-service.ts:135` | `revalidatePath("/profile…")` | cache refresh | Harmless; remove with `/profile`. |
| `packages/modules/src/routes.ts:25-28`, `packages/modules/src/registry.ts:52,253,266` | Module ownership of `/profile…` | used by the proxy and a test | Update with the routes. |
| `apps/web/next.config.ts:15` (comment and headers for `/profile/wolf-vision`) | Headers for the tracker page | website | Check when the page goes. |

Things that must **stay** on the website after `/profile` is retired: `/login` and the sign-in routes (admin, public join and booking), `/admin/handoff`, `/api/profile/leaderboard-optout` (welcome emails), `/api/profile/me` and `/api/profile/details` while the public modals use them, `/renew-membership?token=…` (old reminder links), and every `/api/v1/app/**` route.
