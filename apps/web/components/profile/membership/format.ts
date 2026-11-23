import type { Lang } from "@/lib/i18n";
import { clubMoney } from "@/lib/money";

/** "Fri 12 Dec" (or the Vietnamese equivalent) from a YYYY-MM-DD club date. */
export function fmtDate(dateKey: string | null | undefined, lang: Lang, withYear = false): string {
  if (!dateKey) return "";
  const d = new Date(`${dateKey}T00:00:00Z`);
  return d.toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function fmtMoney(cents: number): string {
  return clubMoney(cents);
}

export async function postJson(
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
}
