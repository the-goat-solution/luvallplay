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
