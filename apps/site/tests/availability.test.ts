// Availability stays true: one list (content/availability.ts) drives every
// badge and status sentence, and prose can't keep saying "coming soon" about
// something the list says is live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { availability } from "../content/availability.ts";
import { availabilityOf, notYetLive } from "../lib/site.ts";
import { assemble } from "../lib/content.ts";
import type { Availability, Doc, HelpArticle, HomePage } from "../lib/types.ts";

const docs = JSON.parse(readFileSync(new URL("../content/generated/seed.json", import.meta.url), "utf8")) as Doc[];
const keys = new Set(availability.items.map((i) => i.key));

test("every line has a status, a name and a note in both languages", () => {
  assert.equal(keys.size, availability.items.length, "keys are unique");
  for (const i of availability.items) {
    assert.ok(["live", "limited", "soon"].includes(i.status), i.key);
    assert.ok(["players", "clubs", "platform"].includes(i.group), i.key);
    for (const lang of ["en", "vi"] as const) assert.ok(i.name[lang].trim() && i.note[lang].trim(), `${i.key}.${lang}`);
  }
  assert.match(availability.updated, /^\d{4}-\d{2}-\d{2}$/);
});

test("everything that points at the list uses a key that exists", () => {
  const home = docs.find((d): d is HomePage => d._type === "homePage")!;
  for (const f of home.features.items) assert.ok(keys.has(f.key), `home feature "${f.key}" has no availability line`);
  for (const h of docs.filter((d): d is HelpArticle => d._type === "helpArticle")) {
    for (const k of h.features ?? []) assert.ok(keys.has(k), `help article ${h.slug} names unknown feature "${k}"`);
  }
  for (const k of ["vision", "storeApps"]) assert.ok(keys.has(k), `the site reads "${k}" directly`);
});

test("a feature without a line counts as not yet available", () => {
  const content = { availability };
  assert.equal(notYetLive(content, "no-such-feature"), true);
  assert.equal(notYetLive(content, "languages"), false);
  assert.equal(availabilityOf(content, "vision")?.status, "limited");
});

test("Sanity's lines win, and a line added in code since the last seed still shows", () => {
  const live: Availability = { ...availability, items: [{ ...availability.items.find((i) => i.key === "storeApps")!, status: "live" }] };
  const merged = assemble(docs, [live as Doc]).availability;
  assert.equal(merged.items.find((i) => i.key === "storeApps")?.status, "live");
  assert.equal(merged.items.length, availability.items.length, "lines Sanity lacks come from the repo");
});

// When a line goes live, these phrases about it must be gone from every page,
// article and FAQ answer. Add a pattern here when you write a new "not yet".
const STALE_WHEN_LIVE: Record<string, RegExp[]> = {
  storeApps: [/store apps? (are|is) coming soon/i, /Ứng dụng trên (các )?kho sắp ra mắt/i],
  social: [/Social[^.]{0,40}coming soon/i, /(kudos|follows)[^.]{0,40}coming soon/i],
  marketplace: [/marketplace[^.]{0,60}coming soon/i],
  newClubs: [/isn[’']t open (to|for) new clubs/i, /chưa mở cho câu lạc bộ mới/i, /Join the waitlist and we[’']ll invite/i],
  otherSports: [/(pickleball|tennis|futsal)[^.]{0,80}(are|is) coming soon/i],
  vision: [/only (open to|for) members of the first club/i],
  juniors: [/junior[^.]{0,60}(planned|coming soon)/i],
};

test("no page still says “coming soon” about something that is live", () => {
  for (const k of Object.keys(STALE_WHEN_LIVE)) assert.ok(keys.has(k), `STALE_WHEN_LIVE names unknown feature "${k}"`);
  const prose = JSON.stringify(docs.filter((d) => d._type !== "availability"));
  const problems: string[] = [];
  for (const item of availability.items) {
    if (item.status !== "live") continue;
    for (const re of STALE_WHEN_LIVE[item.key] ?? []) {
      const m = re.exec(prose);
      if (m) problems.push(`"${item.key}" is live, but the content still says: “${m[0]}”`);
    }
  }
  assert.deepEqual(problems, []);
});
