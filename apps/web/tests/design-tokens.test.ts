// @luvallplay/ui: the Luvallplay brand tokens and the Three Wolves club theme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLOR_SCHEMES, DEFAULT_SCHEME, SEMANTIC_TOKENS, defaultThemeCss, luvallplay, schemeTheme, threeWolvesCssVars } from "@luvallplay/ui";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the Three Wolves theme is exactly what globals.css renders (the site looks the same)", () => {
  const css = read("../app/globals.css");
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const declared = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  assert.deepEqual(declared, threeWolvesCssVars());
});

test("packages/ui/src/tokens.css is the default theme, and uses only semantic token names", () => {
  const css = read("../../../packages/ui/src/tokens.css");
  assert.equal(css, defaultThemeCss());
  const names = new Set([...css.matchAll(/--([\w-]+):/g)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), [...SEMANTIC_TOKENS].sort());
  for (const brandName of Object.keys(luvallplay.color)) {
    if (!(SEMANTIC_TOKENS as readonly string[]).includes(brandName)) assert.ok(!css.includes(`--${brandName}:`), brandName);
  }
});

test("the default scheme is Court Green, Luvallplay's own colours", () => {
  assert.equal(DEFAULT_SCHEME, "court-green");
  const light = schemeTheme(DEFAULT_SCHEME, "light");
  assert.equal(light.primary, luvallplay.color["court-green"].light);
  assert.equal(light.accent, luvallplay.color["smash-lime"].light);
  assert.equal(light["font-display"], luvallplay.font.display);
});

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

test("12 colour schemes, each passing the generator's contrast floors against the brand's real grounds (build plan §6.3.1)", () => {
  assert.equal(COLOR_SCHEMES.length, 12);
  assert.equal(new Set(COLOR_SCHEMES.map((s) => s.id)).size, 12);
  // The floors docs/plans/assets/club-color-schemes.py checks: text on fills
  // ≥ 4.5:1 in both modes; primary on the light surface and raised surface
  // ≥ 4.5:1 (it's also link text); fills ≥ 3:1 against BOTH dark grounds.
  for (const s of COLOR_SCHEMES) {
    const light = schemeTheme(s.id, "light");
    const dark = schemeTheme(s.id, "dark");
    for (const t of [light, dark]) {
      assert.ok(ratio(t["on-primary"], t.primary) >= 4.5, `${s.id}: on-primary`);
      assert.ok(ratio(t["on-accent"], t.accent) >= 4.5, `${s.id}: on-accent`);
    }
    assert.ok(ratio(light.primary, light.surface) >= 4.5, `${s.id}: primary on light surface`);
    assert.ok(ratio(light.primary, light["surface-raised"]) >= 4.5, `${s.id}: primary on light raised surface`);
    for (const ground of [dark.surface, dark["surface-raised"]]) {
      assert.ok(ratio(dark.primary, ground) >= 3, `${s.id}: dark primary vs ${ground}`);
      assert.ok(ratio(dark.accent, ground) >= 3, `${s.id}: dark accent vs ${ground}`);
    }
  }
});

test("Court Green, the default scheme, is the brand's court-green and smash-lime in both modes", () => {
  for (const mode of luvallplay.themes) {
    const t = schemeTheme("court-green", mode);
    assert.equal(t.primary, luvallplay.color["court-green"][mode], mode);
    assert.equal(t.accent, luvallplay.color["smash-lime"][mode], mode);
  }
});

test("brand colours: text pairs meet WCAG AA in both themes (as the brand book says)", () => {
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
    ["court-green", "surface"],
    ["court-green", "surface-raised"],
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
