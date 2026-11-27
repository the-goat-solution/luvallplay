// Social's rules as pure code (Social plan, Task 1): text limits, the word
// screen, who sees a post, and how soon a report is due. No database here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNITY_RULES_VERSION,
  DEFAULT_WORD_LISTS,
  POST_KINDS,
  POST_STATES,
  REPORT_REASONS,
  SOCIAL_LIMITS,
  SOCIAL_VISIBILITIES,
  TARGET_TYPES,
  canSeePost,
  cleanText,
  dueBy,
  isReportReason,
  screenText,
  severityOf,
  type CanSeePostInput,
} from "@luvallplay/core/social";
import { foldForSearch } from "@luvallplay/core/text-fold";

// ── Limits and cleaning ─────────────────────────────────────────────────────

test("the limits and the rules version are the plan's", () => {
  assert.deepEqual(SOCIAL_LIMITS, { displayName: 40, bio: 160, post: 500, comment: 300, reportDetails: 1000 });
  assert.equal(COMMUNITY_RULES_VERSION, "2026-12");
  assert.deepEqual(POST_STATES, ["visible", "held", "hidden", "removed"]);
  assert.deepEqual(POST_KINDS, ["match", "rank_up", "photo", "text"]);
  assert.deepEqual(SOCIAL_VISIBILITIES, ["club", "everyone"]);
  assert.deepEqual(TARGET_TYPES, ["profile", "post", "comment", "listing", "question"]);
});

test("cleanText trims, collapses spaces, and counts characters not bytes", () => {
  assert.deepEqual(cleanText("  Chào   bạn ", 40), { ok: true, text: "Chào bạn" });
  assert.deepEqual(cleanText("x".repeat(41), 40), { ok: false, code: "too_long" });
  assert.deepEqual(cleanText("x".repeat(40), 40), { ok: true, text: "x".repeat(40) });
  // New lines and tabs are white space too.
  assert.deepEqual(cleanText("one\n\n two\tthree", 40), { ok: true, text: "one two three" });
});

test("cleanText counts a letter once, however it is encoded", () => {
  // 40 Vietnamese letters are 80+ bytes in UTF-8.
  assert.deepEqual(cleanText("ễ".repeat(40), 40), { ok: true, text: "ễ".repeat(40) });
  assert.deepEqual(cleanText("ễ".repeat(41), 40), { ok: false, code: "too_long" });
  // The same letters typed as base letter + marks (NFD) count the same, and are saved composed.
  const decomposed = "ễ".repeat(40).normalize("NFD");
  assert.equal(decomposed.length, 120);
  assert.deepEqual(cleanText(decomposed, 40), { ok: true, text: "ễ".repeat(40) });
  // A character outside the basic plane is two UTF-16 units and one character.
  assert.equal("🏸".length, 2);
  assert.deepEqual(cleanText("🏸".repeat(40), 40), { ok: true, text: "🏸".repeat(40) });
  assert.deepEqual(cleanText("🏸".repeat(41), 40), { ok: false, code: "too_long" });
});

test("cleanText: nothing typed, or not text at all, is 'required'", () => {
  // Blank to the eye: zero-width characters, the Hangul fillers, the blank braille cell, a mark with no letter, control characters.
  const blank = ["\u200b", " \u200b\u200d\ufeff ", "\u3164", "\u2800", "\u115f\u1160", "\uffa0", "\u0301", "\ufe0f", " \u3164 \u200b ", "\u0000", "\u0000 \u0007", "\u202e"];
  for (const raw of ["", "   ", "\n\t ", ...blank, undefined, null, 7, true, {}, ["a"]]) {
    assert.deepEqual(cleanText(raw, 40), { ok: false, code: "required" }, JSON.stringify(raw));
  }
});

test("cleanText drops control characters, so the database never sees a NUL", () => {
  assert.deepEqual(cleanText("a\u0000b", 40), { ok: true, text: "ab" });
  assert.deepEqual(cleanText("a\u0000 \u0000b", 40), { ok: true, text: "a b" });
  assert.deepEqual(cleanText("\u0000a\u0007b\u001b[0m\u007f\u009f", 40), { ok: true, text: "ab[0m" });
  // The ones that are white space become a space, like any other.
  assert.deepEqual(cleanText("a\r\nb\tc\u000bd\u000ce\u0085f", 40), { ok: true, text: "a b c d e f" });
  // Removed characters don't count towards the limit.
  assert.deepEqual(cleanText("x".repeat(40) + "\u0000\u0000", 40), { ok: true, text: "x".repeat(40) });
});

