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
