// Phase 3 step 4: club-specific values live in one place each, so they can
// become settings (build plan §6.2). This scan fails when a new copy of one
// is typed into the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = new URL("..", import.meta.url).pathname;
const ROOT = join(WEB, "../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

test("the club's time zone is written once (lib/constants.ts), not typed into pages and helpers", () => {
  const dirs = ["app", "lib", "components", "context", "hooks"].map((d) => join(WEB, d)).concat(join(ROOT, "packages"));
  const allowed = new Set(["apps/web/lib/constants.ts"]);
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const rel = relative(ROOT, file);
      if (allowed.has(rel)) continue;
      // A quoted literal; mentions in comments are fine.
      if (/["'`]Pacific\/Auckland["'`]/.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "use CLUB_TIME_ZONE from lib/constants (or the club's settings) instead of the literal");
});

test("the club's clock is passed to the date helpers, except in the listed helpers that can't await it yet", () => {
  // getClubToday() and clubDateKeyForInstant() without the club's clock use the
  // built-in one. These are plain (non-async) helpers; each moves when its
  // callers can hand it the clock. The list only shrinks.
  const allowed: Record<string, number> = {
    "apps/web/app/admin/(console)/financials/page.tsx": 1,
    "apps/web/app/admin/(console)/members/page.tsx": 1,
    "apps/web/app/api/casual-play/route.ts": 1,
    "apps/web/app/api/bank/webhook/route.ts": 1,
    "apps/web/lib/gallery-rotation.ts": 1,
    "apps/web/lib/arena-db.ts": 1,
    "apps/web/lib/bank-akahu.ts": 1,
    "apps/web/lib/finance-stripe.ts": 1,
    "apps/web/lib/casual-play-demo.ts": 1,
    "apps/web/lib/leaderboard-data.ts": 1,
    "apps/web/lib/shop-db.ts": 1,
  };
  const found: Record<string, number> = {};
  for (const dir of ["app", "lib", "components"].map((d) => join(WEB, d))) {
    for (const file of sourceFiles(dir)) {
      const rel = relative(ROOT, file);
      if (rel === "apps/web/lib/dates.ts") continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        // One argument or none: no clock was passed.
        if (/(?<![\w.])(getClubToday|getClubTodayDate)\(\w*\)/.test(line) || /(?<![\w.])clubDateKeyForInstant\((?:[^(),]|\([^()]*\))*\)/.test(line)) found[rel] = (found[rel] ?? 0) + 1;
      }
    }
  }
  assert.deepEqual(found, allowed, "pass the club's clock: getClubToday(now, await clubClock()), or useClub().clock in the browser");
});
