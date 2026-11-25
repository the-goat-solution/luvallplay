// What the club calls a player and a pair, and the prices, filled into the
// tracker's text (ui/copy.ts). Plain TypeScript, so tests can run it as is.
export type Lang = "en" | "vi";

/** What the club calls a player and a pair, in one language. */
export type ClubWords = { player: string; players: string; Player: string; Pair: string };

/** Without a club's own words: plain ones. */
export const PLAIN_WORDS: Record<Lang, ClubWords> = {
  en: { player: "player", players: "players", Player: "Player", Pair: "Pair" },
  vi: { player: "người chơi", players: "người chơi", Player: "Người chơi", Pair: "Cặp" },
};

/** Fills the club's words and the prices into a line of the tracker's text. */
export function fillWords(text: string, lang: Lang, host: { words?: Partial<Record<Lang, ClubWords>>; prices: { live: string; upload: string } }): string {
  if (!text.includes("{")) return text;
  const w = host.words?.[lang] ?? PLAIN_WORDS[lang];
  return text
    .replaceAll("{players}", w.players)
    .replaceAll("{player}", w.player)
    .replaceAll("{Player}", w.Player)
    .replaceAll("{Pair}", w.Pair)
    .replaceAll("{priceLive}", host.prices.live)
    .replaceAll("{priceUpload}", host.prices.upload);
}

