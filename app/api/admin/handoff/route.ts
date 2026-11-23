import { NextResponse } from "next/server";
import { audit, db, readCookie } from "@/lib/admin-access";
import { createHandoff, getAccess, hasAdminAccess, isStepUpFresh } from "@/lib/admin-roles";
import { PLAYER_COOKIE, sessionForToken } from "@/lib/player-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The native app's "Club admin" button (build plan §2.4): asks for a
// single-use, 60-second link that opens admin in the in-app browser already
// signed in, so the app's own token never leaves the app.
//
// Signed in by the app's bearer token or the web cookie. Needs an admin role
// and a sign-in within 12 hours (otherwise 401 "step_up": the app asks for a
// fresh code first).
export async function POST(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const session = await sessionForToken(bearer ?? readCookie(request, PLAYER_COOKIE));
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getAccess(db, session.player.id, session.player.email);
  if (!hasAdminAccess(access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isStepUpFresh(session.signedInAt)) return NextResponse.json({ error: "step_up" }, { status: 401 });

  const { token, expiresInSeconds } = await createHandoff(db, session.player.id);
  const ctx = { kind: "player" as const, player: { id: session.player.id, email: session.player.email, firstName: session.player.firstName, lastName: session.player.lastName }, access, signedInAt: session.signedInAt, stepUpFresh: true };
  await audit(ctx, { action: "admin.handoff_created", target: `player:${session.player.id}` });
  const url = new URL(`/admin/handoff?token=${encodeURIComponent(token)}`, request.url);
  return NextResponse.json({ url: url.toString(), expiresInSeconds }, { headers: { "Cache-Control": "no-store" } });
}