test("cleanText drops direction overrides, and invisible characters at the edges", () => {
  // An override can make text read backwards on screen.
  assert.deepEqual(cleanText("abc\u202edef\u202c", 40), { ok: true, text: "abcdef" });
  assert.deepEqual(cleanText("\u2066abc\u2069 \u202a\u202b\u202d\u2067\u2068x", 40), { ok: true, text: "abc x" });
  // Zero-width characters at either end are not text, and don't count.
  assert.deepEqual(cleanText("\u200b\u200d Sam \u200b\ufeff\u200c", 40), { ok: true, text: "Sam" });
  assert.deepEqual(cleanText("\u200b" + "x".repeat(40) + "\u200b", 40), { ok: true, text: "x".repeat(40) });
  // Inside the text a joiner is kept: some scripts and joined emoji need it.
  assert.deepEqual(cleanText("👨\u200d👩", 40), { ok: true, text: "👨\u200d👩" });
});

test("cleanText counts code points: a joined emoji counts each part", () => {
  // Known and left so: counting what a reader sees as one character needs Intl.Segmenter everywhere this runs.
  assert.deepEqual(cleanText("👨\u200d👩\u200d👧", 5), { ok: true, text: "👨\u200d👩\u200d👧" });
  assert.deepEqual(cleanText("👨\u200d👩\u200d👧", 4), { ok: false, code: "too_long" });
});

// ── The word screen ─────────────────────────────────────────────────────────

test("screening folds diacritics and look-alike digits", () => {
  const lists = { reject: ["scamword"], hold: ["đồ ngốc"] };
  assert.equal(screenText("this is a 5c4mw0rd", lists), "reject");
  assert.equal(screenText("Đồ Ngốc!", lists), "hold");
  assert.equal(screenText("do ngoc", lists), "hold");
  assert.equal(screenText("scamwordy", lists), "ok"); // whole words only
});

test("Vietnamese is screened the same with or without diacritics, in any case or encoding (Review Focus 4)", () => {
  const lists = { reject: ["scamword"], hold: ["đồ ngốc", "lừa đảo"] };
  // text-fold turns đ into d: it has no base letter + mark form, so NFD alone leaves it.
  assert.equal(foldForSearch("Đồ đ"), "do d");
  for (const text of ["đồ ngốc", "Đồ Ngốc", "ĐỒ NGỐC", "do ngoc", "DO NGOC", "Do Ngoc", "đồ ngoc", "do ngốc", "đồ ngốc".normalize("NFD"), "mày là đồ   ngốc à", "may la do ngoc a"]) {
    assert.equal(screenText(text, lists), "hold", text);
  }
  assert.equal(screenText("coi chừng lừa đảo", lists), "hold");
  assert.equal(screenText("coi chung lua dao", lists), "hold");
  // A list typed without diacritics catches text typed with them.
  assert.equal(screenText("Đồ Ngốc", { reject: [], hold: ["DO NGOC"] }), "hold");
  // A word of any language with no diacritics in the list is caught however it is decorated.
  assert.equal(screenText("sçämwörd", lists), "reject");
});

test("Vietnamese: a word typed with its marks must have the entry's marks", () => {
  // Without the marks these are all "do ngoc", "du ma", "con diem", "ca do": the marks are what tell them apart.
  const lists = { reject: ["đụ má"], hold: ["đồ ngốc", "con điếm", "cá độ", "thằng ngu"] };
  const fine = ["anh Đỗ Ngọc Anh thắng", "Thế là đủ mà", "dù mà trời mưa vẫn đi", "đủ má rồi", "còn điểm nào không", "con điểm mười", "ca đó mình bận", "cả đó", "đồ ngọc", "đo ngôc", "đố ngốc", "thằng ngủ", "tháng ngủ"];
  for (const text of fine) assert.equal(screenText(text, lists), "ok", text);
  for (const text of ["đồ ngốc", "con điếm", "cá độ", "CÁ ĐỘ", "thằng ngu", "Thằng Ngu"]) assert.equal(screenText(text, lists), "hold", text);
  // Each word on its own: one typed with marks (they must be the entry's), the next without.
  assert.equal(screenText("đồ ngoc", lists), "hold");
  assert.equal(screenText("đỗ ngoc", lists), "ok");
  // A word the entry writes without marks is not that word once it has some.
  assert.equal(screenText("thang ngu", lists), "hold");
  assert.equal(screenText("thằng ngư", lists), "ok");
});

