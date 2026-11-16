"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import styles from "../profile.module.css";
import { fmtDate, postJson } from "./format";

type Tier = "monthly" | "quarterly";
type Day = "friday" | "wednesday";

/**
 * No membership yet: every plan as an on-brand card, then billing choice,
 * then pay. Details come from the account, so it's plan → pay.
 */
export function JoinPanel({
  prices,
  pausedDays,
  player,
}: {
  prices: { monthly: number; quarterly: number };
  pausedDays: string[];
  player: { firstName: string; lastName: string; email: string; phone: string };
}) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const [day, setDay] = useState<Day>(pausedDays.includes("friday") && !pausedDays.includes("wednesday") ? "wednesday" : "friday");
  const [tier, setTier] = useState<Tier>("quarterly");
  const [recurring, setRecurring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const dayPaused = pausedDays.includes(day);
  const price = tier === "quarterly" ? prices.quarterly : prices.monthly;

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await postJson("/api/create-subscription", {
      plan: tier,
      day,
      firstName: player.firstName,
      lastName: player.lastName,
      email: player.email,
      phone: player.phone,
      recurring,
    });
    setBusy(false);
    if (!res.ok) {
      const code = res.data.error as string;
      const key: ProfileKey = code === "sessions_full" ? "mem_full" : code === "already_member" ? "mem_already_member" : code === "day_paused" ? "mem_err_day_paused" : "mem_err_generic";
      setError(tr(key));
      return;
    }
    setClientSecret(res.data.clientSecret as string);
    setPeriodStart((res.data.periodStart as string) ?? null);
  };

  if (done) {
    return (
      <section className={styles.card}>
        <div className={styles.success} style={{ marginBottom: 0 }}>
          {periodStart ? tr("mem_joined", { date: fmtDate(periodStart, lang, true) }) : tr("mem_joined_soon")}
        </div>
      </section>
    );
  }

  const planCard = (t: Tier) => {
    const selected = tier === t;
    const p = t === "quarterly" ? prices.quarterly : prices.monthly;
    return (
      <button
        key={t}
        type="button"
        onClick={() => setTier(t)}
        aria-pressed={selected}
        style={{
          position: "relative",
          textAlign: "left",
          border: `2px solid ${selected ? "var(--bronze)" : "transparent"}`,
          background: selected ? "#fffaf0" : "#fff",
          borderRadius: 16,
          padding: "16px 16px 14px",
          boxShadow: "var(--shadow-card)",
          font: "inherit",
          color: "inherit",
          minHeight: 110,
          cursor: "pointer",
        }}
      >
        {t === "quarterly" && (
          <span style={{ position: "absolute", top: -10, right: 12, background: "var(--bronze)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
            {tr("mem_best_value")}
          </span>
        )}
        <div style={{ fontWeight: 700, color: "var(--navy)", fontSize: 16 }}>{tr(t === "quarterly" ? "mem_quarterly" : "mem_monthly")}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: "var(--navy)", margin: "4px 0 2px" }}>${p}</div>
        <div className={styles.small}>{tr(t === "quarterly" ? "mem_per_12w" : "mem_per_4w")}</div>
      </button>
    );
  };

  return (
    <section className={styles.card} aria-labelledby="join-title">
      <h2 id="join-title" style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", color: "var(--navy)", fontSize: 22 }}>
        {tr("mem_join_title")}
      </h2>
      <p className={styles.small} style={{ marginBottom: 16 }}>
        {tr("mem_join_sub")}
      </p>
      {error && <div className={styles.error}>{error}</div>}

      {!clientSecret ? (
        <>
          <div role="radiogroup" aria-label="Day" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {(["friday", "wednesday"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={day === d}
                onClick={() => setDay(d)}
                className={`${styles.btn} ${day === d ? styles.navy : styles.secondary}`}
                style={{ flex: 1 }}
              >
                {tr(d === "friday" ? "mem_friday" : "mem_wednesday")}
              </button>
            ))}
          </div>
          {dayPaused ? (
            <div className={styles.notice}>{tr("mem_paused_day", { day: tr(day === "friday" ? "mem_friday" : "mem_wednesday") })}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, paddingTop: 6 }}>
                {planCard("monthly")}
                {planCard("quarterly")}
              </div>
              <div className={styles.label} style={{ marginBottom: 8 }}>
                {tr("mem_billing")}
              </div>
              <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                {[true, false].map((r) => (
                  <label
                    key={String(r)}
                    className={styles.row}
                    style={{ background: "var(--cream)", borderRadius: 12, padding: "6px 14px", border: `1.5px solid ${recurring === r ? "var(--bronze)" : "transparent"}`, cursor: "pointer" }}
                  >
                    <input type="radio" name="join-billing" checked={recurring === r} onChange={() => setRecurring(r)} style={{ width: 20, height: 20 }} />
                    <span className={styles.rowText}>
                      <strong>{tr(r ? "mem_billing_auto" : "mem_billing_once")}</strong>
                      <span className={styles.small}>{tr(r ? "mem_billing_auto_d" : "mem_billing_once_d")}</span>
                    </span>
                  </label>
                ))}
              </div>
              <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy} onClick={start}>
                {busy ? "…" : `${tr("mem_continue_to_pay")} · $${price}`}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <p className={styles.muted} style={{ marginBottom: 12 }}>
            {tr("mem_plan_line", { plan: tr(tier === "quarterly" ? "mem_quarterly" : "mem_monthly"), day: tr(day === "friday" ? "mem_friday" : "mem_wednesday") })}
            {periodStart ? ` · ${tr("mem_starts_on", { date: fmtDate(periodStart, lang) })}` : ""}
          </p>
          <StripeCardForm
            clientSecret={clientSecret}
            amountLabel={tr("mem_pay", { amount: price })}
            returnPath="/profile/membership"
            onSuccess={() => {
              setDone(true);
              window.setTimeout(() => router.refresh(), 2500);
            }}
          />
        </>
      )}
    </section>
  );
}
