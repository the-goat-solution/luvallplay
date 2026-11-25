// Phase 3 step 7: the CI scan for money arithmetic (build plan §6.5: "every
// divide-by-100 in the code must be audited"). Money is converted only by
// packages/core/src/money.ts; a new "/ 100" or "* 100" anywhere else fails
// here, unless its file is listed below with what the number is.

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

// Not money: file → how many such lines it has, and what they are. A new one
// in a listed file fails too (the count changes).
const NOT_MONEY: Record<string, [count: number, what: string]> = {
  "apps/web/app/admin/(console)/setup/page.tsx": [1, "storage used, as a percentage"],
  "apps/web/app/admin/(console)/photos/page.tsx": [1, "storage used, as a percentage"],
  "packages/vision/src/engine/hits.ts": [1, "rounding a measurement to two decimals"],
  "packages/vision/src/engine/shuttle.ts": [1, "a heat-map weight"],
  "packages/vision/src/engine/engine.ts": [1, "rounding a quality score to two decimals"],
  "apps/web/components/mini-game/MiniGame.tsx": [1, "progress bar width"],
  "apps/web/components/admin/finance/MonthlyChart.tsx": [1, "tooltip position, as a percentage"],
  "apps/web/components/Schedule.tsx": [1, "spots bar width"],
  "apps/web/components/casual-play/CasualPlay.tsx": [1, "games bar width"],
  "apps/web/components/profile/player/PlayerStatsView.tsx": [1, "win rate"],
  "apps/web/components/arena/ArenaView.tsx": [1, "rank progress bar"],
  "apps/web/components/arena/RankCard.tsx": [1, "rank progress bar"],
  "packages/vision/src/ui/copy.ts": [2, "capture quality, as a percentage"],
  "packages/vision/src/ui/MatchAnalyzer.tsx": [6, "scores and quality, as percentages"],
  "packages/vision/src/ui/overlay.ts": [4, "confidence, as percentages"],
  "apps/web/components/leaderboard/LeaderboardView.tsx": [1, "ladder progress bar"],
};

test("nothing outside the money helpers multiplies or divides by 100", () => {
  const dirs = ["app", "lib", "components", "context", "hooks"].map((d) => join(WEB, d)).concat(join(ROOT, "packages"));
  const found: Record<string, string[]> = {};
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const rel = relative(ROOT, file);
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        // Code only: a comment may talk about dividing by 100.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (/[*/] ?100(?![\d_.])/.test(line)) (found[rel] ??= []).push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    }
  }
  const offenders: string[] = [];
  for (const [rel, hits] of Object.entries(found)) {
    const allowed = NOT_MONEY[rel]?.[0] ?? 0;
    if (hits.length !== allowed) offenders.push(...(allowed ? [`${rel}: ${hits.length} such lines, ${allowed} listed`] : []), ...hits);
  }
  assert.deepEqual(offenders, [], "use toMinor / fromMinor / formatMoney from lib/money (or list the file in NOT_MONEY with what the number is)");
  const stale = Object.keys(NOT_MONEY).filter((rel) => !found[rel]);
  assert.deepEqual(stale, [], "listed in NOT_MONEY but has no such line any more");
});

test("the currency code is written once, not typed into payment calls", () => {
  const dirs = ["app", "lib", "components", "context", "hooks"].map((d) => join(WEB, d)).concat(join(ROOT, "packages"));
  // Where a currency code is the subject, not an assumption.
  const allowed = new Set([
    "apps/web/lib/constants.ts", // CLUB_CURRENCY, the one place
    "packages/core/src/money.ts", // the table of currencies
    "apps/web/lib/bank-akahu.ts", // Akahu is New Zealand's bank feed: it reports NZD balances
    "apps/web/lib/bank-match.ts", // words to ignore when matching NZ bank references
    "apps/web/lib/payments/stripe-provider.ts", // the currencies this provider takes
    "apps/web/lib/payments/fake-provider.ts", // the test provider's currencies
  ]);
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const rel = relative(ROOT, file);
      if (allowed.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (/["'`](nzd|NZD|aud|AUD|vnd|VND|usd|USD)["'`]/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "use the club's currency (config.currency, useClub().currency or CLUB_CURRENCY) instead of a typed code");
});
