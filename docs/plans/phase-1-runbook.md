# Phase 0 + 1 runbook: the steps that need you

Everything in the code is built and tested (see the pull request). These steps need production access (Neon, Vercel or GitHub settings), which the build session doesn't have. Do them in this order. Each one says what "done" looks like.

Run commands from a checkout of the `claude/luvallplay-phase-0-1` branch on a trusted machine, after `npm ci`.

---

## 1. Protect production from previews (Phase 0) — before anything else

The code already refuses to let a preview use the production database (`lib/db-switch.ts`). Today that means previews have **no** database at all, which is safe. To give previews their own database again:

1. **Vercel → Project `luvallplay` → Settings → Environment Variables → Add**
   - Key: `PRODUCTION_DATABASE_HOSTS`
   - Value: the production database host(s), comma-separated. Copy the host part (between `@` and `/`) of `SYD_POSTGRES_URL` **and** `SYD_POSTGRES_URL_NON_POOLING` (e.g. `ep-xxxx-pooler.ap-southeast-2.aws.neon.tech,ep-xxxx.ap-southeast-2.aws.neon.tech`). Hosts only, never the password.
   - Environments: **Preview** (and Production; it's harmless there).
2. **Vercel → Project → Storage → the Neon database (SYD) → Settings → enable "Create a database branch for each preview deployment"** (Neon integration). Previews then get their own branch, and the guard lets them use it because the host differs.
3. **Check:** open the next preview's `/api/health/db`. It should answer with a database region (branch), not an error. If the guard is blocking, the response or logs say `Database switched off on this preview`.

Separately: every preview from a feature branch currently fails on Vercel in about a second with **"Resource provisioning failed"** (before any build step), going back several branches. Production deploys from `main` work. Worth a look in the Vercel dashboard (deployment page → error details); it may be a plan or integration limit.

## 2. Require CI on `main` (Phase 0)

**GitHub → repo → Settings → Branches → Add branch ruleset (or classic rule) for `main`:**
- Require a pull request before merging, 1 approval.
- Require status checks to pass: **`Types, lint, tests, build`** (from `.github/workflows/ci.yml`).
- Block force pushes. Restrict deletions.

## 3. Rehearse the roles change on a branch of production (test plan §4.4, T−5)

1. **Neon console → project → Branches → New branch** from `main` (production), name `rehearsal-phase-1`. Copy its connection string (direct, not pooled is fine).
2. Rehearse (Timba's and Kelcee's emails are typed here, never committed):

   ```bash
   export DATA_GUARD_URL='<rehearsal-phase-1 connection string>'
   export DATA_GUARD_PRODUCTION_HOSTS='<production host>'   # makes the tool refuse if you paste the wrong URL
   npm run data-guard -- rehearse \
     --expect scripts/data-guard/expectations/2026-11-phase1-admin-roles.json \
     --out-dir .data-guard/phase-1-rehearsal \
     --run 'node scripts/run-migration.mjs scripts/migrations/2026-11-phase1-admin-roles.sql && node scripts/grant-role.mjs --role owner --platform --email <timba-sign-in-email> --email <kelcee-sign-in-email>'
   ```

   **Done when:** it prints `RESULT: ✔ passed` and `.data-guard/phase-1-rehearsal/report.md` shows **0 problems** (no `AFTER_NO_ADMIN`, `SIGNED_OUT`, `DATA_LOST`, `ACCOUNT_*`). The grant output should say both emails became `owner` with a player id. If either says "no account yet, invite", that person hasn't signed in to the app with that email: sign in once, then rerun on a fresh branch.
3. Paste `report.md` into the pull request (it holds hashes, no emails). Second person reviews it.
4. Delete the `rehearsal-phase-1` branch when done.

## 4. Restore drill + schema dump (Phase 0, once)

```bash
# Neon console → Branches → New branch → "From a point in time" = yesterday → name restore-drill
export DATA_GUARD_URL='<restore-drill connection string>'
npm run data-guard -- snapshot --out .data-guard/restore-drill.json
npm run data-guard -- check .data-guard/restore-drill.json      # done when: no errors
pg_dump --schema-only --no-owner "$DATA_GUARD_URL" > docs/schema/production-2026-11.sql
```

Commit `docs/schema/production-2026-11.sql` (schema only, no data), then delete the `restore-drill` branch.

## 5. Production (T0): quiet time, not a play-day evening

1. **Restore point:** Neon console → New branch from `main` (now), name `pre-phase-1`.
2. Snapshot, migrate, snapshot, diff:

   ```bash
   export POSTGRES_URL='<production direct connection string>'
   npm run data-guard -- snapshot --out .data-guard/prod-before.json      # read-only
   node scripts/run-migration.mjs scripts/migrations/2026-11-phase1-admin-roles.sql
   node scripts/grant-role.mjs --role owner --platform --email <timba-sign-in-email> --email <kelcee-sign-in-email>
   npm run data-guard -- snapshot --out .data-guard/prod-after.json
   npm run data-guard -- diff .data-guard/prod-before.json .data-guard/prod-after.json \
     --expect scripts/data-guard/expectations/2026-11-phase1-admin-roles.production.json
   ```

   **Done when:** the diff passes with 0 errors. Any error → stop and roll back (below).
3. Merge the pull request. Vercel deploys `main`.
4. **Smoke test production:** `/login` loads; sign in → Me page; Arena → Leaderboard; **Club admin** button → `/admin/play-days`; old URLs redirect (`/profile/account`, `/profile/membership`, `/leaderboard`).
5. Watch for an hour: sign-in success, 401/403 rate, Vercel runtime errors.

**Roll back** on any data-guard error or sign-in failure: Vercel → Deployments → previous production deployment → **Instant Rollback** first, then report. The new tables are additive, so the previous app version works with them in place.

## 6. Two weeks after the production deploy: remove break-glass (done 23 Nov 2026, Phase 2)

The `ADMIN_PASSWORD` login stays reachable at `/admin/login?breakglass=1` (every use is audited) for two weeks after the deploy. Then remove `ADMIN_PASSWORD`, `lib/admin-session.ts` and its routes, and the fallback in `lib/player-auth.ts` (`PLAYER_SESSION_SECRET` becomes required). Put the date in your calendar when you deploy: **deploy date + 14 days**.
