# Three Wolves Badminton Club

Production website for Three Wolves Badminton Club (Christchurch, NZ).

## Stack

- **Next.js 15** (App Router) on Vercel
- **Sanity CMS** — content at `/studio`
- **Stripe** — casual ($10), monthly ($33), quarterly ($85 / 3 months)
- **Vercel Postgres** — sessions, bookings, waitlist

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

Add printed price IDs to `.env.local`. Configure webhook:

- URL: `https://your-domain.vercel.app/api/stripe-webhook`
- Events: `payment_intent.succeeded`, `invoice.payment_succeeded`, `customer.subscription.updated`

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
