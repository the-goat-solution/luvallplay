// The default word lists for the screen (screen.ts). Data only.
//
// NOT FINAL: the owner reviews both lists, and a Vietnamese speaker reviews
// the Vietnamese entries, before Social is switched on for any club.
//
// How to edit:
// - Lower case, with diacritics where the language has them. Plain words and
//   spaces only: an entry with any other symbol in it is skipped.
// - Whole words or phrases. An entry never matches inside a longer word, so
//   a plural is its own entry.
// - `reject` refuses the write: only words with no innocent use.
// - `hold` saves it for a moderator: abuse that depends on context, and the
//   phrases scams use.
// - Keep it short. This is a first filter; reports and moderators do the rest.
//
// How diacritics are matched (screen.ts):
// - An entry with none (the English ones) matches however the text is
//   decorated.
// - An entry with some (the Vietnamese ones) matches a word typed with
//   diacritics only when they are the entry's own: "đủ mà" (enough) and
//   "dù mà" (even if) are not "đụ má". A word typed with no diacritics at all
//   still matches, and a `reject` entry matched that way is only held, since
//   "du ma" could be any of the three.
// - So write Vietnamese entries WITH their diacritics. One written without
//   ("cho vay") would match every word that folds to it ("cho vậy").
// - Text typed without diacritics that happens to spell an entry is held for
//   a moderator. Leave out any entry whose plain spelling is everyday talk or
//   a name ("đồ ngốc" is also the name Đỗ Ngọc), and any that is innocent as
//   written ("óc chó" is an insult and a walnut).
import type { WordLists } from "./screen.ts";

export const DEFAULT_WORD_LISTS: WordLists = {
  reject: [
    // English: slurs with no innocent use.
    "nigger",
    "niggers",
    "nigga",
    "niggas",
    "faggot",
    "faggots",
    "kike",
    "kikes",
    "kys",
    // Vietnamese: the strongest abuse, as phrases. Typed without diacritics these are held.
    "địt mẹ",
    "đụ má",
    "đụ mẹ",
  ],
  hold: [
    // English: abuse that depends on who says it to whom.
    "kill yourself",
    "retard",
    "whore",
    "slut",
    "cunt",
    "bitch",
    "chink",
    "tranny",
    // English: what scams and off-platform selling sound like.
    "wire transfer",
    "western union",
    "gift card",
    "gift cards",
    "bitcoin",
    "crypto",
    "send money",
    "pay upfront",
    "easy money",
    "whatsapp me",
    "telegram me",
    // Vietnamese: abuse.
    "thằng ngu",
    "con điếm",
    "đồ khốn",
    // Vietnamese: scams (pay first, easy work for high pay, prizes, betting).
    "chuyển khoản trước",
    "đặt cọc trước",
    "việc nhẹ lương cao",
    "trúng thưởng",
    "cá độ",
    "lừa đảo",
  ],
};
