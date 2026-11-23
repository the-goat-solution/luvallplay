/** "Mai T." / "Mai Tran" → "Mai". Never more than the first word (the public leaderboard teaser). */
export function firstNameOnly(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
