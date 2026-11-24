#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the projects in this repository.
#   exit 0 = skip the build, exit 1 = build.
#
#   bash ../../scripts/vercel-ignore.sh web    (project three-wolves-badminton, root apps/web)
#   bash ../../scripts/vercel-ignore.sh site   (project luvallplay-site, root apps/site)
#   bash ../../scripts/vercel-ignore.sh app    (project luvallplay-app, root apps/app)
#
# Two rules, in this order (docs/plans/phase-4-runbook.md, "Preview policy"):
#
# 1. Previews build only when asked. Production (the main branch) always goes
#    on to rule 2. Any other branch is skipped unless
#      - the branch is named preview/..., or
#      - the newest commit message contains [preview] (every project), or
#        [preview web], [preview site], [preview app] (only the named ones;
#        several names may be listed: [preview web app]).
#
# 2. A project builds only when files that matter to it changed since its last
#    successful deployment on the branch. The lockfile, the workspace files and
#    the shared packages (packages/*) matter to every project. When there is
#    nothing to compare with, or anything is unclear, it builds.
#
# CI in GitHub Actions is the merge gate, not the preview. Tested by
# scripts/vercel-ignore.test.sh.
set -u
app="${1:-}"
case "$app" in
  web|site|app) ;;
  *)
    echo "Unknown app '$app': building."
    exit 1
    ;;
esac

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

ref="${VERCEL_GIT_COMMIT_REF:-}"
env="${VERCEL_ENV:-}"
msg="${VERCEL_GIT_COMMIT_MESSAGE:-}"
if [ -z "$msg" ]; then
  msg="$(git log -1 --pretty=%B 2>/dev/null || true)"
fi

# --- Rule 1: previews only when asked -------------------------------------
production=0
if [ "$env" = "production" ] || { [ -z "$env" ] && [ "$ref" = "main" ]; }; then
  production=1
fi

if [ "$production" -eq 0 ]; then
  asked=0
  case "$ref" in
    preview/*) asked=1 ;;
  esac
  if [ "$asked" -eq 0 ]; then
    # [preview] or [preview <names>], names from web, site, app.
    tag="$(printf '%s' "$msg" | grep -oiE '\[preview( +(web|site|app))*\]' | head -n 1 | tr 'A-Z' 'a-z')"
    if [ -n "$tag" ]; then
      names="$(printf '%s' "$tag" | sed -E 's/^\[preview//; s/\]$//')"
      if [ -z "$(printf '%s' "$names" | tr -d ' ')" ]; then
        asked=1
      elif printf '%s' "$names" | grep -qwE "$app"; then
        asked=1
      else
        echo "Preview asked for$names, not for $app: skipping."
        exit 0
      fi
    fi
  fi
  if [ "$asked" -eq 0 ]; then
    echo "Preview not asked for (no [preview] in the commit message, branch is not preview/...): skipping."
    exit 0
  fi
  echo "Preview asked for."
fi

# --- Rule 2: only when this project's files changed -----------------------
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$prev" ] || ! git cat-file -e "$prev^{commit}" 2>/dev/null; then
  echo "No previous deployment to compare with: building."
  exit 1
fi
changed="$(git diff --name-only "$prev" HEAD 2>/dev/null)" || exit 1
if [ -z "$changed" ]; then
  echo "No file changes since the last deployment: building to be safe."
  exit 1
fi

# Files every project depends on.
shared='^(packages/|pnpm-lock\.yaml$|package\.json$|pnpm-workspace\.yaml$|\.npmrc$|turbo\.json$|scripts/vercel-ignore\.sh$)'

case "$app" in
  site)
    if echo "$changed" | grep -qE "$shared|^apps/site/"; then
      echo "Public site or shared files changed: building."
      exit 1
    fi
    echo "Nothing for the public site in this change: skipping."
    exit 0
    ;;
  app)
    if echo "$changed" | grep -qE "$shared|^apps/app/"; then
      echo "Players' app or shared files changed: building."
      exit 1
    fi
    echo "Nothing for the players' app in this change: skipping."
    exit 0
    ;;
  web)
    # The platform app is the cautious one: it skips only when every changed
    # file clearly belongs to something else.
    if echo "$changed" | grep -qvE '^(apps/site/|apps/site-studio/|apps/app/|docs/|\.github/|scripts/vercel-ignore\.test\.sh$)'; then
      echo "Files outside the public site, the players' app and the docs changed: building."
      exit 1
    fi
    echo "Only public-site, players'-app, Studio, CI or docs files changed: skipping."
    exit 0
    ;;
esac
