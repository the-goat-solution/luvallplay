#!/usr/bin/env bash
# Tests for scripts/vercel-ignore.sh. Run: bash scripts/vercel-ignore.test.sh
# Builds a throwaway git repository, makes one commit per kind of change and
# checks the decision for each project. exit 0 from the script = skip.
set -u
script="$(cd "$(dirname "$0")" && pwd)/vercel-ignore.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
count=0

git init -q "$tmp/repo"
cd "$tmp/repo" || exit 1
git config user.email test@example.com
git config user.name test
git config commit.gpgsign false
mkdir -p apps/web apps/site apps/app apps/site-studio packages/ui docs scripts .github/workflows
for f in apps/web/a apps/site/a apps/app/a apps/site-studio/a packages/ui/a docs/a pnpm-lock.yaml .github/workflows/ci.yml README.md; do
  echo 0 > "$f"
done
cp "$script" scripts/vercel-ignore.sh
git add -A && git commit -qm base
base="$(git rev-parse HEAD)"

# commit_change <message> <file>...  -> leaves HEAD on a fresh commit off base
commit_change() {
  local message="$1"; shift
  git checkout -q --detach "$base"
  for f in "$@"; do echo "$RANDOM$RANDOM" >> "$f"; done
  git add -A && git commit -qm "$message"
}

# expect <build|skip> <app> <env> <ref> [prev]   (prev defaults to base, "none" = unset)
expect() {
  local want="$1" app="$2" env="$3" ref="$4" prev="${5:-$base}"
  [ "$prev" = "none" ] && prev=""
  count=$((count + 1))
  local out code got
  out="$(cd apps/web && VERCEL_ENV="$env" VERCEL_GIT_COMMIT_REF="$ref" VERCEL_GIT_PREVIOUS_SHA="$prev" \
    VERCEL_GIT_COMMIT_MESSAGE="" bash "$script" "$app" 2>&1)"
  code=$?
  if [ "$code" -eq 0 ]; then got=skip; else got=build; fi
  if [ "$got" != "$want" ]; then
    fail=$((fail + 1))
    echo "FAIL [$CASE] $app on $ref ($env): wanted $want, got $got ($out)"
  fi
}

# all <env> <ref> <web> <site> <app>
all() {
  expect "$3" web "$1" "$2"
  expect "$4" site "$1" "$2"
  expect "$5" app "$1" "$2"
}

CASE="main, web change";           commit_change "change" apps/web/a;        all production main build skip skip
CASE="main, site change";          commit_change "change" apps/site/a;       all production main skip build skip
CASE="main, app change";           commit_change "change" apps/app/a;        all production main skip skip build
CASE="main, docs only";            commit_change "change" docs/a;            all production main skip skip skip
CASE="main, CI only";              commit_change "change" .github/workflows/ci.yml; all production main skip skip skip
CASE="main, lockfile";             commit_change "change" pnpm-lock.yaml;    all production main build build build
CASE="main, shared package";       commit_change "change" packages/ui/a;     all production main build build build
CASE="main, ignore script";        commit_change "change" scripts/vercel-ignore.sh; all production main build build build
CASE="main, unknown root file";    commit_change "change" README.md;         all production main build skip skip
CASE="main, docs + app";           commit_change "change" docs/a apps/app/a; all production main skip skip build
CASE="main, [preview] tag is harmless"; commit_change "x [preview]" docs/a;  all production main skip skip skip

CASE="main, no previous deployment"; commit_change "change" docs/a
for a in web site app; do expect build "$a" production main none; done
CASE="main, previous sha unknown"
for a in web site app; do expect build "$a" production main 0000000000000000000000000000000000000000; done

# Feature branches: nothing builds without being asked, whatever changed.
for files in apps/web/a apps/site/a apps/app/a pnpm-lock.yaml packages/ui/a docs/a; do
  CASE="claude/*, no tag, $files";  commit_change "change" "$files"
  all preview claude/some-branch skip skip skip
  CASE="claude/*, no tag, no previous, $files"
  for a in web site app; do expect skip "$a" preview claude/some-branch none; done
done

