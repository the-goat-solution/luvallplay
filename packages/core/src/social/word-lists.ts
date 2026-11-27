// The default word lists for the screen (screen.ts). Data only.
//
// NOT FINAL: the owner reviews both lists, and a Vietnamese speaker reviews
// the Vietnamese entries, before Social is switched on for any club.
//
// How to edit:
// - Lower case, with diacritics where the language has them. The screen folds
//   case and diacritics itself, so "đồ khốn" also catches "do khon".
// - Whole words or phrases. An entry never matches inside a longer word.
// - `reject` refuses the write: only words with no innocent use.
// - `hold` saves it for a moderator: abuse that depends on context, and the
//   phrases scams use.
// - Vietnamese: many words become an ordinary word once the diacritics are
//   gone (a crude word folds to "lon", and so does "lớn", big). Don't list a
//   single word like that. Use a phrase, and put it in `hold` if the folded
//   phrase could still be innocent.
// - Keep it short. This is a first filter; reports and moderators do the rest.
import type { WordLists } from "./screen.ts";

export const DEFAULT_WORD_LISTS: WordLists = {
  reject: [
    // English: slurs and threats with no innocent use.
    "nigger",
    "nigga",
    "faggot",
    "kike",
    "kill yourself",
    "kys",
    // Vietnamese: the strongest abuse, as phrases.
    "địt mẹ",
    "đụ má",
    "đụ mẹ",
  ],
  hold: [
    // English: abuse that depends on who says it to whom.
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
    "óc chó",
    "đồ ngốc",
    // Vietnamese: scams (pay first, easy work for high pay, prizes, loans, betting).
    "chuyển khoản trước",
    "đặt cọc trước",
    "việc nhẹ lương cao",
    "trúng thưởng",
    "cho vay",
    "cá độ",
    "lừa đảo",
  ],
};
