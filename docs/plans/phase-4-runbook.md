# Phase 4 runbook: the players' app on a typed API

Working notes for Phase 4 of the build plan (§4). Kept up to date as the work lands. The delivery log is in `luvallplay-build-plan.md` ("Phase 4 delivery log").

## 1. Preview policy: Vercel builds a preview only when asked

**Why:** Vercel used to build a preview of every project for every push to every branch. With two projects (soon three) that was two or three builds per push, most of them never opened.

**The rule** (`scripts/vercel-ignore.sh`, tested by `scripts/vercel-ignore.test.sh`, which CI runs):

| Push to | What Vercel does |
|---|---|
| `main` | Production build of each project **whose files changed** (as before). |
| a branch named `preview/...` | Preview of each project whose files changed. |
| any other branch, **first line** of the newest commit message contains `[preview]` | Preview of each project whose files changed. |
| any other branch, first line of the newest commit message contains `[preview web]`, `[preview site]` or `[preview app]` (names can be combined: `[preview web app]`) | Preview of the named projects only. |
| anything else | **Skipped.** The deployment shows as "Canceled" with the reason in its build log. No build minutes are used. |

"Files changed" compares with the project's last successful deployment on that branch. The lockfile, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, the ignore script itself and everything in `packages/*` count for every project. Docs and CI changes build nothing. On the first asked-for preview of a branch there is nothing to compare with, so the projects asked for all build.

**Projects** (team "Timba Le's projects"):

| Project | Root | Mode | Where the rule is set |
|---|---|---|---|
| `three-wolves-badminton` | `apps/web` | `web` | `apps/web/vercel.json` `ignoreCommand`, and the project's Ignored Build Step |
| `luvallplay-site` | `apps/site` | `site` | `apps/site/vercel.json` `ignoreCommand`, and the project's Ignored Build Step |
| `luvallplay-app` (created with the app shell) | `apps/app` | `app` | `apps/app/vercel.json` `ignoreCommand`, and the project's Ignored Build Step |

The `vercel.json` value wins where it exists. The project-level setting is a backstop for older branches whose `vercel.json` has no `ignoreCommand`; it applies the "only when asked" rule itself before calling the script:

```
case "$VERCEL_GIT_COMMIT_REF" in main|preview/*);;*) git log -1 --pretty=%s|grep -qiF '[preview'||exit 0;;esac; bash ../../scripts/vercel-ignore.sh <mode>
```

Older branches that already carry the previous `apps/site/vercel.json` keep the old behaviour for the site project (build when site files change) until they merge `main`.

**How to get a preview when you want one:**

1. Put `[preview]` (or `[preview app]` and so on) in the **first line** of the message of a commit that has real changes. Only the newest commit of a push is read, and only its first line, so a message that just mentions the tag further down doesn't start a build.
2. Or work on a branch named `preview/<anything>`.
3. Or redeploy a skipped deployment: Vercel dashboard → the project → Deployments → the canceled one → ⋯ → Redeploy. An agent can do the same with its deployment tool.

Don't push empty commits to start a build.

**Not built (an option, needs a decision):** "label a pull request to get a preview". It needs a Vercel token stored as a GitHub Actions secret, so a workflow can ask Vercel to deploy the PR's branch when the label is added.

**What did not change:**

- CI in GitHub Actions is the merge gate. End-to-end journeys run against a local production build, never against a preview.
- The Phase 0 protections for previews that do build: a preview cannot reach the production database (`lib/db-switch.ts`), side effects are off outside production (`lib/side-effects.ts`), and previews get their own Neon branch (phase-1 runbook §1).
- Production deploys from `main`.

**Check the script locally:** `bash scripts/vercel-ignore.test.sh`

## 2. The players' app API (`/api/v1/app`)

**Where things are**

| Piece | Path |
|---|---|
| The contract (zod schemas, one entry per endpoint) | `packages/api/src/contract.ts`, `schemas.ts` |
| The typed client, generated from the contract | `packages/api/src/client.gen.ts` (transport: `client.ts`) |
| The snapshot released apps were built against | `packages/api/contract.snapshot.json` |
| The server wrapper every route goes through | `apps/web/lib/app-api.ts` |
| Route handlers | `apps/web/app/api/v1/app/...` |
| Queries | `apps/web/lib/repos/clubs.ts`, `sessions.ts` |

