"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import { StripeCardForm } from "../LazyStripeCardForm";
import type { Billing, MemberView } from "@/lib/membership-self-service";
import { Sheet } from "../Sheet";
import styles from "../profile.module.css";
import { LeaveFlow } from "./LeaveFlow";
import { fmtDate, fmtMoney, postJson } from "./format";

type Prices = { monthly: number; quarterly: number };
type SheetKind = null | "upgrade" | "day" | "renew" | "autorenew" | "cancel" | "downgrade";

const ERR: Record<string, ProfileKey> = {
  day_paused: "mem_err_day_paused",
  sessions_full: "mem_err_sessions_full",
  already_renewed: "mem_err_already_renewed",
};

export function MembershipCard({
  membership: m,
  daysLeft,
  streak,
  monthRank,
  prices,
  pausedDays,
}: {
  membership: MemberView;
  daysLeft: number;
  streak: number;
  monthRank: number | null;
  prices: Prices;
  pausedDays: string[];
}) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [billingFailed, setBillingFailed] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    searchParams.get("card") === "updated" ? { kind: "success", text: tr("mem_card_updated") } : null,
  );
  const [payment, setPayment] = useState<{ clientSecret: string; amountLabel: string; periodStart?: string; mode: "payment" | "setup" } | null>(null);
  const [renewPlan, setRenewPlan] = useState(m.plan);

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/membership/billing", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setBilling((await res.json()) as Billing);
    } catch {
      setBillingFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const planName = (p: "monthly" | "quarterly") => tr(p === "quarterly" ? "mem_quarterly" : "mem_monthly");
  const dayName = (d: "friday" | "wednesday") => tr(d === "friday" ? "mem_friday" : "mem_wednesday");
  const otherDay = m.day === "friday" ? "wednesday" : "friday";
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = Boolean(m.periodStart && m.periodStart > today);
  const renewsOn = billing?.nextCharge?.date ?? (m.periodEnd ? m.periodEnd : null);

  const status: { label: string; bg: string; color: string } = m.status === "past_due"
    ? { label: tr("mem_status_past_due"), bg: "#fdecec", color: "#a12a2a" }
    : m.cancelAtPeriodEnd
      ? { label: tr("mem_status_ending"), bg: "#fff4dc", color: "#7a5310" }
      : upcoming
        ? { label: tr("mem_status_upcoming"), bg: "#eef5fa", color: "var(--navy)" }
        : { label: tr("mem_status_active"), bg: "#e9f6ee", color: "#1d6b3d" };

  const act = async (body: Record<string, unknown>, success: (data: Record<string, unknown>) => string) => {
    setBusy(true);
    setMessage(null);
    const res = await postJson("/api/profile/membership/action", body);
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: tr(ERR[res.data.error as string] ?? "mem_err_generic") });
      setSheet(null);
      return null;
    }
    setMessage({ kind: "success", text: success(res.data) });
    setSheet(null);
    void loadBilling();
    router.refresh();
    return res.data;
  };

  const openPortal = async () => {
    setBusy(true);
    const res = await postJson("/api/profile/membership/portal");
    setBusy(false);
    if (res.ok && typeof res.data.url === "string") window.location.href = res.data.url;
    else setMessage({ kind: "error", text: tr("mem_err_generic") });
  };

  const startRenew = async () => {
    setBusy(true);
    const res = await postJson("/api/profile/membership/action", { action: "renew", plan: renewPlan });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: tr(ERR[res.data.error as string] ?? "mem_err_generic") });
      setSheet(null);
      return;
    }
    setPayment({
      clientSecret: res.data.clientSecret as string,
      amountLabel: tr("mem_pay", { amount: res.data.priceNzd as number }),
      periodStart: res.data.periodStart as string,
      mode: "payment",
    });
  };

  const startAutoRenew = async () => {
    setBusy(true);
    const res = await postJson("/api/profile/membership/action", { action: "autorenew_setup" });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: tr("mem_err_generic") });
      setSheet(null);
      return;
    }
    setPayment({ clientSecret: res.data.clientSecret as string, amountLabel: tr("mem_autorenew_save"), mode: "setup" });
  };

  const onPaid = async (intentId?: string) => {
    if (payment?.mode === "setup" && intentId) {
      await act({ action: "autorenew_confirm", plan: renewPlan, setupIntentId: intentId }, (d) =>
        tr("mem_autorenew_done", { date: fmtDate(d.periodStart as string, lang, true) }),
      );
    } else {
      setMessage({ kind: "success", text: tr("mem_renewed", { date: fmtDate(payment?.periodStart, lang, true) }) });
      setSheet(null);
      window.setTimeout(() => router.refresh(), 1500);
    }
    setPayment(null);
  };

  const closeSheet = () => {
    setSheet(null);
    setPayment(null);
  };

  const saving = prices.monthly * 3 - prices.quarterly;
  const canManage = m.recurring && !m.cancelAtPeriodEnd && Boolean(m.stripeSubscriptionId);

  return (
    <section className={styles.card} aria-labelledby="mem-card-title" style={{ borderTop: "4px solid var(--bronze)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="mem-card-title" style={{ margin: 0, fontFamily: "var(--font-display)", color: "var(--navy)", fontSize: 22 }}>
            {tr("mem_plan_line", { plan: planName(m.plan), day: dayName(m.day) })}
          </h2>
          <p className={styles.small} style={{ marginTop: 4 }}>
            {m.recurring ? tr("mem_auto_renews") : tr("mem_one_time")}
            {m.method === "cash" ? ` · ${tr("mem_cash")}` : ""}
          </p>
        </div>
        <span style={{ background: status.bg, color: status.color, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
          {status.label}
        </span>
      </div>

      {message && <div className={message.kind === "error" ? styles.error : styles.success}>{message.text}</div>}

      <div className={styles.statGrid} style={{ margin: "14px 0", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className={styles.stat} style={{ boxShadow: "none", background: "var(--cream)" }}>
          <div className={styles.statValue}>{daysLeft}</div>
          <div className={styles.statLabel}>{tr("mem_days_left")}</div>
        </div>
        <div className={styles.stat} style={{ boxShadow: "none", background: "var(--cream)" }}>
          <div style={{ fontWeight: 700, color: "var(--navy)", fontSize: 15, lineHeight: 1.4 }}>
            {upcoming
              ? tr("mem_starts_on", { date: fmtDate(m.periodStart, lang) })
              : m.recurring && !m.cancelAtPeriodEnd
                ? tr("mem_renews_on", { date: fmtDate(renewsOn, lang) })
                : tr("mem_ends_on", { date: fmtDate(m.periodEnd, lang) })}
          </div>
          <div className={styles.statLabel}>{m.recurring && !m.cancelAtPeriodEnd ? tr("mem_auto_renews") : tr("mem_period", { start: fmtDate(m.periodStart, lang), end: fmtDate(m.periodEnd, lang) })}</div>
        </div>
      </div>

      {m.cancelAtPeriodEnd && (
        <div className={styles.notice}>
          {tr("mem_ending_note", { date: fmtDate(m.periodEnd, lang, true) })}
          <button
            type="button"
            className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`}
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() => act({ action: "resume" }, () => tr("mem_resumed"))}
          >
            {tr("mem_resume")}
          </button>
        </div>
      )}

      {m.continuation && (
        <p className={styles.small} style={{ marginBottom: 10 }}>
          ✓ {tr("mem_continuation", { plan: planName(m.continuation.plan), date: fmtDate(m.continuation.periodStart, lang, true) })}
        </p>
      )}

      {billing?.pendingChange && (
        <div className={styles.notice}>
          {tr("mem_pending_change", {
            plan: planName(billing.pendingChange.plan),
            day: dayName(billing.pendingChange.day),
            date: fmtDate(billing.pendingChange.from, lang, true),
          })}
          <div>
            <button type="button" className={styles.linkBtn} disabled={busy} onClick={() => act({ action: "cancel_change" }, () => tr("saved"))}>
              {tr("mem_cancel_change")}
            </button>
          </div>
        </div>
      )}

      {/* Billing: card + next charge */}
      <div className={styles.row} style={{ borderTop: "1px solid var(--line)", marginTop: 6 }}>
        <div className={styles.rowText}>
          <strong>{tr("mem_card")}</strong>
          <span className={styles.small}>
            {billing?.card
              ? `${billing.card.brand.toUpperCase()} •••• ${billing.card.last4} · ${String(billing.card.expMonth).padStart(2, "0")}/${String(billing.card.expYear).slice(-2)}`
              : billing || billingFailed
                ? tr("mem_card_none")
                : "…"}
          </span>
          {billing?.nextCharge && (
            <span className={styles.small} style={{ display: "block" }}>
              {tr("mem_next_charge", { amount: fmtMoney(billing.nextCharge.amountCents), date: fmtDate(billing.nextCharge.date, lang) })}
            </span>
          )}
        </div>
        {(m.recurring || billing?.card) && (
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={openPortal} disabled={busy}>
            {tr("mem_update_card")}
          </button>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        {canManage && m.plan === "monthly" && !billing?.pendingChange && (
          <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} onClick={() => setSheet("upgrade")}>
            ★ {tr("mem_upgrade")}
          </button>
        )}
        {canManage && !pausedDays.includes(otherDay) && (
          <button type="button" className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`} onClick={() => setSheet("day")}>
            {tr("mem_change_day")}
          </button>
        )}
        {!m.recurring && !m.continuation && m.periodEnd && (
          <div className={styles.btnRow}>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => setSheet("autorenew")}>
              {tr("mem_autorenew_on")}
            </button>
            <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => setSheet("renew")}>
              {tr("mem_renew")}
            </button>
          </div>
        )}
        {canManage && (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 4, marginTop: 4 }}>
            {m.plan === "quarterly" && !billing?.pendingChange && (
              <button type="button" className={styles.linkBtn} style={{ color: "var(--text-light)" }} onClick={() => setSheet("downgrade")}>
                {tr("mem_downgrade")}
              </button>
            )}
            <button type="button" className={styles.linkBtn} style={{ color: "var(--text-light)" }} onClick={() => setSheet("cancel")}>
              {tr("mem_turn_off")}
            </button>
          </div>
        )}
      </div>

      {/* Receipts */}
      {billing && billing.receipts.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 600, color: "var(--navy)" }}>
            {tr("mem_receipts")} ({billing.receipts.length})
          </summary>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {billing.receipts.map((r, i) => (
              <li key={i} className={styles.row} style={{ borderTop: "1px solid var(--line)" }}>
                <span className={styles.rowText}>
                  <strong style={{ fontSize: 14 }}>{r.description}</strong>
                  <span className={styles.small}>
                    {fmtDate(r.date, lang, true)} · {fmtMoney(r.amountCents)}
                    {r.refunded ? ` · ${tr("mem_refunded")}` : ""}
                  </span>
                </span>
                {r.url && (
                  <a className={`${styles.btn} ${styles.ghost}`} href={r.url} target="_blank" rel="noopener noreferrer">
                    {tr("mem_receipt")} ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Upgrade */}
      <Sheet open={sheet === "upgrade"} onClose={closeSheet} title={tr("mem_upgrade_title")}>
        <p className={styles.muted} style={{ marginBottom: 16 }}>
          {tr("mem_upgrade_body", { q: prices.quarterly, m: prices.monthly, save: saving, date: fmtDate(renewsOn, lang, true) })}
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`}
          disabled={busy}
          onClick={() => act({ action: "change", plan: "quarterly", day: m.day }, (d) => tr("mem_upgraded", { date: fmtDate((d.from as string) ?? renewsOn, lang, true) }))}
        >
          {busy ? "…" : tr("mem_upgrade_confirm", { date: fmtDate(renewsOn, lang) })}
        </button>
      </Sheet>

      {/* Change day */}
      <Sheet open={sheet === "day"} onClose={closeSheet} title={tr("mem_change_day_title")}>
        <p className={styles.muted} style={{ marginBottom: 16 }}>
          {tr("mem_change_day_body", { day: dayName(otherDay), date: fmtDate(renewsOn, lang, true) })}
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.navy} ${styles.btnBlock}`}
          disabled={busy}
          onClick={() =>
            act({ action: "change", plan: billing?.pendingChange?.plan ?? m.plan, day: otherDay }, (d) =>
              tr("mem_day_changed", { day: dayName(otherDay), date: fmtDate((d.from as string) ?? renewsOn, lang, true) }),
            )
          }
        >
          {busy ? "…" : tr("mem_change_day_confirm", { day: dayName(otherDay) })}
        </button>
      </Sheet>

      {/* One-time: renew or turn on auto-renew */}
      <Sheet open={sheet === "renew" || sheet === "autorenew"} onClose={closeSheet} title={sheet === "renew" ? tr("mem_renew_title") : tr("mem_autorenew_title")}>
        {!payment ? (
          <>
            <p className={styles.muted} style={{ marginBottom: 14 }}>
              {sheet === "renew" ? tr("mem_renew_body", { date: fmtDate(m.periodEnd, lang, true) }) : tr("mem_autorenew_body", { date: fmtDate(m.periodEnd, lang, true) })}
            </p>
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {(["monthly", "quarterly"] as const).map((p) => (
                <label
                  key={p}
                  className={styles.row}
                  style={{ background: "#fff", borderRadius: 12, padding: "0 14px", border: `1.5px solid ${renewPlan === p ? "var(--bronze)" : "transparent"}`, cursor: "pointer" }}
                >
                  <input type="radio" name="renew-plan" checked={renewPlan === p} onChange={() => setRenewPlan(p)} style={{ width: 20, height: 20 }} />
                  <span className={styles.rowText}>
                    <strong>{planName(p)}</strong>
                    <span className={styles.small}>
                      ${p === "quarterly" ? prices.quarterly : prices.monthly} {tr(p === "quarterly" ? "mem_per_12w" : "mem_per_4w")}
                    </span>
                  </span>
                  {p === "quarterly" && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--bronze-dark)" }}>{tr("mem_best_value")}</span>
                  )}
                </label>
              ))}
            </div>
            <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy} onClick={sheet === "renew" ? startRenew : startAutoRenew}>
              {busy ? "…" : tr("mem_continue_to_pay")}
            </button>
          </>
        ) : (
          <StripeCardForm clientSecret={payment.clientSecret} amountLabel={payment.amountLabel} onSuccess={onPaid} mode={payment.mode} returnPath="/profile/membership" />
        )}
      </Sheet>

      <LeaveFlow
        open={sheet === "cancel" || sheet === "downgrade"}
        onClose={() => setSheet(null)}
        kind={sheet === "downgrade" ? "downgrade" : "cancel"}
        day={m.day}
        plan={m.plan}
        periodEnd={m.periodEnd}
        renewsOn={renewsOn}
        daysLeft={daysLeft}
        streak={streak}
        monthRank={monthRank}
        prices={prices}
        onChangeDay={() => setSheet("day")}
      />
    </section>
  );
}
