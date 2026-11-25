# Rename runbook: three-wolves-badminton → luvallplay

Do all of this in one sitting, on a `phase-rename` branch (see README, "Branch and deployment rules"). Only an owner of the GitHub organisation and the Vercel team can do steps 1–3.

1. **GitHub:** Settings → General → Repository name → `luvallplay`. GitHub redirects the old address for git and the web.
2. **Vercel, project for `apps/web`:** Settings → General → Project Name → `luvallplay`. Reconnect Git if Vercel asks. The `*.vercel.app` address changes: update `DEPLOYMENT_HOSTS`, Stripe/Google/Resend allowed origins that used it (docs/SETUP-player-accounts.md line ~136). Confirm Settings → Build and Deployment → Ignored Build Step is `bash ../../scripts/vercel-ignore.sh web`.
3. **Keep** `threewolvesbadminton.org` attached to that project as Three Wolves' own domain.
4. **Local clones:** `git remote set-url origin https://github.com/the-goat-solution/luvallplay`.
5. **Then change the text** that still says the old name: `scripts/vercel-ignore.sh` header, `docs/plans/phase-1-runbook.md`, `phase-2-runbook.md`, `docs/SETUP-player-accounts.md`, and `serverInfo.name` in `apps/web/app/api/mcp/route.ts` (check no MCP client pins it first).
6. **Check:** threewolvesbadminton.org loads and sign-in still works; push a `[deploy]` commit to the phase branch and confirm only that one builds.
