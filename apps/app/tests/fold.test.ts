// The fold of a foldable iPhone as the store app's page sees it (lib/native/fold.ts),
// and the generated CSS copies of the viewport-segments rules.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFold, foldFrom, startFold, type FoldPlugin, type FoldReport } from "../src/lib/native/fold.ts";
// @ts-expect-error a plain .mjs build script
import { COPIES, foldCopy, mediaBodies, segmentVars } from "../scripts/fold-css.mjs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function root() {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    attrs,
    props,
    style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) } as unknown as CSSStyleDeclaration,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
}

// iPhone Duo opened like a book: the inner display, with the 24px fold in the middle (the sizes the journey in tests/e2e/app.mjs uses).
const BOOK: FoldReport = { width: 951, height: 669, divisions: [{ x: 463, y: 0, width: 24, height: 669 }] };

describe("the fold, from the division regions", () => {
  test("a book: two side-by-side segments with the fold between them", () => {
    const f = foldFrom(BOOK);
    assert.equal(f.orientation, "vertical");
    assert.equal(f.vars["--seg-0-width"], "463px");
    assert.equal(f.vars["--seg-0-right"], "463px");
    assert.equal(f.vars["--seg-1-left"], "487px");
    assert.equal(f.vars["--seg-1-width"], "464px");
  });

  test("set down like a laptop: an upper and a lower segment", () => {
    const f = foldFrom({ width: 669, height: 951, divisions: [{ x: 0, y: 463, width: 669, height: 24 }] });
    assert.equal(f.orientation, "horizontal");
    assert.equal(f.vars["--seg-0-height"], "463px");
    assert.equal(f.vars["--seg-1-top"], "487px");
  });

  test("no division (fully open, closed, or an iPhone without a fold): nothing", () => {
    assert.equal(foldFrom({ ...BOOK, divisions: [] }).orientation, null);
    assert.equal(foldFrom({ ...BOOK, divisions: [{ x: 0, y: 0, width: 0, height: 0 }] }).orientation, null);
  });

  test("a division that doesn't cross the screen, or a screen with no size, is ignored", () => {
    assert.equal(foldFrom({ ...BOOK, divisions: [{ x: 0, y: 0, width: 24, height: 669 }] }).orientation, null);
    assert.equal(foldFrom({ ...BOOK, divisions: [{ x: 940, y: 0, width: 24, height: 669 }] }).orientation, null);
    assert.equal(foldFrom({ width: 0, height: 0, divisions: BOOK.divisions }).orientation, null);
  });

  test("applyFold sets and clears <html>: a fold that goes away takes its variables with it", () => {
    const r = root();
    applyFold(foldFrom(BOOK), r);
    assert.equal(r.attrs.get("data-fold"), "vertical");
    assert.equal(r.props.get("--seg-1-left"), "487px");
    applyFold(foldFrom({ ...BOOK, divisions: [] }), r);
    assert.equal(r.attrs.has("data-fold"), false);
    assert.equal(r.props.size, 0);
  });

  test("startFold reads the plugin once and follows its changes; without the plugin it does nothing", () => {
    const r = root();
    let listener: ((x: FoldReport) => void) | undefined;
    const native: FoldPlugin = {
      get: () => Promise.resolve(BOOK),
      addListener: (_e, l) => { listener = l; return { remove: async () => {} }; },
    };
    startFold(r, native);
    return Promise.resolve().then(() => {
      assert.equal(r.attrs.get("data-fold"), "vertical");
      listener!({ ...BOOK, divisions: [] });
      assert.equal(r.attrs.has("data-fold"), false);
      const other = root();
      startFold(other, undefined);
      assert.equal(other.attrs.size, 0);
    });
  });
});

describe("the generated CSS copies of the viewport-segments rules", () => {
  test("env(viewport-segment-*) becomes the variables the shell sets, keeping its fallback", () => {
    assert.equal(segmentVars("a: env(viewport-segment-width 0 0, 50vw); b: env(viewport-segment-left 1 0, 50vw)"), "a: var(--seg-0-width, 50vw); b: var(--seg-1-left, 50vw)");
  });

  test("each source's media blocks are found whole, nested braces included", () => {
    assert.equal(mediaBodies("a{} @media (horizontal-viewport-segments: 2) { .x { a: b } .y:has(.z) { c: d } } .after {}").length, 1);
    assert.match(mediaBodies("@media (horizontal-viewport-segments: 2) { .x { a: b } }")[0], /\.x \{ a: b \}/);
  });

  for (const [from, to] of COPIES as [string, string][]) {
    test(`${to} is up to date with ${from} (run \`pnpm --filter app fold:css\`)`, () => {
      assert.equal(read(to), foldCopy(read(from), from.replace("src/styles/", "")));
    });
  }

  test("the page loads each copy right after its source", () => {
    assert.match(read("src/main.tsx"), /import "\.\/styles\/app\.css";\nimport "\.\/styles\/fold-app\.css";/);
    assert.match(read("src/components/Stage.tsx"), /import "\.\.\/styles\/stage\.css";\nimport "\.\.\/styles\/fold-stage\.css";/);
  });
});
