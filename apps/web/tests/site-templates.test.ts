// Club websites (build plan §7.3; Phase 6 Stage B, W1): the per-club content
// model and the three templates, in every colour scheme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLOR_SCHEMES, importBrand, resolveClubTheme } from "@luvallplay/ui";
import { BASE_CSS, LIMITS, SECTIONS, TEMPLATES, TEMPLATE_CSS, WORDS, emptySiteContent, normalizeSiteContent, renderDocument, renderSite, safeUrl, visibleSections, type SiteContent, type SiteData } from "@luvallplay/site-templates";

const content = (): SiteContent =>
  normalizeSiteContent({
    template: "classic",
    sections: [...SECTIONS],
    hero: { tagline: { en: "Friendly badminton, every week", vi: "Cầu lông thân thiện, mỗi tuần" }, image: "https://cdn.example.test/hero.jpg" },
    about: {
      title: { en: "A club for everyone", vi: "Câu lạc bộ cho mọi người" },
      paragraphs: [{ en: "We play twice a week.\nAll levels welcome.", vi: "Chúng tôi chơi hai buổi mỗi tuần." }, "Come and say hello."],
      images: [{ url: "/photos/one.jpg", alt: { en: "Doubles on court one" } }],
      facts: [{ value: "100+", label: { en: "sessions a year", vi: "buổi mỗi năm" } }],
    },
    schedule: { venue: { en: "Harbour Hall" }, address: { en: "1 Quay Street" }, time: { en: "Fridays, 7 to 9 pm", vi: "Thứ Sáu, 19 đến 21 giờ" }, mapUrl: "https://maps.example.test/harbour" },
    gallery: [{ url: "https://cdn.example.test/g1.jpg", alt: { en: "A smash" } }, "https://cdn.example.test/g2.jpg"],
    reviews: [{ quote: { en: "Best night of my week." }, author: "Ana N.", role: "Member" }],
    faq: [{ question: { en: "Do I need my own racket?" }, answer: { en: "No, we have spares." } }],
    contact: { email: "hello@harbour.example.test", phone: "+64 21 123 4567", links: [{ label: "Facebook", url: "https://facebook.example.test/harbour" }] },
  });

const data = (over: Partial<SiteData> = {}): SiteData => ({
  club: { name: "Harbour Smash", logoUrl: "/logo.svg" },
  lang: "en",
  theme: resolveClubTheme({ scheme: "court-green" }, "harbour-smash"),
  charging: "online",
  prices: [
    { name: "Casual", price: "$10", period: "a session", description: "Pay as you play", features: [], featured: false },
    { name: "Monthly", price: "$33", period: "every 4 weeks", description: "", features: ["A place every week"], featured: true },
  ],
  playDays: [{ label: "Fri 27 Nov", time: "7:00 pm", spotsLeft: 3 }, { label: "Fri 4 Dec", time: "7:00 pm", spotsLeft: 0 }, { label: "Fri 11 Dec", time: "7:00 pm", spotsLeft: null }],
  modules: { memberships: true, casualPlay: true, gallery: true },
  links: { join: "https://app.luvallplay.com/harbour-smash/join", book: "https://app.luvallplay.com/harbour-smash/book", app: "https://app.luvallplay.com", languages: { en: "/en", vi: "/vi" } },
  ...over,
});

const hexColours = (css: string) => css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];

