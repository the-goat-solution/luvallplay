# Luvallplay website Studio

Content editing for the public site (`apps/site`): site settings (launch mode), every home page section, pages, help articles, FAQ, legal pages, the curated club list, sports and quotes. Every text has an English and a Vietnamese box.

- Hosted on Sanity at `https://luvallplay.sanity.studio` (`pnpm --filter site-studio deploy`).
- The project id comes from `SANITY_STUDIO_PROJECT_ID` (see `project.ts`).
- Seed or re-seed the content from the repo: `pnpm --filter site sanity:seed` (needs `SANITY_PROJECT_ID` and `SANITY_API_WRITE_TOKEN`; it only creates documents that don't exist yet unless you pass `--overwrite`).

Setup, publishing and the launch switch are described in `docs/plans/phase-6-runbook.md`.
