# apps/studio: Three Wolves' Sanity Studio

The content editor for the club site (home page text, schedule, gallery, reviews). It used to be mounted inside the web app at `/studio`; since Phase 2 it's its own app, deployed by Sanity:

- **Live:** https://threewolves.sanity.studio (the site's `/studio` redirects there).
- **Run locally:** `pnpm --filter studio dev` → http://localhost:3333
- **Deploy:** `pnpm --filter studio build` then `pnpm --filter studio deploy` (needs `npx sanity login`, or `SANITY_AUTH_TOKEN` with Deploy Studio rights).

Prices, Stripe price ids and play-day capacity are no longer edited here: they live in the database (Admin → Money → Pricing & settings).
