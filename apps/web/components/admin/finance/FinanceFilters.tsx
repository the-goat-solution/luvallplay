"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import {
  FINANCE_CATEGORIES,
  FINANCE_METHODS,
  FINANCE_PRESETS,
  DEFAULT_PRESET,
  financeFiltersToSearchParams,
  resolvePresetRange,
  type FinanceFilters as Filters,
  type FinanceKind,
  type FinancePreset,
} from "@/lib/finance";
import styles from "./financials.module.css";

// Filter bar for the Financials page. Every change navigates straight away
// (no Apply button) — the URL is the single source of truth for the filters,
// so the table, the totals and the Excel export all read the same thing,
// and any view can be bookmarked or shared with another admin.
export function FinanceFilters({ filters, today }: { filters: Filters; today: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q);
  // Local copies so typing a date doesn't navigate on every keystroke of a
  // half-entered value; we navigate once the input holds a complete date.
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");

  // Re-sync the local copies whenever the URL filters change.
  const [synced, setSynced] = useState({ from: filters.from, to: filters.to, q: filters.q });
  if (synced.from !== filters.from || synced.to !== filters.to || synced.q !== filters.q) {
    setSynced({ from: filters.from, to: filters.to, q: filters.q });
    setFrom(filters.from ?? "");
    setTo(filters.to ?? "");
    setQ(filters.q);
  }

  function go(overrides: Partial<Filters>) {
    const params = financeFiltersToSearchParams(filters, overrides);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/admin/financials?${qs}` : "/admin/financials", { scroll: false });
    });
  }

  function onPreset(preset: FinancePreset) {
    if (preset === "custom") {
      // Keep whatever range is showing now as the starting point.
      go({ preset, from: filters.from ?? `${today.slice(0, 4)}-01-01`, to: filters.to ?? today });
      return;
    }
    go({ preset, ...resolvePresetRange(preset, today) });
  }

  function onDate(which: "from" | "to", value: string) {
    if (which === "from") setFrom(value);
    else setTo(value);
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const next = {
      from: which === "from" ? value || null : from || null,
      to: which === "to" ? value || null : to || null,
    };
    if (!next.from && !next.to) return;
    go({ preset: "custom", ...next });
  }

  const kinds: { value: FinanceKind | null; label: string; className?: string }[] = [
    { value: null, label: "All" },
    { value: "received", label: "Received", className: styles.segmentReceived },
    { value: "spent", label: "Spent", className: styles.segmentSpent },
  ];

  const isDefault =
    filters.preset === DEFAULT_PRESET &&
    !filters.kind &&
    !filters.category &&
    !filters.method &&
    !filters.q;

  return (
    <div className={styles.filters} role="search" aria-label="Filter transactions">
      <label className={styles.field}>
        <span className={styles.label}>Period</span>
        <select
          className={styles.select}
          value={filters.preset}
          onChange={(e) => onPreset(e.target.value as FinancePreset)}
        >
          {FINANCE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>From</span>
        <input
          type="date"
          className={styles.input}
          value={from}
          max={to || undefined}
          onChange={(e) => onDate("from", e.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>To</span>
        <input
          type="date"
          className={styles.input}
          value={to}
          min={from || undefined}
          onChange={(e) => onDate("to", e.target.value)}
        />
      </label>

      <div className={styles.field}>
        <span className={styles.label} id="finance-type-label">
          Type
        </span>
        <div className={styles.segmented} role="group" aria-labelledby="finance-type-label">
          {kinds.map((k) => {
            const active = filters.kind === k.value;
            return (
              <button
                key={k.label}
                type="button"
                aria-pressed={active}
                className={`${styles.segment} ${k.className ?? ""} ${active ? styles.segmentActive : ""}`}
                onClick={() => {
                  // Keep the chosen source if it still belongs to the new type.
                  const current = FINANCE_CATEGORIES.find((c) => c.value === filters.category);
                  const keep = current && (!k.value || current.kind === k.value);
                  go({ kind: k.value, category: keep ? filters.category : null });
                }}
              >
                {k.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Category</span>
        <select
          className={styles.select}
          value={filters.category ?? ""}
          onChange={(e) => go({ category: e.target.value || null })}
        >
          <option value="">All sources</option>
          {(["received", "spent"] as const)
            .filter((kind) => !filters.kind || filters.kind === kind)
            .map((kind) => (
              <optgroup key={kind} label={kind === "received" ? "Money in" : "Money out"}>
                {FINANCE_CATEGORIES.filter((c) => c.kind === kind).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Method</span>
        <select
          className={styles.select}
          value={filters.method ?? ""}
          onChange={(e) => go({ method: e.target.value || null })}
        >
          <option value="">All methods</option>
          {FINANCE_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <form
        className={styles.field}
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q.trim() });
        }}
      >
        <span className={styles.label}>Search</span>
        <input
          type="search"
          className={`${styles.input} ${styles.search}`}
          placeholder="Name, person or note…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => {
            if (q.trim() !== filters.q) go({ q: q.trim() });
          }}
        />
      </form>

      {!isDefault ? (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() =>
            startTransition(() => router.push("/admin/financials", { scroll: false }))
          }
        >
          Reset
        </button>
      ) : null}

      {isPending ? (
        <span className={styles.pending} role="status">
          <LoadingIcon size="sm" />
          Updating…
        </span>
      ) : null}
    </div>
  );
}
