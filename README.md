# Three Wolves Badminton Club

Production website for Three Wolves Badminton Club (Christchurch, NZ).

## Stack

- **Next.js 15** (App Router) on Vercel
- **Sanity CMS** — content at `/studio`
- **Stripe** — casual ($10), monthly ($33), quarterly ($85 / 3 months), donations (custom amount, one-time or monthly)
- **Vercel Postgres** — sessions, bookings, waitlist, memberships
- **Resend** — automatic play day roster email

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

### Play day roster

Every Friday at 4:00 PM NZ time (2 hours before the 6:00 PM session), a Vercel Cron job (`vercel.json` → `/api/cron/send-roster`) emails the full player list for that day's session to `CLUB_ROSTER_EMAIL` (default `threewolvesbadminton@gmail.com`). The roster combines:

- **Casual bookers** — anyone with a confirmed paid booking for that date.
- **Members** — anyone with an active monthly/quarterly subscription whose current billing period covers that date. Members are auto-included; there's no separate signup step, since their subscription period *is* their play-day window (renews automatically each billing cycle via the Stripe webhook).

Set up:
- `RESEND_API_KEY` / `EMAIL_FROM` — provision via `vercel integration add resend/resend-email` (Vercel Marketplace), or manually in the [Resend dashboard](https://resend.com). `EMAIL_FROM` must be a verified sending address/domain.
- `CRON_SECRET` — set automatically by Vercel when a project has cron jobs; also protects manual calls to the endpoint.

View the current roster for any upcoming Friday at `/admin/play-days` (protected by HTTP Basic Auth — set `ADMIN_PASSWORD`).

> Note: Vercel Cron runs in UTC with no DST awareness. The schedule (`0 3 * * 5`) targets 4:00 PM NZDT (daylight saving); during NZST (non-DST months) the email will land around 5:00 PM instead.

### Sanity

1. Create a project at [sanity.io](https://www.sanity.io)
2. Set `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET`
3. Open `/studio` to edit content

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
