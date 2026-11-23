import { CORS_HEADERS, json, logActivity, requireScope } from "@/lib/api-v1";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Incoming check-ins from connected apps (e.g. a habit tracker):
// { "date": "YYYY-MM-DD", "type": "attendance" }. Stored unconfirmed until an
// admin confirms it, so the leaderboard can't be gamed.
export async function POST(request: Request) {
  const c = await requireScope(request, "write:activity");
  if (c instanceof Response) return c;
  const body = (await request.json().catch(() => ({}))) as { date?: string; type?: string };
  if ((body.type ?? "attendance") !== "attendance") return json({ error: "unsupported_type" }, 400);
  try {
    return json(await logActivity(c, body.date ?? ""), 202);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
}
