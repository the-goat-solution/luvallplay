# Three Wolves Badminton Club

Production website for Three Wolves Badminton Club (Christchurch, NZ).

## Stack

- **Next.js 15** (App Router) on Vercel
- **Sanity CMS** — content at `/studio`
- **Stripe** — casual ($10), monthly ($33), quarterly ($85 / 3 months), donations (custom amount, one-time or monthly)
- **Vercel Postgres** — sessions, bookings, waitlist, memberships
- **Google Calendar** — source of truth for bookable session dates (synced daily via cron)
- **Resend** — admin headcount alerts and the automatic play day roster email

## Design changes from prototype

- **UTM Copperplate** fonts for full Vietnamese support
- **Quarterly** plan replaces Annual ($85 every 3 months, ~15% savings)
- **Next upcoming session** selectable in calendar (viewable in left panel, not bookable within 14 days)
- **Monthly/Quarterly memberships** available for both Friday and Wednesday sessions (same price, separate Stripe products/prices per day — see `scripts/stripe-setup.mjs`)
- **14-day** casual booking window (sessions closer than 14 days are locked)

## Setup

```bash
npm install
cp .env.example .env.local
```

### Database

Link Vercel Postgres in the dashboard, then:

```bash
npm run db:migrate
```

### Stripe (test)

```bash
STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
```

Add printed price/product IDs to `.env.local` (including `STRIPE_PRODUCT_DONATION`). Configure webhook:

- URL: `https://your-domain.vercel.app/api/stripe-webhook`
- Events: `payment_intent.succeeded`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`

### Membership status emails

Renewal reminders, failed-payment (dunning), and expiring-card emails for monthly/quarterly members are handled natively by Stripe — no code needed. In the Stripe Dashboard, go to **Settings → Billing → Subscriptions and emails** and enable:

- **Send emails about upcoming renewals** (renewal reminders)
- **Send emails when card payments fail**
- **Send emails about expiring cards**

These use the email already attached to each Stripe Customer (set at signup — see `app/api/create-subscription/route.ts`) and your account's [branding settings](https://dashboard.stripe.com/settings/branding). Test emails only send in a sandbox to your verified email domain or team member addresses.

### Casual booking confirmation & play day reminders

On a successful **casual card payment**, Stripe emails the customer its own receipt/invoice, and the webhook (`app/api/stripe-webhook`) additionally sends a Resend confirmation email with the play day's date, time, and location — same visual template as the day-before reminder below.

A day-before cron (`/api/cron/membership-reminders`, schedule in `vercel.json`) sends a "see you tomorrow" reminder — date, time, location — to everyone confirmed for tomorrow's play day: active monthly/quarterly members **and** casual bookers with a confirmed booking for that date. Each booking/membership is only ever reminded once per play day (dedup via `bookings.reminder_sent_at` and the `membership_reminders_sent` table).

### Play day roster

Every day at 4:00 PM NZ time, a Vercel Cron job (`vercel.json` → `/api/cron/send-roster`) checks whether there's a session scheduled for that date (from the synced Google Calendar — not limited to Fridays) and, if so, emails the full player list to `CLUB_ROSTER_EMAIL` (default `threewolvesbadminton@gmail.com`). If no session is scheduled that day, it's a no-op. The roster combines:

- **Casual bookers** — anyone with a confirmed paid booking for that date.
- **Members** — anyone with an active monthly/quarterly subscription covering that date. Members are auto-included; there's no separate signup step, since their subscription period *is* their play-day window (renews automatically each billing cycle via the Stripe webhook). A subscription set to auto-renew counts for play days beyond its current billing period as well: `period_end` only advances once Stripe's renewal invoice is paid, so without that projection every member would drop off the roster for the next play day past their current cycle and the court would be oversold. One-time (non-recurring) memberships and subscriptions already set to cancel stop at `period_end`.

Set up:
- `RESEND_API_KEY` / `EMAIL_FROM` — provision via `vercel integration add resend/resend-email` (Vercel Marketplace), or manually in the [Resend dashboard](https://resend.com). `EMAIL_FROM` must be a verified sending address/domain.
- `CRON_SECRET` — set automatically by Vercel when a project has cron jobs; also protects manual calls to the endpoint.

View the roster for any past or upcoming play day at `/admin/play-days` — pick a date from the dropdown. Log in at `/admin/login` with just a password (set `ADMIN_PASSWORD`).

> Note: Vercel Cron runs in UTC with no DST awareness. The schedule (`0 3 * * *`) targets 4:00 PM NZDT (daylight saving); during NZST (non-DST months) the check will run around 5:00 PM instead.

### Sanity

1. Create a project at [sanity.io](https://www.sanity.io)
2. Set `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET`
3. Open `/studio` to edit content

### Google Calendar (bookable dates)

The site's bookable session dates are read from a Google Calendar — whatever event you add there becomes a bookable date on the site (not limited to Fridays).

1. Create a Google Cloud service account and download its JSON key.
2. Share the target Google Calendar with the service account's email (read access is enough).
3. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (with literal `\n` line breaks), and `GOOGLE_CALENDAR_ID` in `.env.local` / Vercel.
4. The `sync-calendar` cron job (`vercel.json`) pulls events once daily at 3:00 PM NZDT (schedule: `0 2 * * *`, UTC — the Vercel Hobby plan only allows one run per day per cron job). To sync manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.vercel.app/api/cron/sync-calendar`

