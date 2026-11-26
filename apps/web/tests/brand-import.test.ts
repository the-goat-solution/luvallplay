// Bring your own brand (build plan §6.3.2; Phase 6 Stage B, W1): a club's
// colours become a theme that passes the same contrast floors as the 12
// ready-made schemes, whatever colours it brings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLOR_SCHEMES, FILL_CONTRAST, TEXT_CONTRAST, adjustForContrast, brandFromHtml, brandPasses, contrastRatio, importBrand, luvallplay, parseColor, readableOn, resolveClubTheme, threeWolvesTheme } from "@luvallplay/ui";

test("colours are read from the ways people write them, and nothing else", () => {
  assert.equal(parseColor("#1e3a8a"), "#1E3A8A");
  assert.equal(parseColor("1E3A8A"), "#1E3A8A");
  assert.equal(parseColor(" #abc "), "#AABBCC");
  assert.equal(parseColor("#1e3a8aff"), "#1E3A8A");
  assert.equal(parseColor("rgb(30, 58, 138)"), "#1E3A8A");
  assert.equal(parseColor("rgba(30,58,138,0.5)"), "#1E3A8A");
  for (const bad of ["", "blue", "#12", "#gggggg", "rgb(300,0,0)", "url(x)", "#1e3a8a;}", null, 7, undefined]) assert.equal(parseColor(bad), null, String(bad));
});

test("contrast is WCAG's: black on white is 21, a colour on itself is 1", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF")), 21);
  assert.equal(contrastRatio("#0E6B4F", "#0E6B4F"), 1);
  assert.ok(contrastRatio(readableOn("#FACC15"), "#FACC15") >= TEXT_CONTRAST, "dark text on yellow");
  assert.equal(readableOn("#1E3A8A"), "#FFFFFF");
});

test("a colour that already passes is left exactly as the club chose it", () => {
  assert.equal(adjustForContrast("#0E6B4F", ["#FFFFFF"], TEXT_CONTRAST), "#0E6B4F");
  const fixed = adjustForContrast("#FDE047", ["#FFFFFF"], TEXT_CONTRAST);
  assert.notEqual(fixed, "#FDE047");
  assert.ok(contrastRatio(fixed, "#FFFFFF") >= TEXT_CONTRAST);
});

test("the 12 ready-made schemes pass through unchanged in light mode, so the importer agrees with the generator", () => {
  for (const s of COLOR_SCHEMES) {
    const b = importBrand({ primary: s.light.primary, accent: s.light.accent });
    assert.ok(b, s.id);
    assert.equal(b.light.primary, s.light.primary.toUpperCase(), `${s.id}: primary`);
    assert.equal(b.light.accent, s.light.accent.toUpperCase(), `${s.id}: accent`);
    assert.deepEqual(b.adjustments.filter((a) => a.mode === "light"), [], s.id);
    assert.ok(brandPasses(b.light, b.dark), s.id);
  }
});

test("every colour a club could bring ends up readable in both modes", () => {
  // A fixed spread over the whole colour space (and the awkward corners), not random: the same every run.
  const steps = [0, 51, 102, 128, 153, 204, 255];
  const all: string[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) all.push(`#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`);
  let checked = 0;
  for (let i = 0; i < all.length; i++) {
    const primary = all[i];
    const accent = all[(i * 37 + 11) % all.length];
    const brand = importBrand({ primary, accent });
    assert.ok(brand, `${primary} ${accent}`);
    assert.ok(brandPasses(brand.light, brand.dark), `${primary} / ${accent} → ${JSON.stringify([brand.light, brand.dark])}`);
    // Every change is reported with the colour the club chose.
    for (const a of brand.adjustments) {
      assert.equal(a.original, (a.token === "primary" ? primary : accent).toUpperCase());
      assert.equal(a.adjusted, (a.mode === "light" ? brand.light : brand.dark)[a.token]);
    }
    for (const mode of ["light", "dark"] as const) for (const token of ["primary", "accent"] as const) {
      const original = (token === "primary" ? primary : accent).toUpperCase();
      const changed = brand[mode][token] !== original;
      assert.equal(brand.adjustments.some((a) => a.mode === mode && a.token === token), changed, `${mode} ${token} of ${primary}/${accent}: a change is always explained, and only a change`);
    }
    checked++;
  }
  assert.equal(checked, 343);
});

