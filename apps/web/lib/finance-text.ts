// Finance wording in the admin's language, as siblings of the English helpers
// in lib/finance.ts (which exports, emails and receipts keep using). Money
// formatting and dates' parsing are not touched; only names and labels.
import { admin, at, type AdminKey } from "@luvallplay/i18n/admin";
import type { Lang } from "@luvallplay/i18n";
import { categoryLabel, methodLabel, presetLabel, formatDateKey, type FinanceFilters, type FinancePreset } from "./finance.ts";

const has = (key: string) => key in (admin.en as Record<string, string>);

export function categoryLabelIn(lang: Lang, value: string): string {
  const key = `fin_cat_${value}`;
  return has(key) ? at(lang, key as AdminKey) : categoryLabel(value);
}

export function methodLabelIn(lang: Lang, value: string | null | undefined): string {
  if (!value) return "";
  const key = `fin_method_${value}`;
  return has(key) ? at(lang, key as AdminKey) : methodLabel(value);
}

export function presetLabelIn(lang: Lang, value: FinancePreset): string {
  const key = `fin_preset_${value.replace(/-/g, "_")}`;
  return has(key) ? at(lang, key as AdminKey) : presetLabel(value);
}

/** "9 Oct 2026" in English, "9 thg 10 2026" in Vietnamese. */
export function formatDateKeyIn(lang: Lang, key: string): string {
  if (lang === "en") return formatDateKey(key);
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${at(lang, `fin_month_${m}` as AdminKey)} ${y}`;
}

/** "Oct" or "Oct 2026"; "thg 10" / "thg 10 2026". */
export function monthLabelIn(lang: Lang, month: string, { year = false } = {}): string {
  const [y, m] = month.split("-").map(Number);
  const name = at(lang, `fin_month_${m}` as AdminKey);
  return year ? `${name} ${y}` : name;
}

export function formatRangeIn(lang: Lang, from: string | null, to: string | null): string {
  if (!from && !to) return at(lang, "fin_range_all");
  if (from && !to) return at(lang, "fin_range_from", { d: formatDateKeyIn(lang, from) });
  if (!from && to) return at(lang, "fin_range_to", { d: formatDateKeyIn(lang, to) });
  return `${formatDateKeyIn(lang, from!)} – ${formatDateKeyIn(lang, to!)}`;
}

export function describeNonDateFiltersIn(lang: Lang, filters: FinanceFilters): string[] {
  const parts: string[] = [];
  if (filters.kind) parts.push(at(lang, "fin_f_type", { v: at(lang, filters.kind === "received" ? "fin_received" : "fin_spent") }));
  if (filters.category) parts.push(at(lang, "fin_f_category", { v: categoryLabelIn(lang, filters.category) }));
  if (filters.method) parts.push(at(lang, "fin_f_method", { v: methodLabelIn(lang, filters.method) }));
  if (filters.q) parts.push(at(lang, "fin_f_search", { v: filters.q }));
  return parts;
}