# Asked with [preview]: the changed-files rule still applies.
CASE="claude/*, [preview], web change";     commit_change "work [preview]" apps/web/a;     all preview claude/x build skip skip
CASE="claude/*, [preview], site change";    commit_change "work [preview]" apps/site/a;    all preview claude/x skip build skip
CASE="claude/*, [preview], app change";     commit_change "work [preview]" apps/app/a;     all preview claude/x skip skip build
CASE="claude/*, [preview], docs only";      commit_change "work [preview]" docs/a;         all preview claude/x skip skip skip
CASE="claude/*, [preview], lockfile";       commit_change "work [preview]" pnpm-lock.yaml; all preview claude/x build build build
CASE="claude/*, [preview], shared package"; commit_change "work [preview]" packages/ui/a;  all preview claude/x build build build
CASE="claude/*, [PREVIEW] upper case";      commit_change "work [PREVIEW]" apps/app/a;     all preview claude/x skip skip build
CASE="claude/*, tag only in the body does not count"; commit_change "$(printf 'Title\n\nBody that mentions [preview].\n[preview]\n')" apps/web/a; all preview claude/x skip skip skip
CASE="claude/*, tag in the first line, long body"; commit_change "$(printf 'Title [preview app]\n\nBody text.\n')" apps/app/a; all preview claude/x skip skip build
CASE="claude/*, [preview], first deployment of the branch"; commit_change "work [preview]" docs/a
for a in web site app; do expect build "$a" preview claude/x none; done

# Scoped tags.
CASE="[preview app], lockfile";      commit_change "work [preview app]" pnpm-lock.yaml;     all preview claude/x skip skip build
CASE="[preview web site], lockfile"; commit_change "work [preview web site]" pnpm-lock.yaml; all preview claude/x build build skip
CASE="[preview app], web change";    commit_change "work [preview app]" apps/web/a;         all preview claude/x skip skip skip
CASE="[preview app], first deployment"; commit_change "work [preview app]" apps/app/a
expect skip web preview claude/x none; expect skip site preview claude/x none; expect build app preview claude/x none
CASE="word preview without brackets"; commit_change "fix the preview banner" apps/web/a;    all preview claude/x skip skip skip
CASE="[previews] is not the tag";     commit_change "work [previews]" apps/web/a;           all preview claude/x skip skip skip

# preview/* branches.
CASE="preview/*, web change";     commit_change "change" apps/web/a;     all preview preview/thing build skip skip
CASE="preview/*, app change";     commit_change "change" apps/app/a;     all preview preview/thing skip skip build
CASE="preview/*, docs only";      commit_change "change" docs/a;         all preview preview/thing skip skip skip
CASE="preview/*, lockfile";       commit_change "change" pnpm-lock.yaml; all preview preview/thing build build build
CASE="preview/*, shared package"; commit_change "change" packages/ui/a;  all preview preview/thing build build build
CASE="previewing/x is not preview/"; commit_change "change" apps/web/a;  all preview previewing/x skip skip skip

# The commit message from Vercel's variable wins over git when present.
CASE="message from VERCEL_GIT_COMMIT_MESSAGE"; commit_change "no tag here" apps/app/a
count=$((count + 1))
(cd apps/app && VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=claude/x VERCEL_GIT_PREVIOUS_SHA="$base" \
  VERCEL_GIT_COMMIT_MESSAGE="tagged [preview]" bash "$script" app >/dev/null 2>&1)
[ $? -eq 1 ] || { fail=$((fail + 1)); echo "FAIL [$CASE]"; }
count=$((count + 1))
(cd apps/app && VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=claude/x VERCEL_GIT_PREVIOUS_SHA="$base" \
  VERCEL_GIT_COMMIT_MESSAGE="$(printf 'Title\n\nabout [preview]')" bash "$script" app >/dev/null 2>&1)
[ $? -eq 0 ] || { fail=$((fail + 1)); echo "FAIL [$CASE, body only]"; }

# VERCEL_ENV missing: main counts as production, anything else as a preview.
CASE="no VERCEL_ENV"; commit_change "change" apps/web/a
expect build web "" main; expect skip web "" claude/x

CASE="unknown app name builds"
count=$((count + 1))
(VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=claude/x bash "$script" nonsense >/dev/null 2>&1)
[ $? -eq 1 ] || { fail=$((fail + 1)); echo "FAIL [$CASE]"; }

echo "vercel-ignore: $((count - fail))/$count checks passed"
[ "$fail" -eq 0 ]