test("Vietnamese: a reject entry typed without its marks is held, not refused", () => {
  // "du ma" may be the entry, or "dù mà" (even if), "đủ mà" (enough): only a person can tell.
  const lists = { reject: ["đụ má", "scamword"], hold: [] };
  for (const text of ["đụ má", "Đụ Má", "ĐỤ MÁ", "đụ má".normalize("NFD"), "mày đụ má à"]) assert.equal(screenText(text, lists), "reject", text);
  for (const text of ["du ma", "DU MA", "du má", "đụ ma", "du ma troi mua van di", "du m4"]) assert.equal(screenText(text, lists), "hold", text);
  // A reject entry with no marks of its own is refused however it is typed.
  assert.equal(screenText("SCÄMWORD", lists), "reject");
  // The sure match wins when both are in the text.
  assert.equal(screenText("du ma, đụ má", lists), "reject");
});

test("l33t spellings are screened like the plain word (Review Focus 4)", () => {
  const lists = { reject: ["scamword", "atest"], hold: ["đồ ngốc", "silly"] };
  // 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s
  for (const text of ["scamword", "SCAMWORD", "5camword", "sc4mword", "sc@mword", "$camword", "scamw0rd", "$c@mw0rd", "5C4MW0RD"]) {
    assert.equal(screenText(text, lists), "reject", text);
  }
  assert.equal(screenText("4t35t", lists), "reject"); // 4→a 3→e 5→s
  assert.equal(screenText("a7e57", lists), "reject"); // 7→t
  assert.equal(screenText("s1lly", lists), "hold"); // 1→i
  // Both at once: Vietnamese, no diacritics, digits for letters.
  for (const text of ["d0 ngoc", "D0 NG0C", "d0 ng0c", "đồ ng0c"]) {
    assert.equal(screenText(text, lists), "hold", text);
  }
  // 1 is also read as l, the other letter it stands in for.
  assert.equal(screenText("si11y", lists), "hold");
  // And as both in one word: "k111" is "kill".
  const kill = { reject: [], hold: ["kill yourself", "illicit"] };
  assert.equal(screenText("k111 yourself", kill), "hold");
  assert.equal(screenText("k1ll y0ur53lf", kill), "hold");
  assert.equal(screenText("1ll1c1t", kill), "hold");
  // Many 1s don't make the screen slow or wrong.
  assert.equal(screenText("a" + "1".repeat(40), kill), "ok");
});

test("whole words only, with punctuation and symbols beside them", () => {
  const lists = { reject: ["scamword"], hold: ["đồ ngốc"] };
  for (const text of ["scamword.", "(scamword)", "\"scamword\"", "scamword!!!", "a,scamword;b", "scamword\nnext", "…scamword…", "#scamword", "@scamword", "scamword$", "@5c4mw0rd!"]) {
    assert.equal(screenText(text, lists), "reject", text);
  }
  for (const text of ["scamwordy", "ascamword", "scam word", "scamwords", "scam-word", "scamword2"]) {
    assert.equal(screenText(text, lists), "ok", text);
  }
  // A phrase matches across punctuation and line breaks, but its words must be next to each other, in order.
  for (const text of ["đồ, ngốc", "đồ\nngốc", "đồ - ngốc!", "«Đồ Ngốc»"]) {
    assert.equal(screenText(text, lists), "hold", text);
  }
  for (const text of ["ngốc đồ", "đồ rất ngốc", "đồ", "ngốc", "đồng ngốc", "đồ ngốcc"]) {
    assert.equal(screenText(text, lists), "ok", text);
  }
});

