// The app's pure logic (no browser): theme → CSS variables, window classes,
// which tabs a club shows, storage and the persistent choices, the API host
// rule, and the messages in both languages.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "@luvallplay/i18n/app";
import { hostOfApiBase, trustedHost } from "../src/lib/api-host.ts";
import { pickLang, translator } from "../src/lib/messages.ts";
import { TABS, tabForPath, visibleTabs } from "../src/lib/nav.ts";
import { browserStorage, memoryStorage } from "../src/lib/storage.ts";
import { createStore } from "../src/lib/store.ts";
import { applyTheme, resolveMode, themeVars } from "../src/lib/theme.ts";
import { BREAKPOINTS, navKind, windowClass } from "../src/lib/window-class.ts";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("theme", () => {
  test("tokens become custom properties", () => {
    assert.deepEqual(themeVars({ primary: "#184467", "on-primary": "#ffffff", "font-display": "'Copperplate', 'Copperplate Gothic Light', serif" }), {
      "--primary": "#184467",
      "--on-primary": "#ffffff",
      "--font-display": "'Copperplate', 'Copperplate Gothic Light', serif",
    });
  });

  test("anything that isn't a plain colour or font value is dropped", () => {
    const vars = themeVars({
      primary: "red; background: url(https://evil.example/x)",
      accent: "url(https://evil.example/x)",
      surface: "#fff} body{display:none",
      ink: "expression(alert(1))<script>",
      "Bad Name": "#fff",
      "--double": "#fff",
      line: "rgba(10, 20, 30, 0.5)",
      focus: "x".repeat(300),
    });
    assert.deepEqual(vars, { "--line": "rgba(10, 20, 30, 0.5)" });
  });

  test("light or dark: the choice, or the device when the choice is 'system'", () => {
    assert.equal(resolveMode("system", true), "dark");
    assert.equal(resolveMode("system", false), "light");
    assert.equal(resolveMode("light", true), "light");
    assert.equal(resolveMode("dark", false), "dark");
  });

  function fakeRoot() {
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    return {
      props,
      attrs,
      dataset: {} as Record<string, string | undefined>,
      style: { setProperty: (n: string, v: string) => void props.set(n, v), removeProperty: (n: string) => void props.delete(n) },
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
    };
  }
  const club = { light: { primary: "#184467", accent: "#C4892A" }, dark: { primary: "#1e5a8a", accent: "#e2ae60" } };

  test("a club's look fills the page; switching mode switches its values", () => {
    const root = fakeRoot();
    assert.equal(applyTheme(root, club, "light"), "#184467");
    assert.equal(root.props.get("--primary"), "#184467");
    assert.equal(root.attrs.get("data-theme"), "light");
    assert.equal(root.dataset.look, "club");
    assert.equal(applyTheme(root, club, "dark"), "#1e5a8a");
    assert.equal(root.props.get("--accent"), "#e2ae60");
    assert.equal(root.attrs.get("data-theme"), "dark");
  });

  test("switching clubs leaves nothing of the last club; signing out leaves nothing at all", () => {
    const root = fakeRoot();
    applyTheme(root, club, "light");
    applyTheme(root, { light: { primary: "#0e6b4f" }, dark: { primary: "#2b7d64" } }, "light");
    assert.deepEqual([...root.props], [["--primary", "#0e6b4f"]]);
    assert.equal(applyTheme(root, null, "dark"), null);
    assert.deepEqual([...root.props], []);
    assert.equal(root.dataset.look, "luvallplay");
    assert.equal(root.attrs.get("data-theme"), "dark");
  });
});

