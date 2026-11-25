// Clubs without a domain live at app.luvallplay.com/{club}; a club with a
// domain redirects there (build plan §6.4). Pure: no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalClubUrl, clubFromPath, isValidClubSlug, hostsForTenant } from "@luvallplay/core/host-routing";

test("a club slug is short, lower case, hyphenated, and not reserved", () => {
  for (const ok of ["three-wolves", "hanoi-smash", "ab", "club2"]) assert.equal(isValidClubSlug(ok), true, ok);
  for (const bad of ["", "a", "Three-Wolves", "-x", "x-", "a--b", "a_b", "a/b", "x".repeat(41), "admin", "api", "app", "login", "en", "vi", "clubs", null, 5]) assert.equal(isValidClubSlug(bad), false, String(bad));
});

test("the first path segment names the club", () => {
  assert.deepEqual(clubFromPath("/three-wolves"), { slug: "three-wolves", rest: "/" });
  assert.deepEqual(clubFromPath("/three-wolves/"), { slug: "three-wolves", rest: "/" });
  assert.deepEqual(clubFromPath("/three-wolves/arena/leaderboard"), { slug: "three-wolves", rest: "/arena/leaderboard" });
});

test("platform and framework paths are never a club", () => {
  for (const p of ["/", "", "/admin/x", "/api/mcp", "/_next/static/a.js", "/favicon.ico", "/login", "/en/help", "relative", "//evil.com"]) assert.equal(clubFromPath(p), null, p);
});

test("a club with its own domain redirects its platform path there; others serve in place", () => {
  assert.equal(canonicalClubUrl({ customDomain: "WWW.ThreeWolvesBadminton.org" }, "/arena", "?x=1"), "https://threewolvesbadminton.org/arena?x=1");
  assert.equal(canonicalClubUrl({ customDomain: "threewolvesbadminton.org" }, "/"), "https://threewolvesbadminton.org/");
  assert.equal(canonicalClubUrl({ customDomain: null }, "/arena"), null);
  assert.equal(canonicalClubUrl({}, "/arena"), null);
  assert.equal(canonicalClubUrl({ customDomain: "evil.com/path" }, "/arena"), null);
});

test("existing subdomain hosts are unchanged", () => {
  assert.deepEqual(hostsForTenant({ slug: "three-wolves", customDomain: "threewolvesbadminton.org" }, "luvallplay.com"), ["three-wolves.luvallplay.com", "threewolvesbadminton.org"]);
});
