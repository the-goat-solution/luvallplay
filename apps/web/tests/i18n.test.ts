// Phase 2 merged the four dictionaries (lib/i18n.ts, profile-i18n.ts,
// arena-i18n.ts, jersey-i18n.ts) into @luvallplay/i18n. The fixture was
// rendered from the OLD files before the merge (every key, both languages,
// the same vars), so this proves no string changed, went missing or appeared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANGS, NAMESPACES, messages, translate, type MessageKey, type Namespace } from "@luvallplay/i18n";
import { t } from "../lib/i18n.ts";

type Fixture = Record<Namespace, Record<"en" | "vi", Record<string, string>>>;
const before: Fixture = JSON.parse(readFileSync(new URL("./fixtures/i18n/strings-before-merge.json", import.meta.url), "utf8"));
const VARS = { n: 7, name: "Mia", date: "Fri 27 Nov", days: 3, count: 2, amount: "$33", place: "1st", rank: "Silver", x: "X", total: 9, price: "$10" };

test("the namespaces are the four old dictionaries, in en and vi only", () => {
  assert.deepEqual([...NAMESPACES].sort(), ["arena", "jersey", "profile", "site"]);
  assert.deepEqual([...LANGS], ["en", "vi"]);
  assert.deepEqual(Object.keys(before).sort(), [...NAMESPACES].sort());
});

for (const ns of NAMESPACES) {
  test(`${ns}: the same keys as before the merge`, () => {
    const dict = messages[ns] as unknown as Record<string, Record<string, string>>;
    assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(before[ns].en).sort());
    assert.deepEqual(Object.keys(dict.vi).sort(), Object.keys(before[ns].en).sort(), "vi has exactly the en keys");
  });

  test(`${ns}: every string renders exactly as before, in both languages`, () => {
    for (const lang of LANGS) {
      for (const [key, expected] of Object.entries(before[ns][lang])) {
        assert.equal(translate(ns, lang, key as MessageKey<typeof ns>, VARS), expected, `${ns}.${lang}.${key}`);
      }
    }
  });

  test(`${ns}: Vietnamese uses the same {placeholders} as English and none is empty`, () => {
    const dict = messages[ns] as unknown as Record<string, Record<string, string>>;
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const key of Object.keys(dict.en)) {
      assert.ok(dict.vi[key].trim(), `${ns}.vi.${key} is empty`);
      assert.equal(ph(dict.vi[key]), ph(dict.en[key]), `${ns}.${key} placeholders`);
    }
  });
}

test("the app's t() still renders the site namespace", () => {
  for (const lang of LANGS) {
    for (const [key, expected] of Object.entries(before.site[lang])) {
      assert.equal(t(lang, key as MessageKey<"site">, VARS), expected);
    }
  }
});

test("translate falls back to English, then to the key", () => {
  const vi = messages.site.vi as Record<string, string>;
  const saved = vi.nav_about;
  try {
    delete vi.nav_about;
    assert.equal(translate("site", "vi", "nav_about"), "About");
  } finally {
    vi.nav_about = saved;
  }
  assert.equal(translate("site", "en", "no_such_key" as MessageKey<"site">), "no_such_key");
});
