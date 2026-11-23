import { test } from "node:test";
import assert from "node:assert/strict";
import { isMemberStartCandidate, memberHasRoom } from "../lib/membership-start.ts";

test("a mini game day can start a membership even though casual sign-ups are locked", () => {
  assert.equal(isMemberStartCandidate({ registrationLocked: true, miniGame: true }), true);
  assert.equal(isMemberStartCandidate({ registrationLocked: false, miniGame: false }), true);
  // A day an admin closed for another reason still never starts a membership.
  assert.equal(isMemberStartCandidate({ registrationLocked: true, miniGame: false }), false);
});

test("members always fit on a mini game day; other days respect capacity", () => {
  // The 16-player mini game cap is for casual bookings only.
  assert.equal(memberHasRoom({ miniGame: true, maxPlayers: 16, activeMembers: 20, booked: 3 }), true);
  assert.equal(memberHasRoom({ miniGame: false, maxPlayers: 12, activeMembers: 11, booked: 0 }), true);
  assert.equal(memberHasRoom({ miniGame: false, maxPlayers: 12, activeMembers: 10, booked: 2 }), false);
});
