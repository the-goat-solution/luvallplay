# Deploy checklist

## 1. Push to GitHub

```bash
git add .
git commit -m "Production Next.js site with Sanity, Stripe, Postgres"
git push origin main
```

## 2. Vercel

1. Import repo at [vercel.com/new](https://vercel.com/new)
2. Add **Vercel Postgres** storage from the project Storage tab
3. Copy env vars from `.env.example` into Project Settings → Environment Variables
4. Deploy (region: US East `iad1` is set in `vercel.json`, next to the database; see "Speed" in the README)

## 3. Stripe

```bash
STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
```

Add `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_QUARTERLY` (Friday), `STRIPE_PRICE_WEDNESDAY_MONTHLY`, `STRIPE_PRICE_WEDNESDAY_QUARTERLY` (Wednesday), publishable key, and webhook secret to Vercel.

Webhook URL: `https://YOUR_DOMAIN/api/stripe-webhook`

## 4. Database

After Postgres is linked:

```bash
vercel env pull .env.local
npm run db:migrate
```

## 5. Sanity

1. `sanity init` or create project at sanity.io
2. Set `NEXT_PUBLIC_SANITY_PROJECT_ID`
3. Visit `https://YOUR_DOMAIN/studio`

## 6. Smoke test

- Toggle EN / VI (Vietnamese diacritics in UTM Copperplate)
- Click next Friday on calendar → left card updates (view-only if within 14 days)
- Book a session 14+ days out with test card `4242 4242 4242 4242`
- Join Monthly / Quarterly subscriptions