> Note: Vercel Cron runs in UTC with no DST awareness. The schedule targets 3:00 PM NZDT (daylight saving); during NZST (non-DST months) the sync will run around 2:00 PM instead.

### Headcount alerts

The club targets 8–12 paid players per session (casual bookings + active monthly/quarterly members). A daily cron job checks each session in the next 5 days and emails the admin via Resend if a date drifts outside that range — once per state change, not on every run.

1. Create a [Resend](https://resend.com) account, verify a sending domain, and get an API key.
2. Set `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, and `ALERT_ADMIN_EMAILS` (comma-separated) in `.env.local` / Vercel.
3. Set `CRON_SECRET` — Vercel Cron sends this automatically as a bearer token to authorize `/api/cron/*` routes.
4. To test manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.vercel.app/api/cron/headcount-alerts`

Note: monthly/quarterly members are counted as attending every session for as long as their membership is active/paid — there's no per-session RSVP for members, so the count is an estimate, not a confirmed headcount.

### Financials (`/admin/financials`)

A ledger of every dollar in and out of the club, with filters, totals, receipts and an Excel export.

- **Money in is imported from Stripe automatically.** The import reads Stripe's balance transactions, so each card payment shows its **gross** amount as *Received*, and **Stripe's fee** and any **refund** show up as separate *Spent* lines. That way the net total matches what reaches the bank. Payouts to the club's bank account are not income or expenses, so they're skipped. Cash recorded with "Add cash member" or "Add cash booking" (Stripe invoices marked paid out of band) is imported with method *Cash*. Imported rows are read-only; each one links to the payment in Stripe.
- **Syncing:** the import runs whenever the page is opened and the last sync is more than 10 minutes old, nightly via `/api/cron/sync-finance` (`vercel.json`), and on demand with **Sync now**. The first sync imports your whole Stripe history. **Re-import full history** rescans everything; it's safe to run because rows are matched by their Stripe ID.
- **Expenses and other income** (court hire, shuttlecocks, sponsorship by bank transfer, …) are added with **+ Record expense or income**. These rows can be edited and deleted.
- **Receipts:** a photo or PDF up to 4 MB can be attached to each entry. Phone photos are shrunk in the browser first. Files are stored in **Vercel Blob as private files** and can only be viewed by a logged-in admin. To set it up, create a Blob store (choose *Private*) under Vercel → Storage and connect it to the project, which sets `BLOB_READ_WRITE_TOKEN`.
- **Periods:** defaults to *This month*. The presets are This month, Last month, Last 3/6/12 months (whole calendar months, including the current one), Financial year to date, Last financial year and All time, plus a custom From/To range. The club's **financial year runs 1 April – 31 March** (`FINANCIAL_YEAR_START_MONTH` in `lib/finance.ts`). The **Year to date** card covers 1 April → today and uses the same type, source, method and search filters as the table.
- **Monthly trend chart:** received vs. spent per month with a net line. It covers the selected period, or the financial year so far when only one month is selected. Hover a month for its figures; there's also a table view.
- **Math:** amounts are stored as integer cents, and totals are summed in Postgres over exactly the same filter as the table. Dates use NZ time, so a payment at 9am on the 1st counts toward that month.
- **Export to Excel** downloads exactly the current view: a *Transactions* sheet (live SUMIF totals, frozen header, autofilter, links to receipts and Stripe) and a *Summary* sheet comparing the period with year to date, broken down by source.

#### Bank & reconciliation (`/admin/financials/bank`)

- **Opening balances:** enter the ANZ balance and the cash on hand at the start of a date, ideally 1 April. Everything is counted forward from there.
- **Money held:** bank, Stripe balance (live), cash on hand (opening cash + cash in − cash out − cash banked) and the total. A **balance check** compares the bank's own reported balance with opening balance + imported lines, and flags any gap, which usually means missing statement lines.
- **Reconciling:** every bank line is matched to a ledger entry or classed as a *Stripe payout*, *cash deposit*, *cash withdrawal*, *transfer between club accounts* or *ignored*. Clear cases are matched automatically: Stripe payouts by amount and arrival date, and a single bank- or card-paid entry with the same amount within 10 days. Anything else can be matched by hand or turned into a new entry in one click. The page also lists bank-paid ledger entries that haven't shown up in the bank yet.

**Getting ANZ data in.** ANZ NZ shares account data only with MBIE-accredited providers (open banking under the Customer and Product Data Act), so the club can't call an ANZ API directly. There are three ways in, and all three can be used together because duplicates are skipped:

1. **Akahu (recommended, automatic):** Akahu is an accredited NZ open-banking provider. Its *personal apps* are free for your own accounts.
   1. Sign up at [akahu.nz](https://www.akahu.nz) with the ANZ login that holds the club account and connect ANZ.
   2. At [my.akahu.nz/developers](https://my.akahu.nz/developers), create a Personal App.
   3. Set `AKAHU_APP_TOKEN` (App ID Token) and `AKAHU_USER_TOKEN` (User Access Token) in Vercel. Set `AKAHU_ACCOUNT_ID` too if more than one account is connected; the error message lists the ids.
   4. The account syncs nightly with the Stripe import (`/api/cron/sync-finance`), and on **Sync bank now**. Akahu refreshes from ANZ about once a day.
2. **CSV import (no setup):** export from ANZ Internet Banking as CSV and upload it on the page. Re-importing, or overlapping with the Akahu feed, is safe.
3. **Inbound webhook (`POST /api/bank/webhook`):** for bank data pushed to the club. Set `BANK_WEBHOOK_SECRET`.
   - **Akahu webhooks** (full Akahu apps only): subscribe with `state` set to the secret. Each event triggers a pull from Akahu.
   - **Anything else**, such as a future ANZ data-sharing provider, Zapier/Make or a script: `Authorization: Bearer <secret>` with `{ "account", "balance", "transactions": [{ "id", "date", "amount", "description", "reference", "balance" }] }`. Amounts are NZD dollars, + in / − out, and ids must be stable.

#### Annual report (`/admin/financials/report`)

The year's accounts for the AGM, in the NZ Tier 4 not-for-profit cash format (PBE SFR-C):
- a **Statement of Receipts and Payments** by source, with the previous year alongside (the same period, while the year is still in progress);
- **cash and bank** at the start and end of the year, with a check that opening funds + surplus = closing funds (which needs opening balances on or before 1 April);
- a month-by-month table.

Use **Print / save as PDF** for a clean copy.

### Casual play court board (`/casual-play`)

A live court board for ordinary play days (not mini game days), in the spirit of Reclub's open-play match generator. It isn't linked from the main site; admins get a **Court board ↗** link in the admin nav. Put it on the venue TV (**Full screen**) and let players open it on their phones.

- **Players** come from the play day's roster on `/admin/play-days`: casual bookers and members, with a fill-in taking their player's place. Organisers can add walk-ins by name. Only first names are shown (with a last initial when two people share one), and organisers can rename anyone to their club nickname.
- **Tiers:** organisers drag players into **Tier 1**, **Tier 2** or **Not playing** (on a phone: press and hold, or tap a name and then *Move here*). Tiers and nicknames are remembered per person, so next week starts already sorted. Tiers are only shown to organisers.
- **Rotation:** every team is one tier 1 player with one tier 2 player (two same-tier players only team up when a tier is short). When an organiser taps **Game finished** (two taps, so a stray tap can't end a game), the next game goes straight onto that court. Players with the fewest games go first, then whoever has waited longest. Repeat partners, repeat opponents and the same four players are avoided. **Up next** previews the next game so those players can get ready; it accounts for the game that has been on longest, so it rarely changes.
- **Organiser tools:** courts in use (1–4), **Finish · next game on** on each court (shows who goes on next; two taps), **Break / Back in** for a player who needs a rest (anyone on court is swapped for the next player from the same tier), **Call off** a game (it doesn't count) and **Shuffle up next**.
- **Concluding the play day:** **Conclude play day** counts the games still on court, stops new games and shows everyone the night's summary: games played, time on court, and each player's games and number of different partners. Organisers can **Reopen courts** to carry on, or **Start over**, which clears the courts and game counts but keeps the tiers.
- **Local preview without a database:** `CASUAL_PLAY_DEMO=1 npm run dev`, then open http://localhost:3000/casual-play. It uses 18 sample players kept in memory (reset on restart), and the organiser password is `demo` unless `MINI_GAME_PASSWORD` is set. Demo mode is ignored in production builds.
- **Access:** anyone can view. Organisers unlock with `MINI_GAME_PASSWORD` (same password as the mini game draw); a logged-in admin is an organiser automatically. Every change is saved in Postgres (`casual_play_sessions`, `casual_play_profiles`) and shown on every open screen within a few seconds. Two organisers tapping at once can't overwrite each other.

## Development

```bash
npm run dev
```

## Deploy

Push to GitHub and import in Vercel. Add all env vars from `.env.example`.

## Security

- Stripe webhook signature verification
- Server-side pricing (never trust client amounts)
- Rate limiting on API routes
- CSP + security headers in `next.config.ts`
- Optional Cloudflare Turnstile on booking forms