test("ordinary numbers are never read as letters", () => {
  // Read as letters, 17 is "it", 455 is "ass", 10 is "io" and 5 is "s".
  const lists = { reject: ["it", "ass", "io", "s", "to", "ii"], hold: ["it it", "si"] };
  for (const text of ["21-17", "won 21-17, 21-19", "21–17 21–19", "paid 455", "10 of 10", "5", "court 7 at 17:10", "11", "51", "$5", "5$", "$455"]) {
    assert.equal(screenText(text, lists), "ok", text);
  }
  // With a letter in the word, the digits are read as letters.
  assert.equal(screenText("a55", lists), "reject");
  assert.equal(screenText("1t", lists), "reject");
});

test("reject beats hold; nothing listed is ok", () => {
  const lists = { reject: ["scamword"], hold: ["silly"] };
  assert.equal(screenText("silly scamword", lists), "reject");
  assert.equal(screenText("scamword silly", lists), "reject");
  assert.equal(screenText("a good game tonight", lists), "ok");
  assert.equal(screenText("", lists), "ok");
  assert.equal(screenText("silly", { reject: [], hold: [] }), "ok");
  // An empty or blank entry matches nothing (it would otherwise match everything).
  assert.equal(screenText("a good game", { reject: ["", "  ", "!!"], hold: [""] }), "ok");
  // An entry with a symbol the screen can't read ("c++") is skipped whole: it must not become "c".
  const symbols = { reject: ["c++", "a/b", "x.y"], hold: ["c#", "*"] };
  for (const text of ["c", "I got a C in maths", "a b", "x y", "c++", "a", "x"]) assert.equal(screenText(text, symbols), "ok", text);
  // A hyphen or an apostrophe in an entry is a word break, as it is in the text.
  assert.equal(screenText("pay up front", { reject: [], hold: ["pay-up-front"] }), "hold");
  assert.equal(screenText("pay-up-front", { reject: [], hold: ["pay up front"] }), "hold");
});

test("tricks that hide a word from the eye don't hide it from the screen", () => {
  const lists = { reject: ["scamword"], hold: [] };
  assert.equal(screenText("sc\u200bam\u200dword", lists), "reject"); // zero-width characters
  assert.equal(screenText("ｓｃａｍｗｏｒｄ", lists), "reject"); // full-width letters
  assert.equal(screenText("scam\ufe0fword", lists), "reject"); // a variation selector
  assert.equal(screenText("sca\u0489mword", lists), "reject"); // an enclosing mark
  assert.equal(screenText("s\u0336c\u0336a\u0336m\u0336w\u0336o\u0336r\u0336d\u0336", lists), "reject"); // struck through
  assert.equal(screenText("\u202escamword\u202c", lists), "reject"); // a direction override
  // The same tricks on a Vietnamese entry.
  assert.equal(screenText("đồ\u200b ng\ufe0fốc", { reject: [], hold: ["đồ ngốc"] }), "hold");
});

test("the default lists: English and Vietnamese, usable as they are", () => {
  assert.ok(DEFAULT_WORD_LISTS.reject.length > 0 && DEFAULT_WORD_LISTS.hold.length > 0);
  const all = [...DEFAULT_WORD_LISTS.reject, ...DEFAULT_WORD_LISTS.hold];
  assert.ok(all.length <= 80, "the lists stay short enough to read in one sitting");
  assert.equal(new Set(all.map((w) => foldForSearch(w))).size, all.length, "no entry twice (after folding)");
  assert.ok(all.some((w) => foldForSearch(w) !== w.toLowerCase()), "has Vietnamese entries, written with their diacritics");
  for (const entry of all) assert.equal(entry, entry.trim().toLowerCase().normalize("NFC"), `"${entry}" is lower case, trimmed, composed`);
  // Every entry is caught as written, without diacritics, and in capitals.
  for (const entry of DEFAULT_WORD_LISTS.reject) {
    for (const text of [entry, entry.toUpperCase()]) assert.equal(screenText(`x ${text} y`), "reject", text);
    // Vietnamese typed without its marks can't be told from other words: held for a person.
    const plain = foldForSearch(entry);
    assert.equal(screenText(`x ${plain} y`), plain === entry ? "reject" : "hold", plain);
  }
  // Every entry is plain words: none is skipped for a symbol in it.
  for (const entry of all) assert.match(entry, /^[\p{L}\p{N} ]+$/u, entry);
  // Plurals are listed: an entry never matches inside a longer word.
  for (const text of ["niggers", "faggots", "N1GG3R5", "f4gg0t"]) assert.equal(screenText(text), "reject", text);
  for (const text of ["nigg\ufe0fer", "nig\u0489ger", "nïggér"]) assert.equal(screenText(text), "reject", text);
  // Said to hurt or said to comfort: a person decides.
  assert.equal(screenText("don't kill yourself over one loss"), "hold");
  assert.equal(screenText("k111 yourself"), "hold");
  for (const entry of DEFAULT_WORD_LISTS.hold) {
    for (const text of [entry, foldForSearch(entry), entry.toUpperCase()]) assert.equal(screenText(`x ${text} y`), "hold", text);
  }
  // No list is passed: the defaults are used.
  assert.equal(screenText("việc nhẹ lương cao"), "hold");
  assert.equal(screenText("viec nhe luong cao"), "hold");
  assert.equal(screenText("v13c nh3 lu0ng c40"), "hold");
});

