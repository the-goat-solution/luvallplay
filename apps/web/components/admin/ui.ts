// Shared inline styles for the admin pages added with player accounts, in
// the same look as the existing admin tabs (plain system font, navy buttons).

export const btn = {
  padding: "7px 13px",
  borderRadius: 6,
  border: "1px solid #1a2a4a",
  background: "#1a2a4a",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
} as const;

export const btnSecondary = {
  padding: "7px 13px",
  borderRadius: 6,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#333",
  fontSize: 13,
  cursor: "pointer",
} as const;

export const btnDanger = {
  ...btnSecondary,
  color: "#a12a2a",
  borderColor: "#e3b4b4",
} as const;

export const card = {
  border: "1px solid #e3e3e3",
  borderRadius: 8,
  padding: "16px 18px",
  marginBottom: 20,
  background: "#fff",
} as const;

export const input = {
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
} as const;

export const th = { padding: "6px 8px", textAlign: "left" } as const;
export const td = { padding: "6px 8px", verticalAlign: "top" } as const;

export const pill = (bg: string, color: string) =>
  ({
    display: "inline-block",
    background: bg,
    color,
    fontSize: 12,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  }) as const;

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
