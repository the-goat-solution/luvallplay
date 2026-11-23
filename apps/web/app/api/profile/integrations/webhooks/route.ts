import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { EVENTS, createWebhookEndpoint, isAllowedWebhookUrl, listWebhookEndpoints } from "@/lib/webhooks";

const bodySchema = z.object({
  url: z.string().trim().url().max(500),
  events: z.array(z.enum(EVENTS)).optional(),
});

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }
  if (!isAllowedWebhookUrl(body.url)) return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  if ((await listWebhookEndpoints(player.id)).length >= 5) return NextResponse.json({ error: "too_many" }, { status: 409 });
  return NextResponse.json(await createWebhookEndpoint(player.id, body.url, body.events ?? [...EVENTS]));
}
