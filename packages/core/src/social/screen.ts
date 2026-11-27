// The word screen: a first filter on what people write, before a person
// looks. Pure: no I/O. It only ever answers ok / hold / reject; what was
// typed is stored and shown as typed.
import { foldForSearch } from "../text-fold.ts";
import { DEFAULT_WORD_LISTS } from "./word-lists.ts";

/** Words or phrases. Written any way (case, diacritics): they are folded when first used. */
export type WordLists = { reject: readonly string[]; hold: readonly string[] };

/** `reject` refuses the write; `hold` saves it for a moderator to look at. */
export type ScreenResult = "ok" | "hold" | "reject";

/** Characters used in place of letters. For matching only. */
const LOOK_ALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** A word: letters and digits, plus the two symbols that stand in for letters. */
const WORD = /[\p{L}\p{N}@$]+/gu;

const readAsLetters = (word: string, one: string) => word.replace(/[013457@$]/g, (c) => (c === "1" ? one : LOOK_ALIKE[c]!));

/**
 * Every way one typed word may be read. Digits and symbols are read as
 * letters only in a word that has a letter, so a score ("21-17") or a price
 * ("455", "$5") is never read as a word. "1" is tried as "i" and as "l".
 * A "@" or "$" at either end may be a letter ("@ss") or not ("@name", "word$"),
 * so both readings are kept.
 */
function readings(word: string): string[] {
  const out = new Set<string>();
  for (const form of [word, word.replace(/^[@$]+|[@$]+$/g, "")]) {
    if (!form) continue;
    out.add(form);
    if (/\p{L}/u.test(form)) {
      out.add(readAsLetters(form, "i"));
      out.add(readAsLetters(form, "l"));
    }
  }
  return [...out];
}

/** Folded words, in order: no case, no diacritics, compatibility forms (full-width) and zero-width characters gone. */
function words(text: string): string[] {
  const folded = foldForSearch(text.normalize("NFKC").replace(/\p{Cf}/gu, ""));
  return folded.match(WORD) ?? [];
}

type Compiled = { reject: string[][]; hold: string[][] };
const compiled = new WeakMap<WordLists, Compiled>();

/** Each entry as the words to find next to each other. Entries with no word in them are dropped. */
function compile(lists: WordLists): Compiled {
  let done = compiled.get(lists);
  if (!done) {
    const entries = (list: readonly string[]) =>
      list.map((entry) => words(entry).map((w) => (/\p{L}/u.test(w) ? readAsLetters(w, "i") : w))).filter((entry) => entry.length > 0);
    done = { reject: entries(lists.reject), hold: entries(lists.hold) };
    compiled.set(lists, done);
  }
  return done;
}

function hasEntry(text: string[][], entries: string[][]): boolean {
  return entries.some((entry) => {
    for (let at = 0; at + entry.length <= text.length; at++) {
      if (entry.every((word, i) => text[at + i]!.includes(word))) return true;
    }
    return false;
  });
}

/**
 * Screens text against the lists. Whole words only ("scamwordy" is not
 * "scamword"); a phrase matches when its words follow each other, whatever
 * punctuation or line breaks lie between. Case, diacritics and look-alike
 * characters don't matter: "Đồ Ngốc", "do ngoc" and "d0 ng0c" are one phrase.
 * `reject` wins over `hold`.
 */
export function screenText(text: string, lists: WordLists = DEFAULT_WORD_LISTS): ScreenResult {
  const typed = words(text).map(readings);
  if (typed.length === 0) return "ok";
  const { reject, hold } = compile(lists);
  if (hasEntry(typed, reject)) return "reject";
  if (hasEntry(typed, hold)) return "hold";
  return "ok";
}
