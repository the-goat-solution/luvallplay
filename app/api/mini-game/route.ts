import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  createDraw,
  ensureMiniGameTables,
  getMiniGameState,
  lockScore,
  resetDraw,
} from "@/lib/mini-game-db";
import { checkRateLimit, getClientIp } from "@/lib/security";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function unavailable() {
  return NextResponse.json({ error: "Mini game storage is not configured" }, { status: 503 });
}

// Drawing, redrawing and resetting are organiser-only; entering scores is open to players.
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
  await ensureMiniGameTables();
  return stateResponse();
}

type Body =
  | { action: "draw"; password: string }
  | { action: "reset"; password: string }
  | { action: "redraw"; password: string }
  | { action: "score"; drawId: number; matchId: string; a: number; b: number };

export async function POST(request: Request) {
  if (!checkRateLimit(`mini-game:post:${getClientIp(request)}`, 40)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL) return unavailable();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.action !== "score" && !passwordMatches(body.password)) {
    if (!checkRateLimit(`mini-game:password:${getClientIp(request)}`, 10)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  await ensureMiniGameTables();

  switch (body.action) {
    case "draw":
      await createDraw();
      return stateResponse();

    case "reset": {
      const reset = await resetDraw();
      // 409 when the teams are still inside their one-week lock.
      return stateResponse(reset ? 200 : 409);
    }

    case "redraw": {
      // Same one-week lock as reset: only once it has run out.
      if (!(await resetDraw())) return stateResponse(409);
      await createDraw();
      return stateResponse();
    }

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
