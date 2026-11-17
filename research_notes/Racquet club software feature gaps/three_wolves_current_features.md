# Three Wolves Badminton Club web app: current feature inventory and multi-tenant readiness

Scope: a codebase inventory of `/home/user/three-wolves-badminton` (Next.js 15 App Router on Vercel, Sanity CMS, Stripe, Neon/Vercel Postgres, Google Calendar, Resend, Firebase/Google Identity Platform SMS, Vercel Blob). All sources below are repository paths; "README" means `README.md` at the repo root. Git history has 77 commits, the latest dated 2026-11-17 (`git log`). Recent work has been gamification (Arena, Wolf Points), player accounts, and performance (moving the database to Sydney), per `git log --oneline` (commits #52 to #63).

## 1. Player and member features

### Takeaway
For one club running a few drop-in "play days" a week, the player side is well developed. It covers casual pay-per-session booking, recurring and one-time memberships with self-service, a waitlist, passwordless accounts, stats and streaks, a gamified points and rank system ("Arena" / Wolf Points), a public leaderboard, a photo gallery, a merch shop, and an installable PWA. Booking is per session date (a headcount against a capacity), not per court or time slot.

### Cited Findings
**Public site and content**
- The homepage is built from `Navigation`, `About`, `Membership` (pricing), `Gallery`, `Reviews`, `Donate` and `Footer` components inside a `SignupPauseProvider` — [app/page.tsx](app/page.tsx)
- Content is edited in Sanity Studio at `/studio`. Document types are `siteSettings` (phone, email, Google review URL, Facebook URL, stats), `hero`, `aboutSection`, `galleryImage`, `review`, `pricingPlan` (five fixed planIds) and `scheduleSettings` (venueName, address, timeLabel, session capacity, `bookingLockDays` default 14). All text fields are EN/VI `localeString`/`localeText` — [sanity/schema.ts](sanity/schema.ts), [app/studio/[[...tool]]/page.tsx](app/studio/[[...tool]]/page.tsx)
- The site is bilingual, English and Vietnamese only (`export type Lang = "en" | "vi"`), with separate i18n dictionaries for the site, profile, Arena and jersey — [lib/i18n.ts](lib/i18n.ts), [lib/profile-i18n.ts](lib/profile-i18n.ts), [lib/arena-i18n.ts](lib/arena-i18n.ts), [lib/jersey-i18n.ts](lib/jersey-i18n.ts), [context/LanguageContext.tsx](context/LanguageContext.tsx)
- Donations can be one-time or monthly, for a custom amount between $2 and $5,000 (`DONATION_MIN_CENTS = 200`, `DONATION_MAX_CENTS = 500000`) — [lib/constants.ts](lib/constants.ts), [app/api/create-donation-intent/route.ts](app/api/create-donation-intent/route.ts), [app/api/create-donation-subscription/route.ts](app/api/create-donation-subscription/route.ts), [components/modals/DonateModal.tsx](components/modals/DonateModal.tsx)
- Optional Cloudflare Turnstile bot protection on booking forms — [components/TurnstileWidget.tsx](components/TurnstileWidget.tsx), [.env.example](.env.example)

**Casual session booking**
- Bookable dates come from a single Google Calendar. Any event on it becomes a bookable play day, synced daily by cron — README; [lib/google-calendar.ts](lib/google-calendar.ts), [app/api/cron/sync-calendar/route.ts](app/api/cron/sync-calendar/route.ts), [vercel.json](vercel.json)
- Casual booking is a $10 card payment (Stripe PaymentIntent) for one session date. Booking opens `BOOKING_WINDOW_DAYS = 30` days ahead and closes at `BOOKING_CUTOFF_HOUR = 17` (5 PM club time) on the day — [lib/constants.ts](lib/constants.ts), [lib/dates.ts](lib/dates.ts), [lib/security.ts](lib/security.ts), [app/api/create-payment-intent/route.ts](app/api/create-payment-intent/route.ts), [components/modals/BookingModal.tsx](components/modals/BookingModal.tsx), [components/modals/SessionCalendarPicker.tsx](components/modals/SessionCalendarPicker.tsx)
  - The docs disagree with the code here. The README and DEPLOY.md describe a "14-day casual booking window (sessions closer than 14 days are locked)", and Sanity has `bookingLockDays` defaulting to 14, but the live constants in `lib/constants.ts` are a 30-day window and a 5 PM same-day cutoff — [README.md](README.md); contradicted by [lib/constants.ts](lib/constants.ts)
- A player account is optional for a casual booking. The route reads the player if one is signed in and otherwise proceeds (`getPlayerFromRequest(...).catch(() => null)`) — [app/api/create-payment-intent/route.ts](app/api/create-payment-intent/route.ts)
- Capacity is per date and derived from the number of courts booked: 1 court = 6 players, 2 = 12, 3 = 18, 4 = 22. Defaults are Friday 2 courts, Wednesday 1, casual-only days 1. Admins can change courts per date — [lib/constants.ts](lib/constants.ts) (`COURTS_TO_MAX_PLAYERS`, `MEMBERSHIP_DAY_DEFAULT_COURTS`)
- If a session is oversold because of a race, the Stripe webhook refunds the payment automatically and emails both the player and the admin. This is the only automatic refund path — [app/api/stripe-webhook/route.ts](app/api/stripe-webhook/route.ts) (`stripe.refunds.create`, `sendCasualBookingFullRefundEmail`), [lib/email.ts](lib/email.ts) (`sendAdminBookingRaceAlertEmail`)
- Sign-ups for any weekday can be paused (Wednesday is paused by default). Visitors on a paused day get a "Notify me" button, and a "Request another day" form lets anyone ask for a new weekday — [lib/day-requests.ts](lib/day-requests.ts), [lib/constants.ts](lib/constants.ts) (`DEFAULT_PAUSED_DAYS`), [components/modals/DayRequestModal.tsx](components/modals/DayRequestModal.tsx), [app/api/day-requests/route.ts](app/api/day-requests/route.ts), [context/SignupPauseContext.tsx](context/SignupPauseContext.tsx)

**Waitlist**
- The waitlist is per session date (name and email), stored in the `waitlist` table, with confirmation emails to the player and the admin — [app/api/waitlist/route.ts](app/api/waitlist/route.ts), [components/modals/WaitlistModal.tsx](components/modals/WaitlistModal.tsx), [lib/email.ts](lib/email.ts) (`sendWaitlistConfirmationEmail`, `sendWaitlistAdminAlertEmail`)
- The waitlist only sends notifications. It does not promote anyone automatically. When an admin action frees capacity, up to N people (one per open spot, oldest first) get a "spot open" email and still have to book and pay themselves — [lib/waitlist-notify.ts](lib/waitlist-notify.ts), [app/admin/play-days/page.tsx](app/admin/play-days/page.tsx) (`notifyWaitlistNow`)

**Memberships and subscriptions**
- There are four membership SKUs plus casual: Friday Monthly $33, Friday Quarterly $85, Wednesday Monthly $33, Wednesday Quarterly $85 (NZD). "Monthly" is a 4-week cycle and "quarterly" a 12-week cycle (Stripe `interval: week`, count 4 or 12) — [lib/constants.ts](lib/constants.ts) (`PRICES`, `MEMBERSHIP_CYCLE_DAYS`), [lib/pricing-plans.ts](lib/pricing-plans.ts), [scripts/stripe-setup.mjs](scripts/stripe-setup.mjs)
- A membership covers one weekday ("membership day": `friday` or `wednesday`). Members count toward every session on that weekday with no per-session RSVP — [lib/constants.ts](lib/constants.ts) (`MEMBERSHIP_ACCESS_DAYS`); README "Headcount alerts"
- A membership can auto-renew (a Stripe subscription) or be one-time (paid once by card, or a cash member added by an admin). A new membership's start date is set to the first play day with room, searching up to 90 days ahead, and pending sign-ups hold a spot for 30 minutes — [lib/constants.ts](lib/constants.ts) (`MEMBERSHIP_START_SEARCH_DAYS`, `PENDING_MEMBERSHIP_HOLD_MINUTES`), [app/api/create-subscription/route.ts](app/api/create-subscription/route.ts)
- Members can manage their own membership from Profile → Membership — [app/api/profile/membership/action/route.ts](app/api/profile/membership/action/route.ts), [lib/membership-self-service.ts](lib/membership-self-service.ts), [components/profile/membership/LeaveFlow.tsx](components/profile/membership/LeaveFlow.tsx)
  - Actions are `change` (upgrade, downgrade or day change at the next renewal, using a Stripe subscription schedule), `cancel_change`, `cancel` (at period end, through a four-step leave flow that captures a reason), `resume`, `renew` (one-time), and `autorenew_confirm` (convert a one-time membership to auto-renew)
  - Cancellation reasons are stored in the `cancellation_feedback` table and shown to admins
  - Card updates go through the Stripe Customer Portal, limited to the update-card flow — [app/api/profile/membership/portal/route.ts](app/api/profile/membership/portal/route.ts)
- One-time members get a renewal email with a private token link to `/renew-membership?token=…`, 5 days before their end date — [app/renew-membership/page.tsx](app/renew-membership/page.tsx), [lib/membership-renewal.ts](lib/membership-renewal.ts), [app/api/renew-membership/route.ts](app/api/renew-membership/route.ts)
- Members can cancel through a public confirmation page — [app/cancel-membership/confirm/page.tsx](app/cancel-membership/confirm/page.tsx)
- "Can't make it": a member can mark themselves absent for a date, which frees the spot and removes them from that day's headcount, roster and reminders (`player_absences` table). Admins can also assign a "fill-in" to take a member's spot (`session_fill_ins`) — [app/api/profile/absence/route.ts](app/api/profile/absence/route.ts), [lib/db.ts](lib/db.ts), [components/profile/membership/PlayCalendar.tsx](components/profile/membership/PlayCalendar.tsx)

**Accounts and login methods**
- Sign-in is passwordless — README "Sign-in"; [app/login/page.tsx](app/login/page.tsx), [app/api/auth/email/*](app/api/auth/email/start/route.ts), [app/api/auth/sms/*](app/api/auth/sms/start/route.ts), [lib/player-auth.ts](lib/player-auth.ts), [lib/sms.ts](lib/sms.ts)
  - Email: a 6-digit code plus a magic link sent by Resend. Codes are hashed, last 10 minutes, allow 5 attempts, and at most 3 are sent per 15 minutes
  - SMS: codes are sent through Google Identity Platform (Firebase phone auth), called from the server with an invisible reCAPTCHA
  - SMS is capped at `SMS_FREE_LIMIT_24H` (default 10) texts per rolling 24 hours so it stays in Google's free tier. Once the cap is hit, the login page falls back to email only
- Sessions last 90 days and slide with use, and the Account tab has "Sign out of all devices" — README
- There is no password login and no social or OAuth login, such as Google or Apple. No code for either was found (searched `app/api/auth/*`)
- Online membership sign-up requires an account, and accounts are linked automatically from every membership path. Admins can bulk-create accounts for current members — README "Accounts for current members"; [app/admin/players/page.tsx](app/admin/players/page.tsx) (`importMembers`)

**Profile (`/profile`, four tabs)**
- Account tab — [app/profile/account/page.tsx](app/profile/account/page.tsx), [app/api/profile/*](app/api/profile/me/route.ts), [components/profile/*](components/profile/AccountSections.tsx)
  - Profile picture: cropped to 512 px and stored in a public Blob store
  - Personal details and phone verification
  - Messages with the admins (an inbox)
  - Leaderboard opt-out
  - Data export as JSON (`/api/profile/export`)
  - Account deletion
  - Privacy settings
  - "Add to Home Screen" guide
- Membership tab: plan, card and receipts; changes; the play calendar with casual booking and "Can't make it"; and the shop — [app/profile/membership/page.tsx](app/profile/membership/page.tsx), [components/profile/membership/*](components/profile/membership/MembershipCard.tsx), [components/profile/shop/ShopSection.tsx](components/profile/shop/ShopSection.tsx)
- Arena tab: pair challenges. `/challenges` redirects here — [app/profile/arena/page.tsx](app/profile/arena/page.tsx), [app/challenges/page.tsx](app/challenges/page.tsx), [components/arena/ArenaView.tsx](components/arena/ArenaView.tsx)
- Player tab: rank card, stats, streaks, leaderboard ranks, an attendance heatmap, a round-robin chart and history, photo sharing, and "Connected apps" (API keys; the UI is currently hidden) — [app/profile/player/page.tsx](app/profile/player/page.tsx), [components/profile/player/PlayerStatsView.tsx](components/profile/player/PlayerStatsView.tsx), [components/profile/player/ConnectedApps.tsx](components/profile/player/ConnectedApps.tsx); README; commit `1c58250` "Player tab: hide Connected apps for now"

**Stats, streaks and attendance**
- Attendance is recorded automatically from the sign-up roster (paid casual bookers plus members, minus absences, with fill-ins substituted), rebuilt hourly. It is also recorded when the court board is concluded, when a mini-game score is locked, and when an admin ticks players manually. No check-in step is needed — README "Attendance and leaderboard"; [lib/stats-db.ts](lib/stats-db.ts) (`recordRosterAttendance`, `recordBoardAttendance`, `storeDrawResults`)
- Streaks are computed against the club's actual play days and excuse absences — [lib/stats-periods.ts](lib/stats-periods.ts) (`computeStreaks`); [tests/stats-periods.test.ts](tests/stats-periods.test.ts)

**Leaderboard, Wolf Points and the Arena**
- `/leaderboard` is public. It ranks Wolf Points by month, quarter, year to date or all time, filterable by source. Players who opted out are hidden — [app/leaderboard/page.tsx](app/leaderboard/page.tsx), [components/leaderboard/LeaderboardView.tsx](components/leaderboard/LeaderboardView.tsx), [lib/stats-db.ts](lib/stats-db.ts) (`getLeaderboard`)
- Wolf Points (WP) are earned per play day, round-robin win and challenge win, with bonuses (README "The Arena"; [lib/ranks.ts](lib/ranks.ts); [docs/plans/challenges.md](docs/plans/challenges.md)):

  | Source | Wolf Points |
  |---|---|
  | Play day attended | 1 |
  | Round-robin win | 2 |
  | Challenge win | 2 |
  | Bonus: Giant-killer | +2 |
  | Bonus: New rival | +1 |
  | Bonus: Hot streak | +1 |
  | Bonus: Crown bounty | +4 |

  - Losses never cost points
- The rank ladder has 35 steps in 4 leagues, from Plastic Shuttle to Diamond Racket, plus live "Alpha Wolf" and "Silver Wolf" seats based on top 90-day WP — [lib/ranks.ts](lib/ranks.ts), [lib/rank-art.ts](lib/rank-art.ts)
  - Under "keep it polished", top ranks tarnish without recent play
- Achievements, crowns and a season champion are implemented in code (`achievementsOf`, `seasonChampion`) — [lib/arena-db.ts](lib/arena-db.ts), [lib/arena-state.ts](lib/arena-state.ts)
- Pair challenges — [app/api/arena/route.ts](app/api/arena/route.ts), [lib/arena-db.ts](lib/arena-db.ts), README
  - Pairs form with a 5-digit code. A pair posts a challenge open for today, 3 days or 7 days, and any other pair can accept
  - The players arrange the time and place themselves. They check in with a 5-digit code and enter a BWF-style score (one game to 21)
  - The opponents confirm the score, or it auto-confirms after 24 hours. Disputed scores go to admins
  - Anti-farming caps: the same four players can meet at most 3 times a day and 10 times in 30 days (`CAPS`)
- This is not a skill-rating system. It is an activity- and win-based points ladder: there is no Elo, Glicko, DUPR or UTR calculation. A grep for `elo|dupr|rating` found only an unrelated match in a photo route — [lib/ranks.ts](lib/ranks.ts)

**Mini-game (round-robin draw)**
- `/mini-game` is a password-protected doubles round-robin draw: every team plays every other team, a win is worth 2 points, and teams lock for 7 days. It is used on special "mini game days" — [lib/mini-game.ts](lib/mini-game.ts), [app/mini-game/page.tsx](app/mini-game/page.tsx), [app/api/mini-game/route.ts](app/api/mini-game/route.ts), [components/mini-game/MiniGame.tsx](components/mini-game/MiniGame.tsx)
- The 16-player roster and its tiers are hard-coded by first name in source (for example "Hòa", "Khoai Lang", "Jason", "Kelcee"). Draws pair tier 1 with tier 4 and tier 2 with tier 3 — [lib/mini-game-roster.ts](lib/mini-game-roster.ts)

**Casual-play court board (`/casual-play`)**
- A live open-play court rotation board, meant for the venue TV and players' phones — [components/casual-play/CasualPlay.tsx](components/casual-play/CasualPlay.tsx), [lib/casual-play.ts](lib/casual-play.ts), [lib/casual-play-db.ts](lib/casual-play-db.ts), [app/api/casual-play/route.ts](app/api/casual-play/route.ts); README
  - Organisers drag players into Tier 1 / Tier 2 / Not playing. Each game pairs a tier 1 player with a tier 2 player, and the queue favours fewest games, then longest wait, avoiding repeat partners
  - Supports 1–4 courts, with optional venue court numbers. Organisers can mark "Game finished", put a player on break, call off a game, and conclude the day with a summary
  - State is shared across screens through polling (Postgres JSONB with a version column)
  - Organiser access uses `MINI_GAME_PASSWORD`, or an admin login

**Gallery and photos**
- The homepage gallery mixes club photos from Sanity with approved player photos. `/gallery` shows everything, and the lightbox offers "Download original" — [app/gallery/page.tsx](app/gallery/page.tsx), [components/gallery/GalleryGrid.tsx](components/gallery/GalleryGrid.tsx), [lib/gallery-pool.ts](lib/gallery-pool.ts), [lib/gallery-rotation.ts](lib/gallery-rotation.ts)
- Players upload photos from the profile. GPS data is stripped from originals ([lib/exif-gps.ts](lib/exif-gps.ts)). With `GOOGLE_VISION_ENABLED`, Google Cloud Vision SafeSearch moderates uploads: LIKELY-or-worse is blocked, POSSIBLE is held for review, and everything else goes live. Without it, every photo waits for review — [lib/photo-moderation.ts](lib/photo-moderation.ts), [lib/moderation-rules.ts](lib/moderation-rules.ts), [app/api/profile/photos/upload/route.ts](app/api/profile/photos/upload/route.ts)

**Shop and jersey**
- The in-profile shop sells products with men's/women's fits, sizes S–3XL, a per-variant stock grid with atomic holds, and size charts — [lib/shop-db.ts](lib/shop-db.ts), [app/api/profile/shop/order/route.ts](app/api/profile/shop/order/route.ts), [lib/shop-notify.ts](lib/shop-notify.ts)
  - Players pay by card, or reserve with cash: the hold lasts until the end of their next play day, or 14 days if they have none
  - A daily job sends reminders and releases lapsed holds
  - The "Port Hills Dawn" jersey ($30) is seeded automatically
- Club jersey registration ran on a one-off campaign page, `/jersey`, now retired (it redirects home). It used 5-digit bank-transfer reference codes auto-matched against bank feed lines, early-bird pricing (first 10 at $15, then $30, +$5 for name and number), and duplicate detection — [app/jersey/page.tsx](app/jersey/page.tsx), [lib/jersey.ts](lib/jersey.ts), [lib/jersey-db.ts](lib/jersey-db.ts), [app/api/jersey/route.ts](app/api/jersey/route.ts); README "Club jersey"

**PWA, notifications and integrations**
- Installable PWA: a manifest (name "Three Wolves Badminton Club", `start_url /profile`, shortcuts to Membership, My stats and Leaderboard), a service worker that caches only static files, an offline page, and a device-aware install guide shown once on phones and tablets — [app/manifest.ts](app/manifest.ts), [public/sw.js](public/sw.js), [public/offline.html](public/offline.html), [components/profile/InstallGuide.tsx](components/profile/InstallGuide.tsx), [lib/device.ts](lib/device.ts)
- There are no web push notifications. A grep for `PushManager|web-push|showNotification` found nothing in app, lib, components or public. Notifications are email only, plus SMS for login codes only
- Players have a personal calendar feed, `/api/v1/me/calendar.ics?token=…` — [app/api/v1/me/calendar.ics/route.ts](app/api/v1/me/calendar.ics/route.ts)
- There is a player-scoped REST API with scoped tokens (`read:stats`, `read:attendance`, `read:calendar`, `write:activity`) — [lib/api-v1.ts](lib/api-v1.ts), [app/api/v1/*](app/api/v1/me/route.ts), [app/api/profile/integrations/*](app/api/profile/integrations/tokens/route.ts)
  - Endpoints: `GET /api/v1/me`, `/me/attendance`, `/me/round-robin`, `/me/stats`, `POST /me/activity`
  - Public endpoints: `/api/v1/leaderboard`, `/api/v1/sessions/upcoming`
- An MCP server at `POST /api/mcp` exposes the same data — [app/api/mcp/route.ts](app/api/mcp/route.ts)
- Outbound webhooks (`attendance.recorded`, `round_robin.result`, `photo.approved`) are HMAC-signed with an `X-ThreeWolves-Signature` header and retried — [lib/webhooks.ts](lib/webhooks.ts)

### Inferences
- For a single social club this is unusually rich in engagement features (gamification, open-play rotation board, MCP/API) compared with what a small club would typically build. The commercial core (court reservations, lessons, events) is narrow: one bookable unit, "a spot at the play day on date X".
- The Arena and the court board are the most portable, differentiated pieces. Their rules already sit in pure, tested modules ([lib/ranks.ts](lib/ranks.ts), [tests/ranks.test.ts](tests/ranks.test.ts), [lib/casual-play.ts](lib/casual-play.ts)), although names and theming ("Wolf", badminton-specific rank art like "Feather Shuttle") are brand- and sport-specific.

### Gaps
- I did not run the app, so UI behaviour is taken from code and README descriptions.
- I did not confirm whether the Sanity `scheduleSettings.maxCasualSpots` and `bookingLockDays` fields are read anywhere. A grep of app, lib and components found no use of `bookingLockDays`.

## 2. Admin features: every admin page and route

### Takeaway
There is a single shared-password admin area with 10 nav tabs plus utility pages. It covers rosters, members, Stripe sync, player accounts, inbox, shop, photo moderation, Arena disputes, day pausing, jersey registrations, and a strong club-finance module (Stripe import, NZ bank feed reconciliation, NZ not-for-profit annual report). There are no staff roles or permissions.

### Cited Findings
**Authentication**
- Admin login is password-only (`ADMIN_PASSWORD`). The session is an HMAC-signed cookie with a 48-hour sliding expiry, and the middleware guards `/admin/:path*` and `/profile/:path*` — [lib/admin-session.ts](lib/admin-session.ts), [middleware.ts](middleware.ts), [app/admin/login/page.tsx](app/admin/login/page.tsx), [app/api/admin-login/route.ts](app/api/admin-login/route.ts), [app/api/admin-logout/route.ts](app/api/admin-logout/route.ts)
- There is no admin user table, no per-admin identity, and no role or permission model. The only other credential is the organiser password `MINI_GAME_PASSWORD` for `/mini-game` and `/casual-play` — [.env.example](.env.example), [lib/admin-session.ts](lib/admin-session.ts)

**Admin nav tabs** (Play days, Members, Players, Inbox, Shop, Photos, Challenges, Day requests, Jersey, Financials), plus a "Court board" link to `/casual-play` — [components/admin/AdminNav.tsx](components/admin/AdminNav.tsx)

**Admin pages and their server actions**

| Page | What it does | Source |
|---|---|---|
| `/admin/play-days` | Roster for any date; set courts booked; lock or unlock registration; add a cash player; remove a player; assign or clear a fill-in; notify the waitlist; remove waitlist entries; attendance ticks | [app/admin/play-days/page.tsx](app/admin/play-days/page.tsx), [app/admin/play-days/attendance-actions.ts](app/admin/play-days/attendance-actions.ts), [components/admin/AttendanceSection.tsx](components/admin/AttendanceSection.tsx) |
| `/admin/members` | Members list; add a cash member (recorded as a Stripe invoice paid out of band); cancel a membership; retry a failed payment; give a free month; "Sync with Stripe now"; auto-expires lapsed memberships; lists memberships ended in the last 60 days; renewal-reminder status | [app/admin/members/page.tsx](app/admin/members/page.tsx), [app/api/admin/cancel-membership/route.ts](app/api/admin/cancel-membership/route.ts), [app/api/admin/retry-payment/route.ts](app/api/admin/retry-payment/route.ts), [app/api/admin/free-month/route.ts](app/api/admin/free-month/route.ts), [app/api/admin/stripe-sync/route.ts](app/api/admin/stripe-sync/route.ts), [lib/stripe-sync.ts](lib/stripe-sync.ts), [lib/membership-status.ts](lib/membership-status.ts) |
| `/admin/players` | Import accounts for current members; recalculate play days and points; match mini-game names to players; send welcome emails in batches of 40 (with preview); change a player's email; confirm API-submitted check-ins; SMS on/off switch and counter; churn and downgrade reasons; all-players list | [app/admin/players/page.tsx](app/admin/players/page.tsx), [lib/welcome-emails.ts](lib/welcome-emails.ts) |
| `/admin/setup` | Live "Setup check" of every integration (DB, Resend, Firebase key, Blob, Vision, etc.) | [app/admin/setup/page.tsx](app/admin/setup/page.tsx), [lib/setup-check.ts](lib/setup-check.ts) |
| `/admin/device-check` | "Screen check" layout and device diagnostics | [app/admin/device-check/page.tsx](app/admin/device-check/page.tsx), [components/admin/DeviceCheck.tsx](components/admin/DeviceCheck.tsx) |
| `/admin/inbox`, `/admin/inbox/[id]` | Two-way message threads with players; "Message a player"; email notifications both ways | [app/admin/inbox/page.tsx](app/admin/inbox/page.tsx), [lib/messages-db.ts](lib/messages-db.ts), [lib/message-notify.ts](lib/message-notify.ts) |
| `/admin/shop` | Products (EN/VI), stock grid, size charts, orders, "Paid cash & collected", Excel export | [app/admin/shop/page.tsx](app/admin/shop/page.tsx), [app/api/admin/shop/export/route.ts](app/api/admin/shop/export/route.ts) |
| `/admin/photos` | Moderation queue (approve or reject), feature a photo, message the uploader, Blob storage usage | [app/admin/photos/page.tsx](app/admin/photos/page.tsx) |
| `/admin/challenges` | Disputes (score is right / set winner / void), recent challenges with Void, ladder dry run | [app/admin/challenges/page.tsx](app/admin/challenges/page.tsx) |
| `/admin/day-requests` | Pause or resume weekdays, "Reopen & email", "Email N waiting", delete requests | [app/admin/day-requests/page.tsx](app/admin/day-requests/page.tsx) |
| `/admin/jersey`, `/admin/jersey/[id]`, `/admin/jersey/new` | Registrations; Mark paid / Undo / Release / Cancel; edit; add by hand; Excel export (registrations, printer order, summary) | [app/admin/jersey/page.tsx](app/admin/jersey/page.tsx), [app/api/admin/jersey/export/route.ts](app/api/admin/jersey/export/route.ts), [components/admin/JerseyExport.tsx](components/admin/JerseyExport.tsx) |
| `/admin/financials` | Ledger of money in and out; Stripe auto-import (gross, fees and refunds as separate lines); manual expense and income entries; receipt uploads (private Blob); period filters; NZ financial year (April–March); monthly chart; Excel export | [app/admin/financials/page.tsx](app/admin/financials/page.tsx), [lib/finance.ts](lib/finance.ts), [lib/finance-db.ts](lib/finance-db.ts), [lib/finance-stripe.ts](lib/finance-stripe.ts), [app/api/admin/finance/export/route.ts](app/api/admin/finance/export/route.ts), [app/api/admin/finance/receipts/[id]/route.ts](app/api/admin/finance/receipts/[id]/route.ts) |
| `/admin/financials/bank` | Opening balances; money held (bank, Stripe, cash); bank reconciliation with smart matching modelled on Xero/QuickBooks; learned bank rules; ANZ data via Akahu open banking, CSV import, or a bank webhook | [app/admin/financials/bank/page.tsx](app/admin/financials/bank/page.tsx), [lib/bank-db.ts](lib/bank-db.ts), [lib/bank-match.ts](lib/bank-match.ts), [lib/bank-akahu.ts](lib/bank-akahu.ts), [lib/bank-csv.ts](lib/bank-csv.ts), [app/api/bank/webhook/route.ts](app/api/bank/webhook/route.ts) |
| `/admin/financials/report` | AGM annual report: Statement of Receipts and Payments in the NZ Tier 4 not-for-profit cash format (PBE SFR-C) | [app/admin/financials/report/page.tsx](app/admin/financials/report/page.tsx), [lib/finance-report.ts](lib/finance-report.ts) |
| `/studio` | Sanity Studio for site content | [app/studio/[[...tool]]/page.tsx](app/studio/[[...tool]]/page.tsx) |

**Other admin and ops endpoints**
- `/api/revalidate` (Sanity webhook) — [app/api/revalidate/route.ts](app/api/revalidate/route.ts)
- `/api/health/db` (region and latency check) — [app/api/health/db/route.ts](app/api/health/db/route.ts)
- `/api/health/photos` — [app/api/health/photos/route.ts](app/api/health/photos/route.ts)

**Free months** — [app/api/admin/free-month/route.ts](app/api/admin/free-month/route.ts); README "Free months"

| Membership type | What "Give free month" does |
|---|---|
| One-time | Adds 4 weeks to the end date |
| Recurring monthly | Applies a 100%-off "once" coupon to the next invoice |
| Recurring quarterly | Pushes the next charge back 4 weeks using Stripe `trial_end` |

**Headcount alerts**
- A daily cron checks the next 5 days' sessions against the 8–12 player target and emails `ALERT_ADMIN_EMAILS` when a session drifts outside it, once per state change — [app/api/cron/headcount-alerts/route.ts](app/api/cron/headcount-alerts/route.ts), [lib/notify.ts](lib/notify.ts); README

### Inferences
- The admin tooling is built for one or two trusted volunteers. A commercial product would need named staff accounts, roles (owner, manager, front desk, coach) and audit logs, none of which exist.
- The finance module (Stripe ledger, bank reconciliation, the NZ not-for-profit annual report) is a notable differentiator. It is deeply NZ-specific (ANZ, Akahu, PBE SFR-C, April–March financial year).

### Gaps
- There is no dedicated analytics or reporting dashboard (occupancy, retention, revenue per member) beyond the financials ledger, chart and annual report. I found no such page in `app/admin`.

## 3. Payments, pricing models, and email and SMS automations

### Takeaway
Payments run through a single Stripe account in NZD. The pricing models are: casual drop-in, 4- and 12-week memberships per weekday (auto-renewing or one-time), cash members recorded as out-of-band Stripe invoices, donations (one-time or monthly), shop orders, and jersey bank transfers. Automation is a set of daily Vercel crons plus transactional Resend emails. Stripe's own emails handle renewal, dunning and expiring-card reminders.

### Cited Findings
**Payments**
- Stripe Elements card form and PaymentIntents for casual bookings, one-time memberships, donations and shop orders. Subscriptions are used for auto-renewing memberships and monthly donations — [components/payment/StripeCardForm.tsx](components/payment/StripeCardForm.tsx), [app/api/create-payment-intent/route.ts](app/api/create-payment-intent/route.ts), [app/api/create-subscription/route.ts](app/api/create-subscription/route.ts), [app/api/create-donation-subscription/route.ts](app/api/create-donation-subscription/route.ts)
- The Stripe webhook handles `payment_intent.succeeded`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_succeeded` — [app/api/stripe-webhook/route.ts](app/api/stripe-webhook/route.ts)
- Each Stripe price ID is one environment variable per day×tier (`STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_QUARTERLY`, `STRIPE_PRICE_WEDNESDAY_MONTHLY`, `STRIPE_PRICE_WEDNESDAY_QUARTERLY`, `STRIPE_PRODUCT_DONATION`), created by `scripts/stripe-setup.mjs` — [lib/stripe.ts](lib/stripe.ts), [scripts/stripe-setup.mjs](scripts/stripe-setup.mjs), [.env.example](.env.example)
- Pricing is enforced server-side. Prices come from `PRICES` and `*_PRICE_CENTS` constants; Sanity `priceNzd` changes the display only — [lib/constants.ts](lib/constants.ts), [lib/pricing-plans.ts](lib/pricing-plans.ts); README "Security"
- Refunds:
  - The only automatic refund is for an oversold casual booking — [app/api/stripe-webhook/route.ts](app/api/stripe-webhook/route.ts)
  - Refunds made in Stripe are imported into the ledger as "spent" lines — [lib/finance-stripe.ts](lib/finance-stripe.ts)
  - Jersey overpayments are kept as club funds, with no refunds — README
  - There is no admin "refund" button, no account credit or wallet, and no player-initiated casual booking cancellation or refund. I found no `refunds.create` call other than the oversold path
- There is no Stripe Connect: `lib/stripe.ts` uses a single `STRIPE_SECRET_KEY`, with no connected-account or application-fee code (a grep for `connect|stripeAccount|application_fee` in `lib/stripe.ts` found nothing)

**Crons** ([vercel.json](vercel.json); times in UTC)

| Route | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/sync-calendar` | 02:00 | Google Calendar → sessions |
| `/api/cron/headcount-alerts` | 18:00 | Headcount alerts |
| `/api/cron/send-roster` | 03:00 | Emails the play-day roster to `CLUB_ROSTER_EMAIL` around 4 PM NZDT |
| `/api/cron/membership-reminders` | 19:00 | Day-before "see you tomorrow" emails; 5-day one-time renewal reminders; membership expiry upkeep; daily Stripe sync; shop upkeep; webhook retries |
| `/api/cron/sync-finance` | 13:00 | Stripe ledger import plus Akahu bank sync and jersey payment matching |

- Sources for the crons: [app/api/cron/*](app/api/cron/send-roster/route.ts), [lib/membership-status.ts](lib/membership-status.ts), [lib/shop-notify.ts](lib/shop-notify.ts)

**Transactional emails (Resend)** — [lib/email.ts](lib/email.ts) unless noted
- Roster
- Waitlist: confirmation, admin alert, spot open
- Membership: confirmation, reminder, renewal reminder
- Casual booking: confirmation, reminder, full refund
- Fill-in confirmation
- Admin booking-race alert
- Day requests: confirmation, admin alert, "day open"
- Jersey: registration, paid, admin alert
- Headcount alert — [lib/notify.ts](lib/notify.ts)
- Login code, welcome, admin alerts, player notices — [lib/player-email.ts](lib/player-email.ts), [lib/welcome-email-template.ts](lib/welcome-email-template.ts)
- Shop order placed and oversold — [lib/shop-notify.ts](lib/shop-notify.ts)
- Inbox messages — [lib/message-notify.ts](lib/message-notify.ts)
- All emails share one branded HTML layout — [lib/email-layout.ts](lib/email-layout.ts)

**Stripe-native emails**
- Renewal reminders, failed-payment dunning and expiring-card emails are switched on in the Stripe Dashboard, not in code — README "Membership status emails"

**SMS**
- SMS is used only for sign-in and phone verification codes, through Google Identity Platform. There are no SMS reminders or marketing texts — [lib/sms.ts](lib/sms.ts), [lib/phone-proof.ts](lib/phone-proof.ts)

### Inferences
- Missing compared with commercial club software: coupons and promo codes for players (the only coupon use is the admin free month), packs or credit bundles (for example a 10-visit pass), family or household billing, proration, gift cards, and a POS for walk-ins (cash is recorded by hand as Stripe out-of-band invoices).
- Resend is limited to 100 emails a day on the plan in use (welcome emails are batched at 40 "to stay under Resend's 100 emails a day", README). This suggests the free tier, which would not scale to multi-club volume.

### Gaps
- I did not verify Stripe tax or GST handling. No GST logic surfaced in the grep, and the annual report is cash-basis for a not-for-profit.

## 4. What is hard-coded to Three Wolves, one club, or NZ

### Takeaway
A lot is hard-coded. Club identity, contact details, NZ time zone, NZD currency, NZ-only SMS, the Friday/Wednesday membership-day model, prices, the court-to-capacity table, EN/VI languages, fonts and colours, the bank provider (ANZ via Akahu), the NZ financial year and accounting standard, and even the mini-game player names are all in source code or single environment variables. Everything is wired to one Stripe account, one Google Calendar, one Sanity dataset, one database and one roster email address.

### Cited Findings
**Club name and brand**
- "Three Wolves" appears in 53 source files across app, lib, components, context, scripts and sanity (grep count). Examples:
  - [app/layout.tsx](app/layout.tsx): title "Three Wolves Badminton Club — Christchurch, NZ"
  - [app/manifest.ts](app/manifest.ts): name "Three Wolves Badminton Club", short name "3 Wolves"
  - [app/mini-game/page.tsx](app/mini-game/page.tsx), [app/casual-play/page.tsx](app/casual-play/page.tsx), [app/profile/layout.tsx](app/profile/layout.tsx)
  - Excel export headers in [app/api/admin/finance/export/route.ts](app/api/admin/finance/export/route.ts)
  - Stripe invoice description "Three Wolves shop — … — cash" in [app/admin/shop/page.tsx](app/admin/shop/page.tsx)
- The "Wolf" naming is part of the product's game design: Wolf Points, Alpha Wolf and Silver Wolf seats, the "Iron Wolf" and "Social Wolf" achievements, and the `X-ThreeWolves-Signature` webhook header — [lib/ranks.ts](lib/ranks.ts), [lib/webhooks.ts](lib/webhooks.ts), [docs/plans/challenge-graphics/](docs/plans/challenges.md)
- Logos and imagery are committed files: `public/uploads/Three wolves logo*.svg/png`, `public/icons/wolf-mark*.png`, `public/icons/icon-*.png`, gallery photos in `public/uploads/*.jpg`, and jersey and shop images (`public/uploads/jersey/house-of-barber-logo.svg` is a sponsor) — repository tree
- Fonts: UTM Copperplate (chosen for Vietnamese diacritics) and Montserrat are self-hosted and declared in [app/globals.css](app/globals.css), and also referenced in [lib/welcome-email-template.ts](lib/welcome-email-template.ts)
- Colours are fixed CSS variables (`--navy #184467`, `--bronze #C4892A`, `--cream #fcfbf2`, and others) — [app/globals.css](app/globals.css). The manifest repeats `theme_color #0e2c3f` and `background_color #fcfbf2` — [app/manifest.ts](app/manifest.ts)

**Contact details and email addresses**
- `CLUB_CONTACT_EMAIL = "threewolvesbadminton@gmail.com"` and the footer "Three Wolves Badminton Club · Christchurch, NZ" — [lib/email-layout.ts](lib/email-layout.ts) (lines 21 and 122)
- The roster recipient falls back to `CLUB_ROSTER_EMAIL || "threewolvesbadminton@gmail.com"` in 5 places — [lib/email.ts](lib/email.ts) (lines 51, 164, 578, 655, 919); default also in [.env.example](.env.example)
- The alert sender defaults to `alerts@threewolvesbadminton.com` — [lib/notify.ts](lib/notify.ts) (line 48)
- The footer hard-codes the phone number "(+64) 27 244 4098", the Gmail address, "Christchurch 8053, NZ" and "Secured by Stripe · Christchurch, NZ". Sanity `siteSettings` has phone and email fields, but the footer is literal — [components/Footer.tsx](components/Footer.tsx) (lines 102, 116, 135, 188)
- Firebase setup error text names the threewolvesbadminton.org domains — [lib/sms.ts](lib/sms.ts) (line 280)
- The `.ics` UID suffix is `@threewolves` — [app/api/v1/me/calendar.ics/route.ts](app/api/v1/me/calendar.ics/route.ts)
- The MCP server description is "Three Wolves Badminton Club (Christchurch, NZ)… Dates are New Zealand dates" — [app/api/mcp/route.ts](app/api/mcp/route.ts) (line 127)
- `NEXT_PUBLIC_SITE_URL=https://threewolvesbadminton.org` — [.env.example](.env.example)
- "Christchurch" appears in 9 files, including [lib/i18n.ts](lib/i18n.ts), [lib/jersey-i18n.ts](lib/jersey-i18n.ts), [components/Reviews.tsx](components/Reviews.tsx), [lib/welcome-email-template.ts](lib/welcome-email-template.ts) and [lib/casual-play-demo.ts](lib/casual-play-demo.ts) (grep)

**Time zone and locale**
- `const CLUB_TIME_ZONE = "Pacific/Auckland"` in [lib/dates.ts](lib/dates.ts) (line 20). "Pacific/Auckland" is also written literally in 16 files, including [lib/db.ts](lib/db.ts), [lib/arena-db.ts](lib/arena-db.ts), [lib/email.ts](lib/email.ts), [lib/shop-notify.ts](lib/shop-notify.ts), [components/mini-game/MiniGame.tsx](components/mini-game/MiniGame.tsx), several admin pages and the export routes (grep)
- The `en-NZ` locale formatting appears in 24 files (grep), for example [lib/finance.ts](lib/finance.ts), [lib/dates.ts](lib/dates.ts) and [lib/membership-self-service.ts](lib/membership-self-service.ts)
- Cron schedules are UTC values tuned to NZDT, with a documented drift of one hour during NZST — [vercel.json](vercel.json); README notes

**Currency**
- `currency: "nzd"` is written literally in the Stripe calls in [app/api/create-payment-intent/route.ts](app/api/create-payment-intent/route.ts), [app/api/create-donation-intent/route.ts](app/api/create-donation-intent/route.ts), [app/api/create-donation-subscription/route.ts](app/api/create-donation-subscription/route.ts), [app/api/profile/shop/order/route.ts](app/api/profile/shop/order/route.ts), [app/admin/members/page.tsx](app/admin/members/page.tsx) (line 108), [app/admin/play-days/page.tsx](app/admin/play-days/page.tsx) (line 91) and [app/admin/shop/page.tsx](app/admin/shop/page.tsx) (line 44). NZD or nzd appears in 37 files overall. The Sanity field is literally named `priceNzd` — [sanity/schema.ts](sanity/schema.ts)

**SMS and phone**
- `SMS_COUNTRIES = [{ code: "NZ", dial: "64", … }]`; `NZ_MOBILE = /^\+642\d{7,9}$/`; `toE164` defaults to the 64 country code — [lib/phone.ts](lib/phone.ts)
- The SMS start route rejects non-+64 numbers with `region_not_allowed` — [app/api/auth/sms/start/route.ts](app/api/auth/sms/start/route.ts) (line 33); commit `6c81cae` "SMS: NZ mobiles only with a +64 prefix"

**Schedule and business model**
- `MembershipDay = "friday" | "wednesday"`, `MEMBERSHIP_ACCESS_DAYS`, `MEMBERSHIP_DAY_TO_DOW` and `DEFAULT_PAUSED_DAYS = ["wednesday"]` — [lib/constants.ts](lib/constants.ts)
- Pricing plan IDs are hard-coded as `fridayMonthly` and the like — [lib/pricing-plans.ts](lib/pricing-plans.ts), [sanity/schema.ts](sanity/schema.ts) `pricingPlan.planId` options
- Stripe price env vars are named per day — [lib/stripe.ts](lib/stripe.ts) (lines 55–61)
- Prices are constants: `CASUAL_PRICE_CENTS = 1000`, `MONTHLY_PRICE_CENTS = 3300`, `QUARTERLY_PRICE_CENTS = 8500`, plus `PRICES` — [lib/constants.ts](lib/constants.ts)
- Capacity table: `COURTS_TO_MAX_PLAYERS {1:6, 2:12, 3:18, 4:22}`, which a comment says to "keep in sync with the CASE expression in lib/db.ts's reserveBookingSlot query" (so the numbers are also embedded in SQL), and `SESSION_CAPACITY = 12` — [lib/constants.ts](lib/constants.ts), [lib/db.ts](lib/db.ts)
- Booking window and cutoff: `BOOKING_WINDOW_DAYS = 30`, `BOOKING_CUTOFF_HOUR = 17` — [lib/constants.ts](lib/constants.ts)
- The headcount target is 8–12 — README "Headcount alerts"
- Jersey dates (16 and 21 Oct 2026) and prices — [lib/jersey.ts](lib/jersey.ts); README
- The mini-game roster of 16 named players and their tiers — [lib/mini-game-roster.ts](lib/mini-game-roster.ts)
- Static gallery fallback images — [lib/constants.ts](lib/constants.ts) `GALLERY_IMAGES`
- The "Port Hills Dawn" jersey is auto-seeded in the shop — [lib/shop-db.ts](lib/shop-db.ts)

**Languages**
- Only English and Vietnamese. Bilingual EN/VI dictionaries are compiled into the code, and the Sanity schema has fixed `en`/`vi` locale fields — [lib/i18n.ts](lib/i18n.ts), [sanity/schema.ts](sanity/schema.ts)

**Finance and banking**
- ANZ via Akahu (an NZ open-banking provider) and the ANZ CSV format — [lib/bank-akahu.ts](lib/bank-akahu.ts), [lib/bank-csv.ts](lib/bank-csv.ts)
- An NZD-only balance check (`account.balance.currency === "NZD"`) — [lib/bank-akahu.ts](lib/bank-akahu.ts) (line 162)
- A venue-specific bank rule example ("pioneer stadium" → Court hire) in [lib/bank-match.ts](lib/bank-match.ts) and [components/admin/finance/EntryForm.tsx](components/admin/finance/EntryForm.tsx)
- `FINANCIAL_YEAR_START_MONTH = 4` (April) — [lib/finance.ts](lib/finance.ts) (line 221)
- The NZ PBE SFR-C Tier 4 report format — [app/admin/financials/report/page.tsx](app/admin/financials/report/page.tsx)

**Single-instance integrations**, each a single environment variable or client — [lib/stripe.ts](lib/stripe.ts), [lib/google-calendar.ts](lib/google-calendar.ts), [lib/sanity.ts](lib/sanity.ts), [lib/db.ts](lib/db.ts), [lib/db-switch.ts](lib/db-switch.ts), [lib/email.ts](lib/email.ts), [lib/sms.ts](lib/sms.ts), [lib/admin-session.ts](lib/admin-session.ts), [.env.example](.env.example):
- `STRIPE_SECRET_KEY` (one Stripe account)
- `GOOGLE_CALENDAR_ID` (one calendar)
- `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET` (one content dataset)
- `POSTGRES_URL`, or `DATABASE_URL_VAR=SYD_POSTGRES_URL` (one database)
- `RESEND_API_KEY`, `EMAIL_FROM`, `CLUB_ROSTER_EMAIL`, `ALERT_ADMIN_EMAILS`
- `FIREBASE_API_KEY`
- `ADMIN_PASSWORD`, `MINI_GAME_PASSWORD`
- `AKAHU_*`
- Two Blob stores
- Deployment region: `"regions": ["syd1"]` — [vercel.json](vercel.json)

### Inferences
- The fastest route to a second club is a fork-per-club redeploy: new environment variables, logo and CSS swap, and edits to `lib/constants.ts`. Even that requires code edits in roughly 50+ files to remove literal "Three Wolves", "Pacific/Auckland" and "nzd" strings and NZ phone rules. A shared multi-tenant SaaS would need a `club` config entity replacing `lib/constants.ts`, plus per-tenant secrets (Stripe Connect accounts, calendars, sender domains).
- The Friday/Wednesday membership-day model is a domain assumption baked into type definitions, so it is not just configuration. Supporting arbitrary products ("Tuesday evening league", "unlimited", "off-peak") means redesigning the plan model.

### Gaps
- I did not exhaustively list every occurrence of each string; file counts come from grep. Some occurrences may be in comments only.

## 5. Data model: tables and any notion of tenant, venue, court or role

### Takeaway
There are about 50 Postgres tables, created ad hoc with `CREATE TABLE IF NOT EXISTS` inside library modules rather than in a migrations framework. There is no club or tenant ID, venue table, court table, staff table or role column anywhere. The core `sessions` table uses the date itself as the primary key, so there can be only one session per calendar day across the whole system. Membership and attendance records are keyed by email rather than a player foreign key.

### Cited Findings
**Schema management**
- Tables are created at runtime by `ensure*Tables()` functions in each lib module, gated once per deployment through the `schema_runs` table. `scripts/migrate.mjs` only creates the original 6 tables — [lib/schema-gate.ts](lib/schema-gate.ts), [scripts/migrate.mjs](scripts/migrate.mjs); README "Speed"
- No ORM or migrations tool is used (only `@vercel/postgres` with raw SQL) — [package.json](package.json)

**Core booking tables** — [scripts/migrate.mjs](scripts/migrate.mjs), [lib/db.ts](lib/db.ts) (ALTER TABLE statements)
- `sessions`: `date DATE PRIMARY KEY`, `max_spots`, `booked_spots`, `google_event_id`, `calendar_summary`, `event_start_time`, `event_end_time`, `event_location`, `synced_at`, `courts`, `registration_locked`
- `bookings`: `id`, `session_date` (FK to `sessions.date`), `first_name`, `last_name`, `email`, `phone`, `payment_intent_id`, `status`, `created_at`, `reminder_sent_at`
- `waitlist`: `id`, `session_date`, `name`, `email`, `created_at`, `notified_at`
- `memberships`: `id`, `email`, `plan`, `stripe_subscription_id`, `status`, `created_at`, plus `first_name`, `last_name`, `phone`, `period_start`, `period_end`, `cancel_at_period_end`, `recurring`, `stripe_payment_intent_id`, `last_renewal_invoice_id`, `day`, `renewal_token`, `renewal_reminder_sent_at`, `renewal_of`, `free_days_granted`
- `donations`, `session_alert_state`, `session_fill_ins`, `player_absences` (session_date and email), `membership_reminders_sent`
- `day_requests`, `day_signup_settings` — [lib/day-requests.ts](lib/day-requests.ts)

**Player tables** — [lib/player-db.ts](lib/player-db.ts)
- `players`: `id`, `email` UNIQUE, names, `display_name`, phone fields, `lang`, `stripe_customer_id`, `leaderboard_visible`, `minigame_name`, `avatar_url`, `created_via`, and timestamps. There is no role column
- `auth_codes`, `player_sessions`, `sms_sends`, `player_settings` (key/value), `player_events`

**Stats and games** — [lib/stats-db.ts](lib/stats-db.ts), [lib/mini-game-db.ts](lib/mini-game-db.ts), [lib/casual-play-db.ts](lib/casual-play-db.ts)
- `attendance`: session_date, email, source, verified, removed
- `rr_results`: keyed by mini-game name
- `mini_game_draws`, `mini_game_scores`
- `casual_play_sessions`: `date DATE PRIMARY KEY`, `state JSONB`, `version`
- `casual_play_profiles`: `email` PRIMARY KEY

**Arena** — [lib/arena-db.ts](lib/arena-db.ts) (`T` map)
- `arena_pairs`, `arena_pair_members`, `arena_codes`, `arena_code_attempts`, `arena_challenges`, `arena_after_game`, `arena_player_ranks`
- On previews, every Arena table gets a `pv_` prefix because preview deployments share the production database

**Other modules**
- Messaging: `message_threads`, `messages` — [lib/messages-db.ts](lib/messages-db.ts)
- Photos: `player_photos` — [lib/photos-db.ts](lib/photos-db.ts)
- Shop: `shop_products`, `shop_variants`, `shop_orders`, `shop_order_items`, `shop_stock_log` — [lib/shop-db.ts](lib/shop-db.ts)
- Finance: `finance_entries`, `finance_settings`, `finance_sync_state`, `stripe_payouts`, `bank_transactions`, `bank_matches`, `bank_rules` — [lib/finance-db.ts](lib/finance-db.ts), [lib/bank-db.ts](lib/bank-db.ts)
- Jersey: `jersey_registrations` — [lib/jersey-db.ts](lib/jersey-db.ts)
- API and webhooks: `api_tokens`, `webhook_endpoints`, `webhook_deliveries` — [lib/webhooks.ts](lib/webhooks.ts), [lib/api-v1.ts](lib/api-v1.ts)
- Membership feedback: `cancellation_feedback` — [lib/membership-self-service.ts](lib/membership-self-service.ts)
- `schema_runs` — [lib/schema-gate.ts](lib/schema-gate.ts)

**Tenancy, venues, courts and roles**
- A grep for `club_id|tenant|org_id|venue_id|court_id|organization` across lib, app, scripts and components returned no matches
- A venue exists only as the free-text `sessions.event_location` copied from the Google Calendar event, plus Sanity `scheduleSettings.venueName` and `address` (single values) — [lib/db.ts](lib/db.ts), [sanity/schema.ts](sanity/schema.ts)
- Courts exist only as a count per session (`sessions.courts`, which drives capacity) and as display labels for venue court numbers on the court board (`courtNumbers?: string[]` in JSON state). There are no court entities and no court-level time slots — [lib/constants.ts](lib/constants.ts), [lib/casual-play.ts](lib/casual-play.ts) (lines 110–161)
- Roles: a single admin password, an organiser password, and players. There is no RBAC — [lib/admin-session.ts](lib/admin-session.ts), [middleware.ts](middleware.ts)

### Inferences
- Several design choices block multi-tenancy:
  - `sessions.date` as the primary key, and the same for `casual_play_sessions`
  - Globally unique `players.email`
  - Email-keyed `memberships`, `attendance` and `casual_play_profiles`
  - Unscoped key/value settings tables
- Adding `club_id` means rewriting primary keys, unique constraints and essentially every raw SQL query in roughly 15 lib modules, or else running one database or schema per club.
- The `pv_` table-prefix mechanism for previews ([lib/arena-db.ts](lib/arena-db.ts)) shows a prefix-per-namespace pattern exists for the Arena only. It could inform schema-per-tenant, but it is not generalised.

### Gaps
- I did not inspect every column of every secondary table (for example, the full shop and bank table columns). The table names above are complete according to the grep of `CREATE TABLE IF NOT EXISTS`.

## 6. Notably absent features and multi-tenant readiness

### Takeaway
Compared with commercial racquet-club platforms, the app lacks:
- Court-by-court, time-slot reservations
- Multiple venues and courts as entities
- Coaching and lessons
- Tournaments, brackets and leagues
- Skill ratings
- Guest passes, packs and credits
- Family accounts
- Waivers
- Check-in and door access
- POS
- Push notifications and native apps
- Staff roles
- Analytics dashboards
- Languages other than EN/VI
- Any tenant model

Multi-tenant readiness is low. The code is clean and modular for a single club, but club identity, NZ assumptions and single-account integrations run through the codebase, and the schema has no tenant key.

### Cited Findings
- **Court-by-court or time-slot booking: absent.** The bookable unit is a spot on a date (`bookings.session_date` → `sessions.date` PK). There are no court or slot tables — [scripts/migrate.mjs](scripts/migrate.mjs), [lib/db.ts](lib/db.ts)
- **Multiple venues: absent.** Venue is a single CMS value or calendar-event text — [sanity/schema.ts](sanity/schema.ts)
- **Coaching and lessons: absent.** The only matches are the donation copy "Beginner coaching & club socials" ([lib/i18n.ts](lib/i18n.ts) line 137) and a jersey admin hint mentioning "a coach" ([app/admin/jersey/new/page.tsx](app/admin/jersey/new/page.tsx))
- **Tournaments, brackets and leagues: absent.** What exists instead:
  - The mini-game single round-robin draw — [lib/mini-game.ts](lib/mini-game.ts)
  - Informal pair challenges — [lib/arena-db.ts](lib/arena-db.ts)
  - "Leagues" in the code are rank tiers, not competitions — [lib/ranks.ts](lib/ranks.ts) `LEAGUES`
  - The grep matches for "bracket" are an unrelated code comment and accounting brackets
- **Ratings (Elo, DUPR, UTR and the like): absent.** Wolf Points reward activity and wins, losses never cost points, and there is no skill estimate — [lib/ranks.ts](lib/ranks.ts); README
  - Organiser-assigned tiers (Tier 1/2 on the court board, tiers 1–4 in the mini-game) are manual — [lib/casual-play.ts](lib/casual-play.ts), [lib/mini-game-roster.ts](lib/mini-game-roster.ts)
- **Guest passes, multi-visit packs, credits and wallet: absent.** A grep for `guest pass|guest_pass` found no matches, and I found no credit balance table (section 5 table list)
- **Family or household accounts: absent.** A grep for `family|household|dependent` matched 32 files, but I did not open them. No household or dependent table appears in the table list
- **Waivers: absent** (a grep for "waiver" found 0 matches)
- **Check-in and door access: absent** as a facility feature. The "check-in" code in the Arena is a 5-digit code between two pairs to start a challenge, and API-submitted "check-ins" are self-reported attendance waiting for admin confirmation. There is no kiosk, QR or door integration — [lib/arena-db.ts](lib/arena-db.ts), [app/admin/players/page.tsx](app/admin/players/page.tsx) (`confirmCheckIn`), [app/api/v1/me/activity/route.ts](app/api/v1/me/activity/route.ts)
- **POS: absent.** Cash sales are recorded by an admin as Stripe invoices "paid out of band" — [app/admin/shop/page.tsx](app/admin/shop/page.tsx), [app/admin/members/page.tsx](app/admin/members/page.tsx). An online merch shop does exist — [lib/shop-db.ts](lib/shop-db.ts)
- **Multi-language: partial.** English and Vietnamese only, compiled in — [lib/i18n.ts](lib/i18n.ts)
- **Accessibility: partial and unaudited.** `aria-` attributes or a11y references appear in 59 files and `prefers-reduced-motion` in 7 (grep counts). The plans mention touch-target sizing ([docs/plans/player-profiles.md](docs/plans/player-profiles.md) §5a.4; commit `3cfbed5` "touch targets"). There is no automated a11y testing in [tests/](tests/)
- **Native app: absent.** It is a PWA only — [app/manifest.ts](app/manifest.ts), [public/sw.js](public/sw.js)
- **Push notifications: absent** (no Push API code found)
- **Reporting and analytics: finance only.** The ledger, monthly chart, Excel exports and AGM report exist; occupancy, retention and cohort dashboards do not — [app/admin/financials/*](app/admin/financials/page.tsx)
- **Refunds and credits: minimal.** Only the automatic oversold refund; there is no admin refund UI and no credits — [app/api/stripe-webhook/route.ts](app/api/stripe-webhook/route.ts)
- **Staff roles and audit log: absent** — [lib/admin-session.ts](lib/admin-session.ts)
- **Sport-specific assumptions:**
  - BWF scoring ("one game to 21") in challenges
  - Shuttle and racket rank art: Feather Shuttle, Plastic Shuttle, Diamond Racket
  - The court-to-player table assumes doubles badminton (6 per court and the like)
  - Sources: [lib/ranks.ts](lib/ranks.ts), [lib/rank-art.ts](lib/rank-art.ts), [lib/constants.ts](lib/constants.ts), README
- **Engineering readiness signals:**
  - TypeScript throughout, zod validation, rate limiting, CSP headers, and hashed tokens and codes — README "Security"; [lib/security.ts](lib/security.ts), [next.config.ts](next.config.ts)
  - Unit tests only for pure logic (8 test files, for example ranks, periods, phone and EXIF). There are no integration or e2e tests — [tests/](tests/)
  - Preview deployments share the production database (mitigated only for the Arena with `pv_` prefixes) — README
  - Free-tier constraints are designed in: Hobby cron limit of once a day, Resend 100 emails a day, 10 SMS a day, 1 GB of Blob storage — README

### Inferences
- The realistic options for white-labelling are:
  1. Single-tenant fork-per-club: the lowest effort. Extract a `club.config.ts` (name, colours, fonts, logo, time zone, currency, locale, phone country, play days, prices, capacity table, contact emails) and theme the CSS variables. Each club gets its own Vercel project, database, Stripe account, calendar and Sanity dataset.
  2. True multi-tenant SaaS: a `clubs` table, a `club_id` on every table with new composite keys (especially `sessions`), tenant resolution by domain in `middleware.ts`, Stripe Connect, per-tenant calendar and Resend domains, named admin users with roles, and dynamic product and plan definitions in place of the `friday|wednesday` × `monthly|quarterly` types.
- Supporting tennis, pickleball, padel and table tennis would also require court or table resources with time-slot booking, sport-aware scoring (tennis sets, pickleball to 11, padel), and neutral or configurable rank art and terminology.
- The modules most reusable as product differentiators are the open-play court board ([lib/casual-play.ts](lib/casual-play.ts)), the Arena and points ladder ([lib/ranks.ts](lib/ranks.ts), [lib/arena-db.ts](lib/arena-db.ts)), roster and attendance-driven streaks ([lib/stats-db.ts](lib/stats-db.ts)), membership self-service with Stripe schedules ([lib/membership-self-service.ts](lib/membership-self-service.ts)), Stripe-to-ledger sync and bank reconciliation ([lib/finance-stripe.ts](lib/finance-stripe.ts), [lib/bank-match.ts](lib/bank-match.ts)), and the player API, webhooks and MCP server ([lib/api-v1.ts](lib/api-v1.ts), [app/api/mcp/route.ts](app/api/mcp/route.ts)).

### Gaps
- I did not open the 32 files matching `family|household|dependent`. These are likely copy or unrelated uses, but this is unconfirmed.
- I did not measure performance, load capacity or code quality beyond structure. No effort estimate for multi-tenancy was derived from the code; any estimate would be speculative.
- I did not review `docs/plans/challenges.md` §11 and `docs/plans/player-profiles.md` §13 line by line against the implementation, so some planned items, such as seasons UI details, may be only partly built.
