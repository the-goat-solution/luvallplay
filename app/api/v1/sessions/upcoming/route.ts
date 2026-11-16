import { CORS_HEADERS, json, upcomingSessionsData } from "@/lib/api-v1";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Public: upcoming play days with casual spots left. ?days=30 (max 60)
export async function GET(request: Request) {
  if (!process.env.POSTGRES_URL) return json({ error: "unavailable" }, 503);
  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  return json({ sessions: await upcomingSessionsData(days) });
}
