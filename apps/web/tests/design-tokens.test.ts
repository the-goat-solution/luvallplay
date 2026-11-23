// @luvallplay/ui: the Luvallplay brand tokens and the Three Wolves club theme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brandCss, luvallplay, threeWolvesCssVars } from "@luvallplay/ui";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the Three Wolves theme is exactly what globals.css renders (the site looks the same)", () => {
  const css = read("../app/globals.css");
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const declared = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  assert.deepEqual(declared, threeWolvesCssVars());
});

test("packages/ui/src/tokens.css is up to date with the brand tokens", () => {
  assert.equal(read("../../../packages/ui/src/tokens.css"), brandCss());
});

test("brand colours: text pairs meet WCAG AA in both themes (as the brand book says)", () => {
  const lum = (hex: string) => {
    const n = hex.slice(1);
    const c = [0, 2, 4]
      .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const C = luvallplay.color;
  const text: [keyof typeof C, keyof typeof C][] = [
    ["on-court-green", "court-green"],
    ["on-smash-lime", "smash-lime"],
    ["on-rally-coral", "rally-coral"],
    ["ink", "surface"],
    ["ink", "surface-raised"],
    ["ink-muted", "surface"],
    ["ink-muted", "surface-raised"],
    ["danger", "surface"],
    ["danger", "surface-raised"],
  ];
  const nonText: [keyof typeof C, keyof typeof C][] = [
    ["control-border", "surface"],
    ["control-border", "surface-raised"],
    ["focus", "surface"],
    ["focus", "surface-raised"],
  ];
  for (const theme of luvallplay.themes) {
    for (const [fg, bg] of text) assert.ok(ratio(C[fg][theme], C[bg][theme]) >= 4.5, `${fg} on ${bg} (${theme})`);
    for (const [fg, bg] of nonText) assert.ok(ratio(C[fg][theme], C[bg][theme]) >= 3, `${fg} on ${bg} (${theme})`);
  }
});

test("brand colours are valid hex in both themes", () => {
  for (const [name, v] of Object.entries(luvallplay.color)) {
    for (const theme of luvallplay.themes) assert.match(v[theme], /^#[0-9a-f]{6}$/i, name);
  }
});
