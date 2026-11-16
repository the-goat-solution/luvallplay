import { CORS_HEADERS, json, meData, requireScope } from "@/lib/api-v1";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const c = await requireScope(request, "read:stats");
  if (c instanceof Response) return c;
  const data = await meData(c);
  return data ? json(data) : json({ error: "not_found" }, 404);
}
