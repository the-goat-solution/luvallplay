import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { SCOPES, createApiToken, listApiTokens } from "@/lib/webhooks";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1),
});

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if ((await listApiTokens(player.id)).length >= 10) return NextResponse.json({ error: "too_many" }, { status: 409 });
  return NextResponse.json(await createApiToken(player.id, body.name, body.scopes));
}
