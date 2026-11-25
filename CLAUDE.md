# Rules for this repository

## Branch and deployment rules (Vercel allows 100 deployments a day)

- Phase work happens on one long-lived branch per phase (`phase-4`, `phase-rename`, ...). Pull requests for steps target the **phase branch**, never `main`.
- `main` gets **one** merge per phase, when the whole phase passes its gate (test plan phase gates, data guard clean). The exception is a production hotfix: a small PR to `main` labelled `hotfix`, then merge `main` back into the phase branch.
- Only `main` builds on Vercel by default (`scripts/vercel-ignore.sh`). To get a preview of a branch, put `[deploy]` in the commit message, and do it sparingly (for example the phase's release-candidate push).
- GitHub CI (typecheck, tests, build, data guard) runs on every push to a phase branch and every pull request, so nothing is untested.
- Claude sessions: do not open pull requests against `main` for phase work and do not use `[deploy]` unless asked.