test("a pale colour is kept for decoration and a darker shade carries the text, with the reason", () => {
  const brand = importBrand({ primary: "#FDE047", accent: "#0E6B4F" })!;
  const fix = brand.adjustments.find((a) => a.mode === "light" && a.token === "primary")!;
  assert.equal(fix.original, "#FDE047");
  assert.equal(fix.reason, "link-on-light");
  assert.ok(contrastRatio(fix.adjusted, luvallplay.color.surface.light) >= TEXT_CONTRAST);
  // A dark colour disappears on the dark grounds: lifted there, untouched in light mode.
  const navy = importBrand({ primary: "#0B1B2B", accent: "#FBBF24" })!;
  assert.equal(navy.light.primary, "#0B1B2B");
  const lifted = navy.adjustments.find((a) => a.mode === "dark" && a.token === "primary")!;
  assert.equal(lifted.reason, "fill-on-dark");
  assert.ok(contrastRatio(lifted.adjusted, luvallplay.color.surface.dark) >= FILL_CONTRAST);
  assert.equal(importBrand({ primary: "not a colour", accent: "#fff" }), null);
});

test("an imported brand is what the club then wears: it is stored as a theme and resolves over the default scheme", () => {
  const brand = importBrand({ primary: "#7C2D12", accent: "#FDE68A" })!;
  const resolved = resolveClubTheme(brand.theme, "harbour-smash");
  assert.equal(resolved.scheme, null, "an imported brand, not a ready-made scheme");
  assert.equal(resolved.light.primary, brand.light.primary);
  assert.equal(resolved.light["on-primary"], brand.light.onPrimary);
  assert.equal(resolved.dark.accent, brand.dark.accent);
  assert.equal(resolved.light.surface, luvallplay.color.surface.light, "neutrals stay the shared ones");
  // Three Wolves with nothing stored still wears its own brand.
  assert.deepEqual(resolveClubTheme(null, "three-wolves").light, threeWolvesTheme("light"));
});

test("reading a brand from a club's website: its theme colour, logo and fonts, and nothing unsafe", () => {
  const html = `<!doctype html><html><head>
    <meta name="theme-color" content="#7c2d12">
    <meta property="og:image" content="/share.jpg">
    <link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple.png">
    <link rel="icon" type="image/svg+xml" href="http://insecure.example.test/icon.svg">
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;700" rel="stylesheet">
    <style>
      body { font-family: "Inter", Arial, sans-serif; color: #111111; background: #ffffff }
      h1 { font-family: 'Bebas Neue', var(--x), sans-serif; color: #7C2D12 }
      .btn { background: rgb(253, 230, 138); border-color: #fde68a } .x { color: #fde68a }
      .evil { background: url(javascript:alert(1)); font-family: "</style><script>" }
    </style></head>
    <body><img class="site-logo" src="img/logo.svg" alt="Harbour Smash"><img src="/team.jpg" alt="The team">
    <a style="color:#0e7490">x</a></body></html>`;
  const brand = brandFromHtml(html, "https://harboursmash.example.test/about/");
  assert.equal(brand.colors[0], "#7C2D12", "the page's own theme colour first");
  assert.deepEqual(brand.colors.slice(1), ["#FDE68A", "#0E7490"], "then its colours by how often they appear, greys left out");
  assert.deepEqual(brand.logos, ["https://harboursmash.example.test/about/img/logo.svg", "https://harboursmash.example.test/apple.png", "https://harboursmash.example.test/favicon.ico", "https://harboursmash.example.test/share.jpg"]);
  assert.deepEqual(brand.fonts, ["Inter", "Bebas Neue"]);
  for (const u of brand.logos) assert.match(u, /^https:\/\//);
  assert.deepEqual(brandFromHtml("", "https://x.example.test"), { colors: [], logos: [], fonts: [] });
  assert.deepEqual(brandFromHtml("<meta name=theme-color content='javascript:1'>", "not a url"), { colors: [], logos: [], fonts: [] });
});
