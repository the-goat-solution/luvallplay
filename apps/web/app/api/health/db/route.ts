import { NextResponse } from "next/server";
import { ping } from "@/lib/repos/health";
import { isAdminRequest } from "@/lib/security";
import { loadWorld } from "@/lib/arena-db";
import { buildArenaState } from "@/lib/arena-state";

// Speed check: where the function and the database run, how long one
// database round trip takes, and what the start-up table checks and an Arena
// load cost. Open on previews; admins only in production. Reports the
// database's cloud region (from its host name), never the connection string.

export const dynamic = "force-dynamic";

const bootedAt = Date.now();
let served = 0;

function dbRegion(): string {
  try {
    const host = new URL(process.env.POSTGRES_URL ?? "").hostname;
    const m = host.match(/(?:aws|gcp|azure)?-?((?:us|eu|ap|sa|ca|me|af|il)-[a-z]+-\d)/);
    return m ? m[1] : host.split(".").slice(1, 3).join(".") || "unknown";
  } catch {
    return "unknown";
  }
}

const ms = (t: number) => Math.round(performance.now() - t);

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production" && !(await isAdminRequest(request))) {
    return NextResponse.json({ error: "admins_only" }, { status: 401 });
  }
  const cold = served++ === 0;
  const out: Record<string, unknown> = {
    functionRegion: process.env.VERCEL_REGION ?? "local",
    databaseRegion: dbRegion(),
    coldInstance: cold,
    instanceAgeSeconds: Math.round((Date.now() - bootedAt) / 1000),
    // Present or not (values are never shown).
    settings: {
      email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
      playerSessionSecret: Boolean(process.env.PLAYER_SESSION_SECRET),
    },
  };
  let t = performance.now();
  out.startupTableChecksMs = ms(t);
  const pings: number[] = [];
  for (let i = 0; i < 5; i++) {
    t = performance.now();
    await ping();
    pings.push(ms(t));
  }
  out.roundTripMs = pings;
  t = performance.now();
  await loadWorld();
  out.arenaLoadMs = ms(t);
  t = performance.now();
  await buildArenaState(null);
  out.arenaPageDataMs = ms(t);
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
