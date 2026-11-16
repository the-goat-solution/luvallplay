import { CORS_HEADERS, attendanceData, json, requireScope } from "@/lib/api-v1";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional), newest first.
export async function GET(request: Request) {
  const c = await requireScope(request, "read:attendance");
  if (c instanceof Response) return c;
  const url = new URL(request.url);
  return json({ playDays: await attendanceData(c, url.searchParams.get("from"), url.searchParams.get("to")) });
}
