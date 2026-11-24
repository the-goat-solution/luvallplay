// Gate R: every page is complete in English and Vietnamese. This walks the
// interface strings and every seeded document and fails on a missing or empty
// translation, a Vietnamese string left in English, a missing alt text or a
// missing SEO field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { messages } from "../lib/messages.ts";
import { blocksToText } from "../lib/markdown.ts";
import { STATIC_PATHS } from "../lib/site.ts";
import type { Doc, HelpArticle, LegalPage, PtBlock } from "../lib/types.ts";

const docs = JSON.parse(readFileSync(new URL("../content/generated/seed.json", import.meta.url), "utf8")) as Doc[];

// Words that are the same in both languages on purpose (names, numbers).
const SAME_OK = /^(Luvallplay( Vision)?|Vision|Arena|Email|Menu|Pickleball|Futsal|Three Wolves( Badminton Club)?( · Christchurch)?|Love all, play\.|\d+|–)$/;

function walk(node: unknown, path: string, problems: string[]) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, problems));
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if ("en" in o || "vi" in o) {
    for (const lang of ["en", "vi"] as const) {
      const v = o[lang];
      const empty = Array.isArray(v) ? v.length === 0 : typeof v !== "string" || !v.trim();
      if (empty) problems.push(`${path}.${lang} is missing`);
    }
    if (typeof o.en === "string" && o.en === o.vi && !SAME_OK.test(o.en)) problems.push(`${path}: Vietnamese is identical to English ("${o.en}")`);
    if (Array.isArray(o.en) && Array.isArray(o.vi)) {
      const shape = (b: PtBlock[]) => b.map((x) => `${x.style}${x.listItem ?? ""}`).join(",");
      if (shape(o.en as PtBlock[]) !== shape(o.vi as PtBlock[])) problems.push(`${path}: the two languages have different structure`);
    }
    return;
  }
  for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, problems);
}

test("interface strings exist in both languages", () => {
  const problems: string[] = [];
  const cmp = (a: unknown, b: unknown, path: string) => {
    if (typeof a === "function") return assert.equal(typeof b, "function", `${path} must be a function in vi`);
    if (Array.isArray(a)) return a.forEach((x, i) => cmp(x, (b as unknown[])?.[i], `${path}[${i}]`));
    if (a && typeof a === "object") {
      for (const k of Object.keys(a)) cmp((a as Record<string, unknown>)[k], (b as Record<string, unknown>)?.[k], `${path}.${k}`);
      for (const k of Object.keys((b as object) ?? {})) if (!(k in (a as object))) problems.push(`${path}.${k} exists only in vi`);
      return;
    }
    if (typeof b !== "string" || !b.trim()) problems.push(`${path} is missing in vi`);
    else if (a === b && !SAME_OK.test(String(a)) && path !== "messages.switchTo") problems.push(`${path}: vi is identical to en ("${a}")`);
  };
  cmp(messages.en, messages.vi, "messages");
  assert.deepEqual(problems, []);
});

test("every seeded document is complete in both languages", () => {
  const problems: string[] = [];
  for (const d of docs) walk(d, d._id, problems);
  assert.deepEqual(problems, []);
});

test("every page has SEO text in both languages, within length", () => {
  const problems: string[] = [];
  const pages = docs.filter((d) => d._type === "page" || d._type === "homePage") as { _id: string; seoTitle?: { en: string; vi: string }; seoDescription?: { en: string; vi: string } }[];
  for (const p of pages) {
    for (const lang of ["en", "vi"] as const) {
      const title = p.seoTitle?.[lang] ?? "";
      const desc = p.seoDescription?.[lang] ?? "";
      if (!title) problems.push(`${p._id}: no title (${lang})`);
      if (title.length > 70) problems.push(`${p._id}: title over 70 characters (${lang}: ${title.length})`);
      if (desc.length < 40 || desc.length > 200) problems.push(`${p._id}: description should be 40 to 200 characters (${lang}: ${desc.length})`);
    }
  }
  for (const path of STATIC_PATHS) {
    const key = path.slice(1);
    if (!key || key === "privacy" || key === "terms") continue;
    if (!pages.some((p) => p._id === `page.${key}`)) problems.push(`no page document for ${path}`);
  }
  assert.deepEqual(problems, []);
});

test("image slots carry alt text in both languages", () => {
  const home = docs.find((d) => d._type === "homePage") as unknown as { hero: { photos: { fallbackAlt: { en: string; vi: string } }[] } };
  assert.equal(home.hero.photos.length, 4);
  for (const p of home.hero.photos) assert.ok(p.fallbackAlt.en && p.fallbackAlt.vi);
});

test("help centre has 12 to 15 articles, and legal pages are dated", () => {
  const help = docs.filter((d): d is HelpArticle => d._type === "helpArticle");
  assert.ok(help.length >= 12 && help.length <= 15, `help articles: ${help.length}`);
  for (const h of help) assert.ok(blocksToText(h.body.vi).length > 800, `${h.slug} (vi) is too short`);
  const legal = docs.filter((d): d is LegalPage => d._type === "legalPage");
  assert.deepEqual(legal.map((l) => l.slug).sort(), ["privacy", "terms"]);
  for (const l of legal) assert.match(l.updated, /^\d{4}-\d{2}-\d{2}$/);
});

test("content rules: no prices, no invented placeholders, tagline exact", () => {
  const text = JSON.stringify(docs);
  assert.doesNotMatch(text, /\[(#|Name|Club name|YOUR PRICE)[^\]]*\]/i, "design placeholders must not ship");
  assert.doesNotMatch(text, /(NZ)?\$\s?\d|\d+\s?(₫|VND|NZD)/, "no price numbers anywhere");
  assert.doesNotMatch(text, /Love all play|Love all, play(?!\.)/, "the tagline is exactly “Love all, play.”");
  const allowed = new Set(["company", "address", "contactEmail"]);
  for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(allowed.has(m[1]), `unknown placeholder {{${m[1]}}}`);
});
