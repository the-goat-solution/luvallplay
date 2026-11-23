import { CORS_HEADERS, json, requireScope, roundRobinData } from "@/lib/api-v1";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const c = await requireScope(request, "read:attendance");
  if (c instanceof Response) return c;
  return json({ results: await roundRobinData(c) });
}
