import crypto from "crypto";
import { NextResponse } from "next/server";
import { createDraw, getMiniGameState, lockScore } from "@/lib/mini-game-db";
import { drawTeams } from "@/lib/mini-game-roster";
import { checkRateLimit, getClientIp } from "@/lib/security";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function unavailable() {
  return NextResponse.json({ error: "Mini game storage is not configured" }, { status: 503 });
}

// Drawing is organiser-only; entering scores is open to players. A draw retires
// itself when its one-week lock runs out (see archiveExpiredDraw).
function passwordMatches(given: unknown): boolean {
  const expected = process.env.MINI_GAME_PASSWORD;
  if (!expected || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function stateResponse(status = 200) {
  return NextResponse.json(await getMiniGameState(), { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  if (!checkRateLimit(`mini-game:get:${getClientIp(request)}`, 120)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL) return unavailable();
  return stateResponse();
}

type Body =
  | { action: "draw"; password: string }
  | { action: "preview" }
  | { action: "score"; drawId: number; matchId: string; a: number; b: number };

export async function POST(request: Request) {
  if (!checkRateLimit(`mini-game:post:${getClientIp(request)}`, 40)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!process.env.POSTGRES_URL) return unavailable();

  // Sample teams for preview mode, drawn by the real tier rules but never
  // saved, and only before the official draw: once teams exist, everyone
  // gets the live game (409 + current state) instead.
  if (body.action === "preview") {
    const state = await getMiniGameState();
    if (state.draw) {
      return NextResponse.json(state, { status: 409, headers: NO_STORE });
    }
    return NextResponse.json({ teams: drawTeams() }, { headers: NO_STORE });
  }

  if (body.action !== "score" && !passwordMatches(body.password)) {
    if (!checkRateLimit(`mini-game:password:${getClientIp(request)}`, 10)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  switch (body.action) {
    case "draw":
      await createDraw();
      return stateResponse();

    case "score": {
      const result = await lockScore(
        Number(body.drawId),
        String(body.matchId),
        Number(body.a),
        Number(body.b),
      );
      const status = result === "ok" ? 200 : result === "invalid" ? 400 : 409;
      return stateResponse(status);
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
