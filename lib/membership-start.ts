// Which play days a membership can start on or cover, kept pure (no DB) so
// the rule is unit-tested in one place and shared by the start-date search
// (lib/db.ts) and the plan/day switch check (lib/membership-self-service.ts).
//
// A mini game day locks registration, but that lock is for casual sign-ups
// only: members are always included in a mini game (they mark "Can't make
// it" if they can't come). So a mini game day never blocks a member from
// signing up or renewing, while a day an admin locked for any other reason
// still never becomes a new member's first day.

export type MemberStartSession = {
  registrationLocked: boolean;
  miniGame: boolean;
};

/** Can a new or renewed membership start on this play day? */
export function isMemberStartCandidate(s: MemberStartSession): boolean {
  return s.miniGame || !s.registrationLocked;
}

/**
 * Is there room for one more member on this play day? Mini game days always
 * include members, so their 16-player cap only limits casual bookings.
 */
export function memberHasRoom(s: {
  miniGame: boolean;
  maxPlayers: number;
  activeMembers: number;
  booked: number;
}): boolean {
  if (s.miniGame) return true;
  return s.maxPlayers - s.activeMembers - s.booked > 0;
}
