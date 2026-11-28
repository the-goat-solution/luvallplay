// The red count on the Arena tab (a gap the cutover listed: on the website the
// Arena tab shows it, lib/profile-badges.ts): what waits for this person, the
// same two things the website counts (countArenaActions) — a score the other
// pair entered, to confirm or dispute, and a team-up request to answer.
type Board = {
  me: { incomingRequest: unknown | null } | null;
  mine: { status: string; enteredByMySide: boolean | null }[];
};

export function arenaActionCount(board: Board | undefined | null): number {
  if (!board?.me) return 0;
  const scores = board.mine.filter((c) => c.status === "awaiting" && c.enteredByMySide === false).length;
  return scores + (board.me.incomingRequest ? 1 : 0);
}

/** As the bell shows it: 1 to 9, then "9+". */
export const badgeText = (n: number): string => (n > 9 ? "9+" : String(n));
