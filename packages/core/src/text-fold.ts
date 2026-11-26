// Accent folding (build plan §6.9: "search ignores accents: typing 'nguyen'
// finds 'Nguyễn'"). Pure: no I/O.
//
// Vietnamese writes tone and vowel marks as diacritics, and people type names
// with and without them. Folding removes the marks so the two spellings
// compare equal. It is for comparing and searching only: what a person typed
// is always stored and shown as they typed it.

/** Latin letters that don't decompose into a base letter plus a mark. */
const NO_DECOMPOSITION: Record<string, string> = { đ: "d", Đ: "D", ł: "l", Ł: "L", ø: "o", Ø: "O", ß: "ss", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE" };

/**
 * Removes diacritics, keeping case: "Nguyễn Thị Hương" → "Nguyen Thi Huong",
 * "Đặng" → "Dang". Works on composed (NFC) and decomposed (NFD) text alike.
 */
export function stripDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐłŁøØßæÆœŒ]/g, (c) => NO_DECOMPOSITION[c] ?? c);
}

/**
 * The key two texts are compared by in a search: no diacritics, lower case,
 * runs of white space collapsed, trimmed. "  NGUYỄN  văn A " → "nguyen van a".
 */
export function foldForSearch(text: string): string {
  return stripDiacritics(text).toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when every word typed appears (accent-free, any case) in the text, in any order. */
export function foldedIncludes(text: string, typed: string): boolean {
  const haystack = foldForSearch(text);
  const words = foldForSearch(typed).split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

// ── The same folding inside Postgres ────────────────────────────────────────
//
// For searches the database runs. Built from the same rule as stripDiacritics
// so the two can't disagree (tests/country-pack.test.ts compares them on a
// real Postgres). It needs no extension: normalize() and translate() are
// built in (Postgres 13+), which matters in a region whose managed Postgres
// may not offer "unaccent".

const FOLDABLE = (() => {
  let from = "";
  let to = "";
  // Latin-1 Supplement, Latin Extended-A/B and Latin Extended Additional (where Vietnamese lives).
  // Capitals are listed too, so the result doesn't depend on the database's locale knowing them.
  const ranges: [number, number][] = [[0x00c0, 0x024f], [0x1e00, 0x1eff]];
  for (const [lo, hi] of ranges) {
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      const plain = stripDiacritics(ch).toLowerCase();
      // Letters that fold to two (ß → ss) are left alone in SQL: translate() swaps one for one.
      if (plain !== ch && /^[a-z]$/.test(plain)) {
        from += ch;
        to += plain;
      }
    }
  }
  return { from, to };
})();

/** The accented letters the SQL folding replaces, and what each becomes (same position). */
export const SQL_FOLD = FOLDABLE;

/**
 * A Postgres expression that folds `expression` (a column or a parameter
 * placeholder, never user text) the way foldForSearch does for names:
 * `sqlFold("p.display_name") LIKE '%' || sqlFold("$1") || '%'`.
 */
export function sqlFold(expression: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_.$]*$/.test(expression)) throw new Error("sqlFold takes a column name or a placeholder");
  // Marks that didn't join a letter (a stray combining accent) are dropped, as stripDiacritics drops them.
  const letters = `regexp_replace(translate(normalize(${expression}, NFC), '${FOLDABLE.from}', '${FOLDABLE.to}'), '[\\u0300-\\u036f]', '', 'g')`;
  return `btrim(regexp_replace(lower(${letters}), '\\s+', ' ', 'g'))`;
}
