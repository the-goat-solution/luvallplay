// The tracker's text (packages/vision/src/ui/copy.ts) names no club and no
// money of its own: the host fills in what the club calls a player and a
// pair, and the prices. Every line, in both languages, is checked filled
// with plain words (any club), and with the website's (Three Wolves, as the
// tracker has always read there).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COPY } from "../../../packages/vision/src/ui/copy.ts";
import { fillWords } from "../../../packages/vision/src/words.ts";
type VisionHost = { words?: Parameters<typeof fillWords>[2]["words"]; prices: { live: string; upload: string } };

/** Every line: strings, and functions called with sample arguments. */
function lines(table: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      for (const args of [[1], [3], ["live"], ["upload"], ["not_found"], [2, "x"], [1, 2, 3]]) {
        try {
          const r = (value as (...a: unknown[]) => unknown)(...args);
          if (typeof r === "string") out.push(r);
        } catch {
          /* a line that needs other arguments */
        }
      }
    } else if (value && typeof value === "object") out.push(...lines(value as Record<string, unknown>).map((l) => `${key}: ${l}`));
  }
  return out;
}

const plain: Pick<VisionHost, "words" | "prices"> = { prices: { live: "€4", upload: "€2" } };
const website: Pick<VisionHost, "words" | "prices"> = {
  words: { en: { player: "wolf", players: "wolves", Player: "Wolf", Pair: "Pack" }, vi: { player: "sói", players: "sói", Player: "Sói", Pair: "Bầy" } },
  prices: { live: "NZ$5", upload: "NZ$2" },
};

test("the tracker's text, filled with plain words: no club, no money of its own, no placeholder left", () => {
  for (const lang of ["en", "vi"] as const) {
    for (const line of lines(COPY[lang] as Record<string, unknown>)) {
      const filled = fillWords(line, lang, plain);
      assert.doesNotMatch(filled, /\bwol(f|ves)\b|\bpack [ab]\b|\bsói\b|\bbầy\b|NZ\$|\$\d/i, `${lang}: ${filled}`);
      assert.doesNotMatch(filled, /\{(player|players|Player|Pair|priceLive|priceUpload)\}/, `${lang}: ${filled}`);
    }
  }
});

test("filled with the website's words, it reads as it always has", () => {
  assert.equal(fillWords(COPY.en.player(2), "en", website), "Wolf 2");
  assert.equal(fillWords(COPY.vi.player(2), "vi", website), "Sói 2");
  assert.equal(fillWords(COPY.en.teamA, "en", website), "Pack A");
  assert.equal(fillWords(COPY.vi.teamB, "vi", website), "Bầy B");
  assert.equal(fillWords(COPY.en.pickFromList, "en", website), "Choose a wolf");
  assert.equal(fillWords(COPY.en.pickNone, "en", website), "No wolves match. Not registered? Use Enter email.");
  assert.equal(fillWords(COPY.en.trialAfter, "en", website), "From 1 March 2027: NZ$5 a live match, NZ$2 a video.");
  assert.equal(fillWords(COPY.en.payBtn("live"), "en", website), "Pay NZ$5 and start");
  assert.equal(fillWords(COPY.en.player(1), "en", plain), "Player 1");
  assert.equal(fillWords(COPY.vi.teamA, "vi", plain), "Cặp A");
});
