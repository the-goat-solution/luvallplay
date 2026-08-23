# Three Wolves Badminton Club

Production website for Three Wolves Badminton Club (Christchurch, NZ).

## Stack

- **Next.js 15** (App Router) on Vercel
- **Sanity CMS** — content at `/studio`
- **Stripe** — casual ($10), monthly ($33), quarterly ($85 / 3 months), donations (custom amount, one-time or monthly)
- **Vercel Postgres** — sessions, bookings, waitlist
- **Google Calendar** — source of truth for bookable session dates (synced hourly via cron)
- **Resend** — admin email alerts when a session's headcount drifts outside the comfortable range

## Design changes from prototype

- **UTM Copperplate** fonts for full Vietnamese support
- **Quarterly** plan replaces Annual ($85 every 3 months, ~15% savings)
- **Next upcoming Friday** selectable in calendar (viewable in left panel, not bookable within 14 days)
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

### Sanity

1. Create a project at [sanity.io](https://www.sanity.io)
2. Set `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET`
3. Open `/studio` to edit content

### Google Calendar (bookable dates)

The site's bookable session dates are read from a Google Calendar — whatever event you add there becomes a bookable date on the site (not limited to Fridays).

1. Create a Google Cloud service account and download its JSON key.
2. Share the target Google Calendar with the service account's email (read access is enough).
3. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (with literal `\n` line breaks), and `GOOGLE_CALENDAR_ID` in `.env.local` / Vercel.
4. The `sync-calendar` cron job (`vercel.json`) pulls events hourly. To sync manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.vercel.app/api/cron/sync-calendar`

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