test("the default lists leave ordinary club talk alone", () => {
  const fine = [
    "Sam beat Alex 21-17, 21-19",
    "Good game tonight, see you Thursday at court 3",
    "Thắng 21-17, 21-19. Trận hay quá!",
    "Hôm nay đi đánh cầu lông ở sân lớn với các bạn",
    "Cả nhà đi du lịch, tuần sau gặp lại",
    "Ai có vợt cũ cho mình mượn với",
    "Moved up to Silver II",
    "What a smash! Class shot.",
    // Everyday Vietnamese that is one mark away from an entry.
    "Thế là đủ mà",
    "dù mà trời mưa vẫn đi",
    "Dù mẹ không cho đi",
    "đủ mẹ rồi",
    "anh Đỗ Ngọc Anh thắng",
    "anh Do Ngoc Anh thang",
    "còn điểm nào không",
    "ca đó mình bận",
    "mua ốc cho cả nhà",
    "hạt óc chó",
    "chờ vậy",
    "cho vậy đi",
    "cho vay di",
    "Tháng này ngủ ít quá",
    "Đội mình thắng, ngủ ngon nhé",
  ];
  for (const text of fine) assert.equal(screenText(text), "ok", text);
});

// ── Who sees a post ─────────────────────────────────────────────────────────

/** A viewer who should see the post: same club, a follower, nothing in the way. */
const SEEN: CanSeePostInput = {
  viewerId: 1,
  authorId: 2,
  authorSuspended: false,
  authorDeleted: false,
  authorVisibility: "everyone",
  postState: "visible",
  blockedEitherWay: false,
  follows: true,
  sharesPostClub: true,
  bannedInPostClub: false,
};
const see = (over: Partial<CanSeePostInput> = {}) => canSeePost({ ...SEEN, ...over });

test("visibility: block beats follow; held posts only for the author; suspended authors vanish", () => {
  assert.equal(see(), true);

  // A block beats a follow and a shared club.
  assert.equal(see({ blockedEitherWay: true }), false);
  assert.equal(see({ blockedEitherWay: true, follows: true, sharesPostClub: true }), false);

  // Only "visible" posts are seen by anyone but the author.
  assert.equal(see({ postState: "held" }), false);
  assert.equal(see({ postState: "hidden" }), false);
  assert.equal(see({ postState: "removed" }), false);

  // A suspended author's posts vanish.
  assert.equal(see({ authorSuspended: true }), false);

  // So do the posts of an account that's been deleted.
  assert.equal(see({ authorDeleted: true }), false);
});

test("visibility: the author sees their own held and hidden posts, never a removed one", () => {
  const mine = { viewerId: 2, follows: false, sharesPostClub: false };
  assert.equal(see({ ...mine }), true);
  assert.equal(see({ ...mine, postState: "held" }), true);
  assert.equal(see({ ...mine, postState: "hidden" }), true);
  assert.equal(see({ ...mine, postState: "removed" }), false);
  // Their own post, whatever else is true of them: a "club" setting, a ban, a suspension.
  assert.equal(see({ ...mine, authorVisibility: "club" }), true);
  assert.equal(see({ ...mine, bannedInPostClub: true }), true);
  assert.equal(see({ ...mine, authorSuspended: true, postState: "held" }), true);
  // A deleted account sees nothing, its own posts included.
  assert.equal(see({ ...mine, authorDeleted: true }), false);
});

