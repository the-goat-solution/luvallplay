// A club's words for a player and a pair (its terms: player_name,
// players_name, pair_name, each language's own where it has one), as the
// shared tracker takes them. None: the tracker's plain "Player 1", "Pair A".
type Words = { player: string; players: string; Player: string; Pair: string };
type Names = { playerName?: string; playersName?: string; pairName?: string };
export type TermsWithWords = Names & { localized?: Record<string, Names | undefined> };

export function clubWords(terms: TermsWithWords | null | undefined): Partial<Record<"en" | "vi", Words>> | undefined {
  if (!terms) return undefined;
  const out: Partial<Record<"en" | "vi", Words>> = {};
  for (const lang of ["en", "vi"] as const) {
    const own = terms.localized?.[lang];
    const name = own?.playerName ?? terms.playerName;
    const pair = own?.pairName ?? terms.pairName;
    if (!name || !pair) continue;
    // A language's own name brings its own plural (or none: Vietnamese has no plural).
    const many = own?.playerName ? (own.playersName ?? name) : (terms.playersName ?? (lang === "vi" ? name : `${name}s`));
    out[lang] = { Player: name, player: name.toLocaleLowerCase(lang), players: many.toLocaleLowerCase(lang), Pair: pair };
  }
  return Object.keys(out).length ? out : undefined;
}
