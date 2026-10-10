import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  ActionError,
  isValidAction,
  publicState,
  type CasualPlayResponse,
  type CasualPlayState,
} from "@/lib/casual-play";
import { ConflictError, ensureCasualPlayTables, getCasualPlayState, runCasualPlayAction } from "@/lib/casual-play-db";
import { addDays, ensureTables, listAllSessionDates, listSessionsInRange } from "@/lib/db";
import { formatEventTimeRange, getClubToday } from "@/lib/dates";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";
import { DEMO_PASSWORD, DEMO_SESSION, demoDates, isCasualPlayDemo } from "@/lib/casual-play-demo";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Organisers are either logged in to /admin, or know the organiser password
// (the same one that runs the mini game draw), sent as a header.
function passwordMatches(given: string | null): boolean {
  const expected = process.env.MINI_GAME_PASSWORD || (isCasualPlayDemo() ? DEMO_PASSWORD : undefined);
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function isOrganiser(request: Request): Promise<boolean> {
  return (await isAdminRequest(request)) || passwordMatches(request.headers.get("x-organiser-password"));
}

/** Today if it's a play day, otherwise the next one (or the latest past one). */
function defaultDate(dates: string[], today: string): string | null {
  return dates.find((d) => d >= today) ?? dates[dates.length - 1] ?? null;
}

async function sessionInfo(date: string): Promise<CasualPlayResponse["session"]> {
  if (isCasualPlayDemo()) return DEMO_SESSION;
  const [session] = await listSessionsInRange(date, date);
  if (!session) return null;
  return {
    time: session.eventStartTime ? formatEventTimeRange(session.eventStartTime, session.eventEndTime) : null,
    location: session.eventLocation,
  };
}

async function respond(
  date: string,
  state: CasualPlayState,
  organiser: boolean,
  dates: string[],
  status = 200,
) {
  const body: CasualPlayResponse = {
    state: organiser ? state : publicState(state),
    organiser,
    serverNow: Date.now(),
    // A window around today is plenty to pick from on a phone.
    dates: organiser ? dates.filter((d) => d >= addDays(getClubToday().dateKey, -21)).slice(0, 20) : [],
    session: await sessionInfo(date),
  };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function resolveDate(requested: string | null): Promise<{ date: string | null; dates: string[] }> {
  let dates: string[];
  if (isCasualPlayDemo()) dates = demoDates();
  else {
    await Promise.all([ensureTables(), ensureCasualPlayTables()]);
    dates = await listAllSessionDates();
  }
  if (requested) return { date: dates.includes(requested) ? requested : null, dates };
  return { date: defaultDate(dates, getClubToday().dateKey), dates };
}

export async function GET(request: Request) {
  if (!checkRateLimit(`casual-play:get:${getClientIp(request)}`, 120)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL && !isCasualPlayDemo()) {
    return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });
  }
  const organiser = await isOrganiser(request);
  if (!organiser && request.headers.get("x-organiser-password")) {
    if (!checkRateLimit(`casual-play:password:${getClientIp(request)}`, 10)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const { date, dates } = await resolveDate(new URL(request.url).searchParams.get("date"));
  if (!date) return NextResponse.json({ error: "No play day found" }, { status: 404, headers: NO_STORE });
  return respond(date, await getCasualPlayState(date), organiser, dates);
}

export async function POST(request: Request) {
  if (!checkRateLimit(`casual-play:post:${getClientIp(request)}`, 90)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.POSTGRES_URL && !isCasualPlayDemo()) {
    return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });
  }
  if (!(await isOrganiser(request))) {
    if (!checkRateLimit(`casual-play:password:${getClientIp(request)}`, 10)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  let body: { date?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof body.date !== "string" || !isValidAction(body.action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { date, dates } = await resolveDate(body.date);
  if (!date) return NextResponse.json({ error: "No play day found" }, { status: 404 });

  try {
    return respond(date, await runCasualPlayAction(date, body.action), true, dates);
  } catch (err) {
    if (err instanceof ActionError || err instanceof ConflictError) {
      // 409 carries the latest board so the page can catch up.
      const status = err instanceof ActionError ? 400 : 409;
      const res = await respond(date, await getCasualPlayState(date), true, dates, status);
      const json = await res.json();
      return NextResponse.json({ ...json, error: err.message }, { status, headers: NO_STORE });
    }
    throw err;
  }
}