test("visibility: an 'everyone' author is seen by followers and by the post's club", () => {
  assert.equal(see({ authorVisibility: "everyone", follows: true, sharesPostClub: false }), true);
  assert.equal(see({ authorVisibility: "everyone", follows: false, sharesPostClub: true }), true);
  assert.equal(see({ authorVisibility: "everyone", follows: false, sharesPostClub: false }), false);
});

test("visibility: a 'club' author is seen only by the post's club; following is not enough", () => {
  assert.equal(see({ authorVisibility: "club", follows: true, sharesPostClub: false }), false);
  assert.equal(see({ authorVisibility: "club", follows: false, sharesPostClub: true }), true);
  assert.equal(see({ authorVisibility: "club", follows: true, sharesPostClub: true }), true);
  assert.equal(see({ authorVisibility: "club", follows: false, sharesPostClub: false }), false);
  // Anything that isn't "everyone" is read as "club" (the narrower one).
  assert.equal(see({ authorVisibility: "public" as never, follows: true, sharesPostClub: false }), false);
});

test("visibility: someone banned in the post's club sees none of that club's posts, follower or not", () => {
  assert.equal(see({ bannedInPostClub: true, follows: false, sharesPostClub: true }), false);
  assert.equal(see({ bannedInPostClub: true, follows: true, sharesPostClub: true }), false);
  assert.equal(see({ bannedInPostClub: true, follows: true, sharesPostClub: false }), false);
  assert.equal(see({ bannedInPostClub: true, authorVisibility: "club" }), false);
});

test("visibility: every combination agrees with the rules written out", () => {
  const bools = [false, true];
  let seen = 0;
  for (const postState of POST_STATES) for (const authorVisibility of SOCIAL_VISIBILITIES) for (const own of bools)
    for (const authorSuspended of bools) for (const authorDeleted of bools) for (const blockedEitherWay of bools)
      for (const follows of bools) for (const sharesPostClub of bools) for (const bannedInPostClub of bools) {
        const input: CanSeePostInput = { viewerId: own ? 2 : 1, authorId: 2, authorSuspended, authorDeleted, authorVisibility, postState, blockedEitherWay, follows, sharesPostClub, bannedInPostClub };
        const expected = authorDeleted || postState === "removed" ? false
          : own ? true
          : postState === "visible" && !blockedEitherWay && !authorSuspended && !bannedInPostClub
            && (sharesPostClub || (authorVisibility === "everyone" && follows));
        assert.equal(canSeePost(input), expected, JSON.stringify(input));
        if (expected) seen++;
      }
  assert.ok(seen > 0);
});

// ── Reports ─────────────────────────────────────────────────────────────────

test("the ten report reasons, in the plan's order", () => {
  assert.deepEqual(REPORT_REASONS, ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "child_safety", "scam", "prohibited_item", "other"]);
  for (const reason of REPORT_REASONS) assert.equal(isReportReason(reason), true);
  for (const not of ["", "Spam", "abuse", "constructor", "toString", undefined, null, 3, {}]) assert.equal(isReportReason(not), false, String(not));
});

test("serious reasons are due in 12 hours, others in 24", () => {
  assert.equal(severityOf("child_safety"), "serious");
  assert.equal(dueBy(new Date("2026-12-01T00:00Z"), "serious").toISOString(), "2026-12-01T12:00:00.000Z");
  assert.equal(dueBy(new Date("2026-12-01T00:00Z"), "normal").toISOString(), "2026-12-02T00:00:00.000Z");
  for (const reason of ["child_safety", "sexual", "self_harm", "violence", "hate"] as const) assert.equal(severityOf(reason), "serious", reason);
  for (const reason of ["spam", "harassment", "scam", "prohibited_item", "other"] as const) assert.equal(severityOf(reason), "normal", reason);
  // The date passed in is not changed.
  const created = new Date("2026-12-31T20:30:00Z");
  assert.equal(dueBy(created, "serious").toISOString(), "2027-01-01T08:30:00.000Z");
  assert.equal(created.toISOString(), "2026-12-31T20:30:00.000Z");
});
