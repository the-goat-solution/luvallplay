// Shared admin helpers. (The inline style objects that used to live here
// are gone: pages use the admin kit, components/admin/kit.)

export function formatNz(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
