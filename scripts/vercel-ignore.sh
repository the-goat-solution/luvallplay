#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the two projects in this repository.
#   exit 0 = skip the build, exit 1 = build.
#
#   bash ../../scripts/vercel-ignore.sh site   (project luvallplay-site, root apps/site)
#   bash ../../scripts/vercel-ignore.sh web    (project three-wolves-badminton, root apps/web)
#
# The public site rebuilds only when its own files or the lockfile change.
# The platform app skips a build only when every changed file belongs to the
# public site, its Studio or the docs. Anything unclear builds.
set -u
app="${1:-}"
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

if [ -z "$prev" ] || ! git cat-file -e "$prev^{commit}" 2>/dev/null; then
  echo "No previous deployment to compare with: building."
  exit 1
fi
changed="$(git diff --name-only "$prev" HEAD 2>/dev/null)" || exit 1
if [ -z "$changed" ]; then
  echo "No file changes since the last deployment: building to be safe."
  exit 1
fi

case "$app" in
  site)
    if echo "$changed" | grep -qE '^(apps/site/|pnpm-lock\.yaml$|package\.json$|pnpm-workspace\.yaml$|\.npmrc$|scripts/vercel-ignore\.sh$)'; then
      echo "Public site files changed: building."
      exit 1
    fi
    echo "Nothing for the public site in this change: skipping."
    exit 0
    ;;
  web)
    if echo "$changed" | grep -qvE '^(apps/site/|apps/site-studio/|docs/)'; then
      echo "Files outside the public site changed: building."
      exit 1
    fi
    echo "Only public-site, Studio or docs files changed: skipping."
    exit 0
    ;;
  *)
    echo "Unknown app '$app': building."
    exit 1
    ;;
esac
