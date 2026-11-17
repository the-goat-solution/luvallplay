import crypto from "crypto";
import { NextResponse } from "next/server";
import { runMove, type MoveMode } from "@/lib/db-move";

// One-off database move (see lib/db-move.ts). Only runs on preview
// deployments (behind Vercel's login) or locally, and needs the
// DB_MOVE_TOKEN set for this move. Remove once the move is done.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function tokenOk(given: string | null): boolean {
  const want = process.env.DB_MOVE_TOKEN;
  if (!want || !given || want.length !== given.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(given));
}

export async function GET(request: Request) {
  const allowedHere = process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production";
  const url = new URL(request.url);
  if (!allowedHere || !tokenOk(url.searchParams.get("token"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const mode = (["check", "copy", "catchup", "finish"] as const).includes(url.searchParams.get("mode") as MoveMode)
    ? (url.searchParams.get("mode") as MoveMode)
    : "check";
  try {
    return NextResponse.json(await runMove(mode), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