test("the templates' own styles name no colour: only the club's semantic tokens", () => {
  for (const [name, css] of [["base", BASE_CSS], ...Object.entries(TEMPLATE_CSS)] as const) {
    assert.deepEqual(hexColours(css), [], `${name}: a colour written into the template`);
    assert.doesNotMatch(css, /\b(rgb|hsl)a?\(/i, name);
    assert.doesNotMatch(css, /(?<![-\w])(white|red|navy|blue|green|grey|gray)(?![-\w])/i, name);
    assert.doesNotMatch(css, /url\(|@import/i, `${name}: nothing is loaded from the styles`);
  }
  assert.deepEqual(Object.keys(TEMPLATE_CSS).sort(), [...TEMPLATES].sort());
  assert.doesNotMatch(readFileSync(new URL("../../../packages/site-templates/src/render.ts", import.meta.url), "utf8"), /#[0-9a-f]{6}\b/i);
});

test("every template renders in every one of the 12 schemes, and in an imported brand, with that theme and nothing else", () => {
  const themes = [...COLOR_SCHEMES.map((s) => [s.id, resolveClubTheme({ scheme: s.id }, "harbour-smash")] as const), ["imported", resolveClubTheme(importBrand({ primary: "#7C2D12", accent: "#FDE68A" })!.theme, "harbour-smash")] as const, ["three-wolves", resolveClubTheme(null, "three-wolves")] as const];
  let pages = 0;
  for (const [id, theme] of themes) {
    for (const template of TEMPLATES) {
      const site = renderSite(content(), data({ theme }), { template });
      assert.ok(site.css.includes(`--primary:${theme.light.primary}`), `${id}/${template}: the club's primary`);
      assert.ok(site.css.includes(`--accent:${theme.dark.accent}`), `${id}/${template}: its dark accent`);
      assert.match(site.css, /prefers-color-scheme:dark/, "dark mode follows the visitor's device");
      const doc = renderDocument(site);
      assert.match(doc, new RegExp(`<body data-template="${template}">`));
      assert.equal((doc.match(/<h1>/g) ?? []).length, 1, "one h1");
      assert.deepEqual(site.sections, [...SECTIONS]);
      for (const s of SECTIONS) assert.match(doc, new RegExp(`<section id="${s}" aria-labelledby="${s}-h">`), `${template}: ${s}`);
      assert.doesNotMatch(doc, /<script/i, "no script on the page");
      pages++;
    }
  }
  assert.equal(pages, 14 * 3);
  // Three Wolves wears its own fonts.
  assert.match(renderSite(content(), data({ theme: resolveClubTheme(null, "three-wolves") })).css, /@font-face\{font-family:"Copperplate"/);
});

test("the page is the club's: its name, its words in the visitor's language, falling back to English", () => {
  const en = renderDocument(renderSite(content(), data()));
  assert.match(en, /<html lang="en">/);
  assert.match(en, /<title>Harbour Smash<\/title>/);
  assert.match(en, /Friendly badminton, every week/);
  assert.match(en, /Join in the app/);
  assert.match(en, /3 spots left/);
  assert.match(en, />Full</);
  const vi = renderDocument(renderSite(content(), data({ lang: "vi" })));
  assert.match(vi, /<html lang="vi">/);
  assert.match(vi, /Cầu lông thân thiện, mỗi tuần/);
  assert.match(vi, /Tham gia trong ứng dụng/);
  assert.match(vi, /Harbour Hall/, "no Vietnamese given: the English is shown, not a blank");
  assert.match(vi, /<a href="\/vi" lang="vi" hreflang="vi" aria-current="true">VI<\/a>/);
  // Every word the templates add exists in both languages.
  assert.deepEqual(Object.keys(WORDS.vi).sort(), Object.keys(WORDS.en).sort());
  for (const [k, v] of Object.entries(WORDS.vi)) if (typeof v === "string") assert.ok(v.trim(), k);
  // The Luvallplay mark is always there (decision AM).
  for (const t of TEMPLATES) assert.match(renderSite(content(), data(), { template: t }).body, /on Luvallplay/);
});

test("a free-play club: 'Free to play: just turn up', and the call to action is to sign up for a play day", () => {
  const free = renderSite(content(), data({ charging: "free", prices: [] }));
  assert.match(free.body, /Free to play: just turn up/);
  assert.match(free.body, /Sign up for a play day/);
  assert.doesNotMatch(free.body, /Join in the app|Book a casual session|\$/);
  assert.ok(free.sections.includes("prices"), "the price section stays, as the free block");
  // Cash and bank transfer clubs show prices and say how to pay.
  assert.match(renderSite(content(), data({ charging: "offline" })).body, /Pay by cash or bank transfer/);
  assert.doesNotMatch(renderSite(content(), data()).body, /Pay by cash or bank transfer/);
});

test("a module that is off, or a section with nothing in it, isn't on the page", () => {
  const d = data({ modules: { memberships: false, casualPlay: true, gallery: false } });
  const site = renderSite(content(), d);
  assert.ok(!site.sections.includes("gallery"));
  assert.doesNotMatch(site.body, /Join in the app/);
  assert.match(site.body, /Book a casual session/);
  // Neither: the page still has one thing to do.
  assert.match(renderSite(content(), data({ modules: { memberships: false, casualPlay: false, gallery: true } })).body, /Get the app/);
  // An empty club: just the hero, the play days and (paid, no prices yet) nothing about prices.
  const bare = renderSite(emptySiteContent(), data({ prices: [], playDays: [] }));
  assert.deepEqual(bare.sections, []);
  assert.match(bare.body, /<h1>Harbour Smash<\/h1>/);
  // The club's own order, and a section it hid.
  const reordered = normalizeSiteContent({ ...content(), sections: ["faq", "about", "faq", "nonsense", "prices"] });
  assert.deepEqual(visibleSections(reordered, data()), ["faq", "about", "prices"]);
});

test("nothing a club types can become markup, a script or an unsafe address", () => {
  const evil = normalizeSiteContent({
    hero: { tagline: `<script>alert(1)</script>"><img src=x onerror=alert(1)>`, image: "javascript:alert(1)" },
    about: { title: "<b>bold</b>", paragraphs: ["a & b < c", { en: "x".repeat(5000) }, 7, null], images: ["data:image/svg+xml,<svg onload=alert(1)>", { url: "http://insecure.example.test/a.jpg" }, { url: "//evil.example.test/a.jpg" }], facts: [{ value: "<i>1</i>", label: "x" }] },
    schedule: { venue: "Hall", mapUrl: `https://maps.example.test/"onmouseover="alert(1)` },
    gallery: Array.from({ length: 99 }, (_, i) => `https://cdn.example.test/${i}.jpg`),
    reviews: [{ quote: "Nice", author: `"><svg onload=alert(1)>`, role: "" }, { quote: "", author: "nobody" }],
    faq: [{ question: "Q?", answer: "A\u0000\u0007." }],
    contact: { email: `a@b.test"><script>`, phone: "call me", links: [{ label: "Site", url: "javascript:alert(1)" }, { label: "Ok", url: "https://ok.example.test" }, { label: "Path", url: "/local" }] },
    template: "<script>",
    sections: "all",
  });
  assert.equal(evil.template, "classic");
  assert.equal(evil.hero.image, null);
  assert.deepEqual(evil.about.images, []);
  assert.equal(evil.schedule.mapUrl, null);
  assert.equal(evil.gallery.length, LIMITS.gallery);
  assert.equal(evil.about.paragraphs.length, 2);
  assert.equal(evil.about.paragraphs[1].en.length, LIMITS.paragraph);
  assert.equal(evil.reviews.length, 1);
  assert.equal(evil.faq[0].answer.en, "A.");
  assert.deepEqual(evil.contact, { email: null, phone: null, links: [{ label: "Ok", url: "https://ok.example.test" }] });
  const doc = renderDocument(renderSite(evil, data({ club: { name: `Harbour <Smash> & "Co"`, logoUrl: "javascript:alert(1)" }, prices: [{ name: "<img>", price: "$1", period: "", description: "", features: ["<x>"], featured: false }] })));
  // What they typed is on the page as text; no real tag carries a handler or a script address.
  assert.doesNotMatch(doc, /<script/i);
  for (const tag of doc.match(/<[a-z][^>]*>/gi) ?? []) {
    assert.doesNotMatch(tag.replace(/"[^"]*"/g, '""'), /\son\w+\s*=/i, tag);
    assert.doesNotMatch(tag, /(href|src)="(?!https:\/\/|\/(?!\/)|#|mailto:|tel:)/i, tag);
  }
  assert.doesNotMatch(doc, /<img src=x|<b>|<i>|<svg|<x>|<img>/);
  assert.match(doc, /<h1>Harbour &lt;Smash&gt; &amp; &quot;Co&quot;<\/h1>/);
  assert.match(doc, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // Addresses: https or a path on the club's own site, and nothing else.
  for (const ok of ["https://a.example.test/x.jpg", "/photos/a.jpg"]) assert.equal(safeUrl(ok), ok);
  for (const bad of ["http://a.example.test", "//a.example.test", "javascript:alert(1)", "data:text/html,x", "https://a b.test", "https://x", "", "x.jpg", `https://a.test/"`, 5, null]) assert.equal(safeUrl(bad), null, String(bad));
});

test("content survives being stored and read back unchanged, and damaged content still renders", () => {
  const c = content();
  assert.deepEqual(normalizeSiteContent(JSON.parse(JSON.stringify(c))), c, "normalising is stable");
  assert.equal(c.version, 1);
  for (const broken of [null, undefined, 7, "x", [], { hero: 5, about: [], gallery: {}, faq: "?", contact: [] }]) {
    const site = renderSite(normalizeSiteContent(broken), data());
    assert.match(site.body, /<h1>Harbour Smash<\/h1>/);
  }
});

test("the basics of an accessible page are in every template", () => {
  for (const template of TEMPLATES) {
    const doc = renderDocument(renderSite(content(), data(), { template }), { noindex: true });
    assert.match(doc, /<a class="skip" href="#main">Skip to content<\/a>/);
    assert.match(doc, /<main id="main">/);
    assert.match(doc, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(doc, /<meta name="robots" content="noindex">/);
    for (const tag of doc.match(/<img\b[^>]*>/g) ?? []) assert.match(tag, /\balt="/, tag);
    assert.match(doc, /:focus-visible\{outline:3px solid var\(--focus\)/);
    assert.match(doc, /prefers-reduced-motion/);
    // The club's colour is never text in dark mode (it is only guaranteed there as a fill).
    assert.match(doc, /prefers-color-scheme:dark\)\{:root\{--brand-text:var\(--ink\)\}\}/);
    assert.doesNotMatch(doc.replace(/\.btn-primary\{[^}]*\}|\.card\.featured\{[^}]*\}|border[^;}]*var\(--primary\)/g, ""), /[^-]color:var\(--primary\)/, `${template}: primary as a text colour`);
    // Headings don't skip a level.
    const levels = [...doc.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] - levels[i - 1] <= 1, `${template}: h${levels[i - 1]} then h${levels[i]}`);
  }
});