describe("window classes (build plan §4.4)", () => {
  test("compact, medium, expanded, large at the plan's widths", () => {
    const cases: [number, string, string][] = [[320, "compact", "bar"], [375, "compact", "bar"], [599, "compact", "bar"], [600, "medium", "rail"], [839, "medium", "rail"], [840, "expanded", "rail"], [1199, "expanded", "rail"], [1200, "large", "sidebar"], [1920, "large", "sidebar"]];
    for (const [width, cls, nav] of cases) {
      assert.equal(windowClass(width), cls, String(width));
      assert.equal(navKind(windowClass(width)), nav, String(width));
    }
  });

  test("the stylesheet uses the same breakpoints", () => {
    const css = read("../src/styles/app.css");
    const used = [...css.matchAll(/@media \(min-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    const known: number[] = [BREAKPOINTS.medium, BREAKPOINTS.expanded, BREAKPOINTS.large];
    for (const w of used) assert.ok(known.includes(w), `${w}px is not a window class breakpoint`);
    assert.ok(used.includes(BREAKPOINTS.medium) && used.includes(BREAKPOINTS.large));
    assert.equal(BREAKPOINTS.expanded, 840);
  });
});

describe("the stylesheet's rules", () => {
  const css = read("../src/styles/app.css");
  test("only semantic and design-system tokens: no brand names, no colour literals", () => {
    assert.doesNotMatch(css, /navy|bronze|cream|court-green|smash-lime|wolf/i);
    const hex = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    assert.deepEqual(hex, []);
    const tokens = new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
    const semantic = ["primary", "on-primary", "accent", "on-accent", "surface", "surface-raised", "ink", "ink-muted", "line", "control-border", "focus", "danger", "font-display", "font-text"];
    // packages/ui/src/system.css: the design system's derived tokens, scale, elevation and motion.
    const system = [...read("../../../packages/ui/src/system.css").matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]);
    const local = ["nav-size", "head-size"];
    for (const t of tokens) assert.ok(semantic.includes(t) || system.includes(t) || local.includes(t), `--${t} is not a semantic or system token`);
  });
  test("the design system's colours are derived from the semantic tokens (bar the brand mark's coral and the success green)", () => {
    const sys = read("../../../packages/ui/src/system.css");
    const hex = [...new Set(sys.match(/#[0-9a-f]{3,8}\b/gi) ?? [])].sort();
    assert.deepEqual(hex, ["#1d7a46", "#6fd39a", "#ff6b4a"]);
  });
  test("safe areas on every edge, dynamic viewport height, reduced motion, container queries, foldables", () => {
    for (const edge of ["top", "right", "bottom", "left"]) assert.match(css, new RegExp(`env\\(safe-area-inset-${edge}\\)`), edge);
    assert.match(css, /100dvh/);
    assert.doesNotMatch(css, /100vh/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /@container screen/);
    assert.match(css, /horizontal-viewport-segments: 2/);
  });
  test("type is in rem (so it scales to 200%), touch targets are 44px", () => {
    assert.deepEqual(css.match(/font-size:\s*[\d.]+px/g) ?? [], []);
    const minHeight = (rule: RegExp) => Number(css.match(rule)?.[1]);
    assert.ok(minHeight(/\.button \{[^}]*min-height: ([\d.]+)rem/) >= 2.75);
    assert.ok(minHeight(/\.choice \{[^}]*min-height: ([\d.]+)rem/) >= 2.75);
    assert.ok(minHeight(/\.field input, \.field select \{[^}]*min-height: ([\d.]+)rem/) >= 2.75);
  });
  test("no screen names a brand colour in code either", () => {
    for (const f of ["Shell", "SignIn", "Invite", "Settings", "Me", "Placeholder"]) {
      const src = read(`../src/screens/${f}.tsx`);
      assert.doesNotMatch(src, /#[0-9a-f]{6}\b|navy|bronze|three.?wolves/i, f);
    }
  });
});

describe("tabs and modules", () => {
  const ids = (modules: string[] | null) => visibleTabs(modules).map((t) => t.id);
  test("every module on: all five tabs, in the website's order", () => {
    assert.deepEqual(ids(["arena", "vision", "memberships"]), ["me", "player", "arena", "leaderboard", "vision"]);
  });
  test("a module that is off takes its tabs away (the Arena takes the Leaderboard with it); Me and Player are always there", () => {
    assert.deepEqual(ids(["vision"]), ["me", "player", "vision"]);
    assert.deepEqual(ids(["arena"]), ["me", "player", "arena", "leaderboard"]);
    assert.deepEqual(ids([]), ["me", "player"]);
  });
  test("before the club's modules are known, a module's tab isn't shown", () => {
    assert.deepEqual(ids(null), ["me", "player"]);
  });
  test("Settings is not a tab (it is the header's ⚙)", () => {
    assert.equal(tabForPath("/settings"), null);
  });
  test("a path maps to its tab", () => {
    assert.equal(tabForPath("/arena")?.id, "arena");
    assert.equal(tabForPath("/arena/challenges")?.id, "arena");
    assert.equal(tabForPath("/arenas"), null);
    assert.equal(tabForPath("/leaderboard")?.id, "leaderboard");
    assert.equal(tabForPath("/signin"), null);
  });
  test("every tab's label exists in both languages", () => {
    for (const tab of TABS) for (const lang of ["en", "vi"] as const) assert.ok(app[lang][tab.label], `${lang} ${tab.label}`);
  });
});

describe("storage and the persistent choices", () => {
  test("browser storage reads and writes under a prefix", () => {
    const backing = new Map<string, string>();
    const s = browserStorage("lp.", { getItem: (k) => backing.get(k) ?? null, setItem: (k, v) => void backing.set(k, v), removeItem: (k) => void backing.delete(k) });
    s.set("token", "abc");
    assert.equal(backing.get("lp.token"), "abc");
    assert.equal(s.get("token"), "abc");
    s.remove("token");
    assert.equal(s.get("token"), null);
    assert.equal(backing.size, 0);
  });

  test("storage that throws (private mode, full) falls back to memory", () => {
    const boom = () => {
      throw new Error("denied");
    };
    const s = browserStorage("lp.", { getItem: boom, setItem: boom, removeItem: boom });
    s.set("token", "abc");
    assert.equal(s.get("token"), "abc");
    s.remove("token");
    assert.equal(s.get("token"), null);
    assert.equal(browserStorage("lp.", undefined).get("x"), null);
  });

  test("choices survive a restart; junk in storage is ignored", () => {
    const storage = memoryStorage();
    const a = createStore(storage);
    a.set({ token: "t1", club: "three-wolves", lang: "vi", theme: "dark", needsDetails: true });
    assert.deepEqual(createStore(storage).get(), { token: "t1", club: "three-wolves", lang: "vi", theme: "dark", needsDetails: true });
    storage.set("lang", "fr");
    storage.set("theme", "neon");
    storage.set("club", "../etc");
    assert.deepEqual(createStore(storage).get(), { token: "t1", club: null, lang: null, theme: "system", needsDetails: true });
  });

  test("signing out removes the token and the person's club, and keeps language and appearance", () => {
    const storage = memoryStorage();
    const s = createStore(storage);
    s.set({ token: "t1", club: "three-wolves", lang: "vi", theme: "dark", needsDetails: true });
    s.signOut();
    assert.deepEqual(s.get(), { token: null, club: null, lang: "vi", theme: "dark", needsDetails: false });
    assert.equal(storage.get("token"), null);
    assert.equal(storage.get("club"), null);
  });

  test("listeners hear real changes only", () => {
    const s = createStore(memoryStorage());
    let calls = 0;
    const stop = s.subscribe(() => calls++);
    s.set({ theme: "dark" });
    s.set({ theme: "dark" });
    assert.equal(calls, 1);
    stop();
    s.set({ theme: "light" });
    assert.equal(calls, 1);
  });
});

describe("which host gets the session token", () => {
  const PREFIX = "/api/v1/app";
  test("an API base is a host plus the API prefix, nothing else", () => {
    assert.equal(hostOfApiBase("https://api.luvallplay.com/api/v1/app", PREFIX), "https://api.luvallplay.com");
    assert.equal(hostOfApiBase("http://localhost:3100/api/v1/app", PREFIX), "http://localhost:3100");
    for (const bad of ["https://api.luvallplay.com", "https://x.example/evil/api/v1/app", "javascript:alert(1)/api/v1/app", "/api/v1/app", "https://a b/api/v1/app"]) assert.equal(hostOfApiBase(bad, PREFIX), null, bad);
  });
  test("a club's own host is used only when the app trusts it", () => {
    const trusted = ["https://api.luvallplay.com", "https://han.luvallplay.com"];
    const home = "https://api.luvallplay.com";
    assert.equal(trustedHost("https://han.luvallplay.com/api/v1/app", PREFIX, home, "https://app.luvallplay.com", trusted), "https://han.luvallplay.com");
    assert.equal(trustedHost("https://evil.example/api/v1/app", PREFIX, home, "https://app.luvallplay.com", trusted), home);
    assert.equal(trustedHost(undefined, PREFIX, home, "https://app.luvallplay.com", trusted), home);
    assert.equal(trustedHost("nonsense", PREFIX, home, "https://app.luvallplay.com", trusted), home);
    // The API on the app's own origin (dev proxy): stay same-origin.
    assert.equal(trustedHost("http://localhost:5173/api/v1/app", PREFIX, "", "http://localhost:5173", []), "");
    assert.equal(trustedHost("https://evil.example/api/v1/app", PREFIX, "", "http://localhost:5173", []), "");
  });
});

describe("messages", () => {
  test("English and Vietnamese have the same keys, none empty, with the same placeholders", () => {
    assert.deepEqual(Object.keys(app.vi).sort(), Object.keys(app.en).sort());
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(app.en) as (keyof typeof app.en)[]) {
      assert.ok(app.en[key].trim() && app.vi[key].trim(), key);
      assert.deepEqual(holes(app.vi[key]), holes(app.en[key]), key);
    }
  });
  test("sport-neutral: no sport, club or brand-specific word in the app's own text", () => {
    for (const lang of ["en", "vi"] as const) {
      for (const [key, text] of Object.entries(app[lang])) assert.doesNotMatch(text, /badminton|shuttle|racket|wolf|wolves|cầu lông/i, `${lang} ${key}`);
    }
  });
  test("the club's own words fill the text, per language; without a club, the neutral ones", () => {
    const terms = { pointsName: "Wolf Points", visionName: "Wolf Vision", localized: { vi: { visionName: "Mắt Sói" } } };
    assert.equal(translator("en", terms)("nav_vision"), "Wolf Vision");
    assert.equal(translator("vi", terms)("nav_vision"), "Mắt Sói");
    assert.equal(translator("en", null)("nav_vision"), "Vision");
    assert.equal(translator("vi", null)("signin_code_lead", { email: "a@b.co" }), "Chúng tôi đã gửi mã 6 chữ số tới a@b.co.");
  });
  test("language: the choice, then the account, then the device, then English", () => {
    assert.equal(pickLang("vi", "en", "en-NZ"), "vi");
    assert.equal(pickLang(null, "vi", "en-NZ"), "vi");
    assert.equal(pickLang(null, undefined, "vi-VN"), "vi");
    assert.equal(pickLang(null, "fr", "fr-FR"), "en");
    assert.equal(pickLang(null, null, null), "en");
  });
});

describe("the built page's rules", () => {
  test("index.html: no inline script, viewport-fit=cover, a theme colour, a place for the CSP", () => {
    const html = read("../index.html");
    assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /name="theme-color"/);
    assert.match(html, /<!--csp-->/);
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale/);
  });
  test("vercel.json: the ignore rule, SPA fallback, no framing, long cache for hashed assets", () => {
    const v = JSON.parse(read("../vercel.json"));
    assert.equal(v.ignoreCommand, "bash ../../scripts/vercel-ignore.sh app");
    assert.equal(v.framework, "vite");
    assert.equal(v.rewrites[0].destination, "/index.html");
    const all = Object.fromEntries(v.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    assert.equal(all["X-Frame-Options"], "DENY");
    assert.match(all["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.match(v.headers[1].headers[0].value, /immutable/);
  });
});

describe("a club's words for the tracker", async () => {
  const { clubWords } = await import("../src/lib/club-words.ts");
  test("Three Wolves' terms: Wolf, wolves, Pack; Sói and Bầy in Vietnamese", () => {
    const words = clubWords({ playerName: "Wolf", playersName: "Wolves", pairName: "Pack", localized: { vi: { playerName: "Sói", pairName: "Bầy" } } });
    assert.deepEqual(words, {
      en: { Player: "Wolf", player: "wolf", players: "wolves", Pair: "Pack" },
      vi: { Player: "Sói", player: "sói", players: "sói", Pair: "Bầy" },
    });
  });
  test("no words of its own: the tracker's plain ones; only a name and no pair: plain too", () => {
    assert.equal(clubWords({}), undefined);
    assert.equal(clubWords(null), undefined);
    assert.equal(clubWords({ playerName: "Hawk" }), undefined);
    assert.deepEqual(clubWords({ playerName: "Hawk", pairName: "Nest" })?.en, { Player: "Hawk", player: "hawk", players: "hawks", Pair: "Nest" });
  });
});
