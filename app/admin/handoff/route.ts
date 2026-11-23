import { NextResponse } from "next/server";
import { audit, db } from "@/lib/admin-access";
import { consumeHandoff, getAccess, hasAdminAccess } from "@/lib/admin-roles";
import { createPlayerSession } from "@/lib/player-auth";
import { getPlayerById } from "@/lib/player-db";
import { setPlayerCookies } from "@/lib/player-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens a handoff link (see /api/admin/handoff). Single use, 60 seconds.
// A good link starts a fresh session (so it counts as a sign-in for the
// 12-hour step-up) and lands on admin; anything else goes to sign-in.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const signIn = NextResponse.redirect(new URL("/login?next=/admin", request.url), 303);
  const playerId = await consumeHandoff(db, token);
  if (!playerId) return signIn;
  const player = await getPlayerById(playerId);
  if (!player) return signIn;
  const access = await getAccess(db, player.id, player.email);
  if (!hasAdminAccess(access)) return signIn;

  const sessionToken = await createPlayerSession(player.id, request.headers.get("user-agent"));
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  setPlayerCookies(response, sessionToken);
  await audit(
    { kind: "player", player: { id: player.id, email: player.email, firstName: player.firstName, lastName: player.lastName }, access, signedInAt: new Date(), stepUpFresh: true },
    { action: "admin.handoff_used", target: `player:${player.id}` },
  );
  return response;
}