The older `/api/v1/*` routes (personal access keys, shared with the MCP server) are a different surface. They are untouched and keep `Access-Control-Allow-Origin: *`; the app API sits beside them under `/api/v1/app`.

**Endpoints so far**

| Endpoint | Who | What |
|---|---|---|
| `POST /auth/email/start`, `/auth/email/verify` | anyone | The same email code as the web. Verify answers with a session **token** (no cookie). |
| `POST /auth/sms/start`, `/auth/sms/verify` | anyone | The same text-message code as the web. |
| `GET /auth/session` | signed in | Who the token belongs to. |
| `POST /auth/logout` | signed in | Ends this session, or every session with `{ "all": true }`. |
| `GET /clubs` | signed in | The person's clubs, each with its role, its region's API base and whether the "Club admin" button shows. |
| `GET /clubs/{club}/config` | anyone | The club's look (semantic tokens, light and dark), modules that are on, terms, currency and exponent, country, region, payment mode and the settings the app needs. Public so an invite link can apply the look before sign-in. |

**Rules the wrapper applies to every route**

- **Who is calling:** `Authorization: Bearer <session token>` (the app) or the web's `tw_player` cookie. Both are rows in `player_sessions`; only the token's SHA-256 is stored. Signing in through the API never ends another session. A `tw_…` access key is not a session.
- **CORS:** an allow-list, never `*`: `https://app.luvallplay.com`, `capacitor://localhost`, `https://localhost`, plus exact origins in the `APP_ORIGINS` environment variable (comma-separated; use it for the app's Vercel URL until DNS exists). Local dev servers (`http://localhost:5173`, `:4173`) are allowed outside production only.
- **Cookie writes from another site are refused** (`403 bad_origin`); a bearer token is fine from anywhere.
- **Validation at the edge:** params, query and body are parsed with the contract's schemas. Bad input is `400` with a code (`404` for a malformed club), never `500`.
- **Rate limits:** per endpoint, per signed-in person or address. The sign-in endpoints share the web's buckets, so using both surfaces doesn't double the allowance.
- **Club scope:** `/clubs/{club}/...` answers only for the club this deployment serves (`TENANT_SLUG`); any other slug is `404 club_not_found`. An endpoint that names a `module` answers `404 module_off` when the club has it off.
- **Answers are parsed with the contract** before they are sent, which also drops any field the contract doesn't name.

**Changing the contract**

1. Edit `packages/api/src/schemas.ts` / `contract.ts`, add the route file under `apps/web/app/api/v1/app/` using `appRoute("<id>", ...)`.
2. `pnpm --filter @luvallplay/api generate` (client) and `pnpm --filter @luvallplay/api snapshot` (snapshot).
3. Adding a response field or an optional request field is fine. Removing or renaming a field, changing a type, making a request field required or a public endpoint private is refused by the snapshot script and fails `tests/api-contract.test.ts`: bump `API_VERSION` and keep serving the old version beside the new one.

**Tests**

- `apps/web/tests/api-contract.test.ts`: the snapshot, the generated client is current, contract and route files match one to one (generated from the route list, so a new route without a contract entry fails), every route goes through the wrapper.
- `apps/web/tests/app-api.test.ts`: the CORS allow-list and where a session token is read from.
- `apps/web/tests/e2e/journeys.mjs`, group "API" (API1–API7): sign in by email code and get a token, the web session is untouched, sign out and sign out everywhere, the club config, permissions for every signed-in endpoint as nobody / a made-up token / an access key / an expired session, bad input on every public POST, CORS. T1 also asks the second club's deployment for the first club's config (404) and checks a person's club list there.

Run locally (needs a local Postgres; the schema-drift suite needs Postgres 18):

```
pnpm --filter web test
pnpm --filter web e2e        # builds, then runs every journey
```

**Environment variables (all optional)**

| Name | Meaning |
|---|---|
| `APP_ORIGINS` | Extra exact origins allowed to call the API from a browser. |
| `API_BASE_<REGION>` | The API host of a region (for example `API_BASE_SYD=https://api.luvallplay.com`). Without it, a club in this deployment's region gets this deployment's own host. |
