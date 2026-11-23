import { visionName } from "@/lib/club-terms";
import { NextResponse } from "next/server";
import { clubCurrencyLower } from "@/lib/money";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { getStripe } from "@/lib/stripe";
import { getSiteUrl } from "@/lib/email-layout";
import { WV_TRIAL_ENDS_ISO, isTrial } from "@/lib/wolf-vision-trial";
import { PASS_PRICE_CENTS, attachStripeSession, createPass, markPassPaid, usablePass, consumePass, type PassKind } from "@/lib/wolf-vision-db";

// Wolf Vision paywall: $2 NZD to analyse an uploaded video, $5 NZD for a live
// match. GET: the signed-in player's usable pass (and, after Stripe Checkout,
// confirms the payment). POST {kind}: buy one (returns the Checkout URL).
// PATCH {passId}: start a session on it. Production only charges real money:
// previews and local runs (no live Stripe key) hand out free test passes.
// Until the end of February 2027 (NZ time) Wolf Vision is a free trial: no pass
// is needed and none can be bought.

export const dynamic = "force-dynamic";

const kindSchema = z.enum(["upload", "live"]);
const live = () => process.env.VERCEL_ENV === "production" && !!process.env.STRIPE_SECRET_KEY;

export async function GET(request: Request) {
  if (isTrial()) return NextResponse.json({ trial: true, trialEnds: WV_TRIAL_ENDS_ISO, pass: null, priceCents: null, testMode: false }, { headers: { "Cache-Control": "no-store" } });
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const url = new URL(request.url);
  const kind = kindSchema.safeParse(url.searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const sessionId = url.searchParams.get("session_id");
  if (sessionId && live()) {
    try {
      const cs = await getStripe().checkout.sessions.retrieve(sessionId);
      if (cs.payment_status === "paid" && cs.metadata?.type === "wolf_vision") await markPassPaid(cs.id);
    } catch (err) {
      console.error("[wolf-vision] checkout check failed", err);
    }
  }
  const pass = await usablePass(player.id, kind.data);
  return NextResponse.json({ pass, priceCents: PASS_PRICE_CENTS[kind.data], testMode: !live() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (isTrial()) return NextResponse.json({ error: "free_trial", trialEnds: WV_TRIAL_ENDS_ISO }, { status: 409 });
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!checkRateLimit(`wv-pass:${player.id}`, 10, 60_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const body = z.object({ kind: kindSchema, challengeId: z.number().int().positive().nullable().optional(), returnTo: z.string().max(300).optional() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const kind: PassKind = body.data.kind;
  if (!live()) {
    const pass = await createPass(player.id, kind, { test: true, challengeId: body.data.challengeId });
    return NextResponse.json({ pass, testMode: true });
  }
  const pass = await createPass(player.id, kind, { test: false, challengeId: body.data.challengeId });
  // Back to the analyzer (same challenge, if any) with the session to confirm.
  const rt = body.data.returnTo;
  const back = rt && rt.startsWith("/profile/wolf-vision") ? rt : "/profile/wolf-vision";
  const sep = back.includes("?") ? "&" : "?";
  const site = getSiteUrl();
  const cs = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: clubCurrencyLower(),
          unit_amount: PASS_PRICE_CENTS[kind],
          product_data: {
            name: kind === "live" ? `${visionName()} AI tracker: live match` : `${visionName()} AI tracker: video analysis`,
            description: kind === "live" ? "AI-enhanced tracking of one live doubles match on your phone." : "AI-enhanced analysis of one uploaded match video.",
          },
        },
      },
    ],
    customer_email: player.email,
    metadata: { type: "wolf_vision", kind, passId: String(pass.id), playerId: String(player.id) },
    success_url: `${site}${back}${sep}wv_paid=${kind}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}${back}`,
  });
  await attachStripeSession(pass.id, cs.id);
  return NextResponse.json({ url: cs.url });
}

export async function PATCH(request: Request) {
  if (isTrial()) return NextResponse.json({ trial: true });
  if (!process.env.POSTGRES_URL) return NextResponse.json({ error: "no_database" }, { status: 503 });
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = z.object({ passId: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const pass = await consumePass(player.id, body.data.passId);
  if (!pass) return NextResponse.json({ error: "no_pass" }, { status: 402 });
  return NextResponse.json({ pass });
}
