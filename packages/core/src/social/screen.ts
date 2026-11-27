// The word screen: a first filter on what people write, before a person
// looks. Pure: no I/O. It only ever answers ok / hold / reject; what was
// typed is stored and shown as typed.
import { stripDiacritics } from "../text-fold.ts";
import { DEFAULT_WORD_LISTS } from "./word-lists.ts";

/** Words or phrases, written any way (case, with or without diacritics). See word-lists.ts for how to write them. */
export type WordLists = { reject: readonly string[]; hold: readonly string[] };

/** `reject` refuses the write; `hold` saves it for a moderator to look at. */
export type ScreenResult = "ok" | "hold" | "reject";

/** Characters used in place of letters. For matching only. */
const LOOK_ALIKE: Record<string, string> = { "0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** A word: letters and digits, plus the two symbols that stand in for letters. */
const WORD = /[\p{L}\p{N}@$]+/gu;
/** What an entry may hold besides words: spaces, and the hyphen and apostrophe that break words. */
const ENTRY = /^[\p{L}\p{N}@$\s'’-]+$/u;

/** Past this many 1s in one word, only "all i" and "all l" are tried. */
const MAX_ONES = 6;

/**
 * A word with its digits and symbols read as letters. "1" stands for "i" or
 * for "l", so every mix is given ("k111" → "kiii", "kill", …).
 */
function asLetters(word: string): string[] {
  const mapped = word.replace(/[03457@$]/g, (c) => LOOK_ALIKE[c]!);
  const ones = mapped.split("1").length - 1;
  if (ones === 0) return [mapped];
  if (ones > MAX_ONES) return [mapped.replaceAll("1", "i"), mapped.replaceAll("1", "l")];
  const out: string[] = [];
  for (let mix = 0; mix < 1 << ones; mix++) {
    let n = 0;
    out.push(mapped.replace(/1/g, () => ((mix >> n++) & 1 ? "l" : "i")));
  }
  return out;
}

/**
 * Every way one typed word may be read. Digits and symbols are read as
 * letters only in a word that has a letter, so a score ("21-17") or a price
 * ("455", "$5") is never read as a word. A "@" or "$" at either end may be a
 * letter ("@ss") or not ("@name", "word$"), so both readings are kept.
 */
function readings(word: string): Set<string> {
  const out = new Set<string>();
  for (const form of [word, word.replace(/^[@$]+|[@$]+$/g, "")]) {
    if (!form) continue;
    out.add(form);
    if (/\p{L}/u.test(form)) for (const reading of asLetters(form)) out.add(reading);
  }
  return out;
}

/**
 * The words of a text, lower case and composed, diacritics kept. Zero-width
 * characters, direction marks, compatibility forms (full-width letters) and
 * any mark that didn't join a letter (a variation selector, a strike-through)
 * are gone, so they can't split or disguise a word.
 */
function words(text: string): string[] {
  const clean = text.replace(/\p{Cf}/gu, "").normalize("NFKC").toLowerCase().normalize("NFC").replace(/\p{M}/gu, "");
  return clean.match(WORD) ?? [];
}

/** One typed word: how it reads with its diacritics, and without. */
type Typed = { marked: boolean; exact: Set<string>; plain: Set<string> };

function typed(word: string): Typed {
  const plain = stripDiacritics(word);
  return { marked: plain !== word, exact: readings(word), plain: readings(plain) };
}

/** One word of an entry. */
type EntryWord = { marked: boolean; exact: string; plain: string };
/** `marked`: some word of the entry is written with diacritics (a Vietnamese entry). */
type Entry = { marked: boolean; words: EntryWord[] };
type Compiled = { reject: Entry[]; hold: Entry[] };
const compiled = new WeakMap<WordLists, Compiled>();

const entryReading = (word: string) => (/\p{L}/u.test(word) ? asLetters(word)[0]! : word);

/**
 * Each entry as the words to find next to each other. An entry with no word
 * in it, or with a symbol the screen can't read ("c++" would become "c"),
 * is skipped.
 */
function compile(lists: WordLists): Compiled {
  let done = compiled.get(lists);
  if (!done) {
    const entries = (list: readonly string[]) =>
      list.flatMap((raw): Entry[] => {
        if (!ENTRY.test(raw.replace(/\p{Cf}/gu, "").normalize("NFKC"))) return [];
        const entry = words(raw).map((word): EntryWord => {
          const plain = stripDiacritics(word);
          return { marked: plain !== word, exact: entryReading(word), plain: entryReading(plain) };
        });
        return entry.length > 0 ? [{ marked: entry.some((w) => w.marked), words: entry }] : [];
      });
    done = { reject: entries(lists.reject), hold: entries(lists.hold) };
    compiled.set(lists, done);
  }
  return done;
}

/** `sure`: the entry as written. `folded`: only once the typed text's missing diacritics are assumed. */
type Found = "none" | "folded" | "sure";

function matchAt(text: Typed[], at: number, entry: Entry): Found {
  let found: Found = "sure";
  for (let i = 0; i < entry.words.length; i++) {
    const word = text[at + i]!;
    const want = entry.words[i]!;
    if (entry.marked && word.marked) {
      // Typed with diacritics: they must be the entry's own.
      if (!word.exact.has(want.exact)) return "none";
    } else {
      if (!word.plain.has(want.plain)) return "none";
      if (want.marked) found = "folded";
    }
  }
  return found;
}

function find(text: Typed[], entries: Entry[]): Found {
  let best: Found = "none";
  for (const entry of entries) {
    for (let at = 0; at + entry.words.length <= text.length; at++) {
      const found = matchAt(text, at, entry);
      if (found === "sure") return "sure";
      if (found === "folded") best = "folded";
    }
  }
  return best;
}

/**
 * Screens text against the lists. Whole words only ("scamwordy" is not
 * "scamword"); a phrase matches when its words follow each other, whatever
 * punctuation or line breaks lie between. Case and look-alike characters
 * ("5c4mw0rd") don't matter.
 *
 * Diacritics:
 * - An entry written without any (English, or Vietnamese typed plain)
 *   matches however the text is decorated: "scämword" is "scamword".
 * - An entry written with them (Vietnamese) matches a word typed with
 *   diacritics only if they are the same ones: "đủ mà" is not "đụ má", and
 *   "Đỗ Ngọc" is a name, not "đồ ngốc". A word typed with none still matches
 *   ("do ngoc"), since many people type Vietnamese that way.
 * - Text typed without diacritics can't be told from the innocent words it
 *   also spells, so when that is how a `reject` entry matched, the answer is
 *   `hold`: a person decides.
 *
 * `reject` wins over `hold`.
 */
export function screenText(text: string, lists: WordLists = DEFAULT_WORD_LISTS): ScreenResult {
  const typedWords = words(text).map(typed);
  if (typedWords.length === 0) return "ok";
  const { reject, hold } = compile(lists);
  const rejected = find(typedWords, reject);
  if (rejected === "sure") return "reject";
  if (rejected === "folded" || find(typedWords, hold) !== "none") return "hold";
  return "ok";
}
