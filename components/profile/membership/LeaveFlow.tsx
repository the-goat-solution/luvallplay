"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import { Sheet } from "../Sheet";
import styles from "../profile.module.css";
import { fmtDate, postJson } from "./format";

const REASONS: { value: string; key: ProfileKey }[] = [
  { value: "price", key: "leave_reason_price" },
  { value: "time", key: "leave_reason_time" },
  { value: "moving", key: "leave_reason_moving" },
  { value: "injury", key: "leave_reason_injury" },
  { value: "level", key: "leave_reason_level" },
  { value: "other", key: "leave_reason_other" },
];

/**
 * Downgrading (Quarterly → Monthly) or turning off auto-renew takes a few
 * deliberate steps, but stays honest and clear: what you'd give up (with
 * "Keep my membership" as the main action), alternatives, a reason, then a
 * plain final confirmation. No discount offer, by decision.
 */
export function LeaveFlow({
  open,
  onClose,
  kind,
  day,
  plan,
  periodEnd,
  renewsOn,
  daysLeft,
  streak,
  monthRank,
  prices,
  onChangeDay,
}: {
  open: boolean;
  onClose: () => void;
  kind: "cancel" | "downgrade";
  day: "friday" | "wednesday";
  plan: "monthly" | "quarterly";
  periodEnd: string | null;
  /** When a downgrade takes effect (next renewal). */
  renewsOn: string | null;
  daysLeft: number;
  streak: number;
  monthRank: number | null;
  prices: { monthly: number; quarterly: number };
  onChangeDay: () => void;
}) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const total = 4;

  const reset = () => {
    setStep(1);
    setReason("");
    setComment("");
    setError(null);
    setDone(null);
  };
  const close = () => {
    reset();
    onClose();
    if (done) router.refresh();
  };

  const effective = kind === "cancel" ? periodEnd : renewsOn ?? periodEnd;
  const quarterlySaving = prices.monthly * 3 - prices.quarterly;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const reasonLabel = REASONS.find((r) => r.value === reason)?.value ?? reason;
    const res =
      kind === "cancel"
        ? await postJson("/api/profile/membership/action", { action: "cancel", reason: reasonLabel, comment: comment || undefined })
        : await postJson("/api/profile/membership/action", { action: "change", plan: "monthly", day, reason: reasonLabel, comment: comment || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(tr("mem_err_generic"));
      return;
    }
    const date = fmtDate((res.data.endsOn as string) ?? (res.data.from as string) ?? effective, lang, true);
    setDone(kind === "cancel" ? tr("leave_done_cancel", { date }) : tr("leave_done_downgrade", { date }));
  };

  const title = kind === "cancel" ? tr("leave_title_cancel") : tr("leave_title_downgrade");

  return (
    <Sheet open={open} onClose={close} title={title}>
      {done ? (
        <>
          <div className={styles.success}>{done}</div>
          <button type="button" className={`${styles.btn} ${styles.navy} ${styles.btnBlock}`} onClick={close}>
            {tr("close")}
          </button>
        </>
      ) : (
        <>
          <p className={styles.small} style={{ marginBottom: 12 }}>
            {tr("leave_step", { n: step, total })}
          </p>
          {error && <div className={styles.error}>{error}</div>}

          {step === 1 && (
            <>
              <h3 style={{ margin: "0 0 12px", fontSize: 17, color: "var(--navy)" }}>{tr("leave_miss_title")}</h3>
              <ul style={{ margin: "0 0 18px", paddingLeft: 20, lineHeight: 1.8, fontSize: 15 }}>
                {daysLeft > 0 && <li>{tr("leave_miss_days", { n: daysLeft })}</li>}
                <li>
                  {tr("leave_miss_price", {
                    plan: tr(plan === "quarterly" ? "mem_quarterly" : "mem_monthly"),
                    price: plan === "quarterly" ? prices.quarterly : prices.monthly,
                  })}
                </li>
                {plan === "quarterly" && <li>{tr("leave_miss_quarterly_saving", { save: quarterlySaving })}</li>}
                {streak > 1 && <li>{tr("leave_miss_streak", { n: streak })}</li>}
                {monthRank && monthRank <= 20 && <li>{tr("leave_miss_rank", { rank: monthRank })}</li>}
              </ul>
              <div className="stack" style={{ display: "grid", gap: 10 }}>
                <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} onClick={close}>
                  {tr("leave_keep")}
                </button>
                <button type="button" className={`${styles.btn} ${styles.ghost} ${styles.btnBlock}`} onClick={() => setStep(2)}>
                  {tr("leave_continue")}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h3 style={{ margin: "0 0 12px", fontSize: 17, color: "var(--navy)" }}>{tr("leave_alt_title")}</h3>
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`}
                  onClick={() => {
                    close();
                    onChangeDay();
                  }}
                >
                  {tr("leave_alt_day")}
                </button>
                <a className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`} href="/profile/account">
                  {tr("leave_alt_message_btn")}
                </a>
                <p className={styles.small}>{tr("leave_alt_message")}</p>
              </div>
              <button type="button" className={`${styles.btn} ${styles.ghost} ${styles.btnBlock}`} onClick={() => setStep(3)}>
                {tr("leave_alt_still")}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h3 style={{ margin: "0 0 4px", fontSize: 17, color: "var(--navy)" }}>{tr("leave_reason_title")}</h3>
              <p className={styles.small} style={{ marginBottom: 12 }}>
                {tr("leave_reason_sub")}
              </p>
              <div role="radiogroup" aria-label={tr("leave_reason_title")} style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                {REASONS.map((r) => (
                  <label
                    key={r.value}
                    className={styles.row}
                    style={{
                      background: "#fff",
                      borderRadius: 12,
                      padding: "0 14px",
                      border: `1.5px solid ${reason === r.value ? "var(--bronze)" : "transparent"}`,
                      cursor: "pointer",
                    }}
                  >
                    <input type="radio" name="leave-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} style={{ width: 20, height: 20 }} />
                    <span className={styles.rowText}>{tr(r.key)}</span>
                  </label>
                ))}
              </div>
              <div className={styles.field}>
                <label htmlFor="leave-comment">{tr("leave_comment")}</label>
                <textarea id="leave-comment" className={styles.textarea} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              <div className={styles.btnRow}>
                <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={close}>
                  {tr("leave_keep")}
                </button>
                <button type="button" className={`${styles.btn} ${styles.navy}`} disabled={!reason} onClick={() => setStep(4)}>
                  {tr("leave_continue")}
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h3 style={{ margin: "0 0 12px", fontSize: 17, color: "var(--navy)" }}>{tr("leave_confirm_title")}</h3>
              <div className={styles.notice}>
                {kind === "cancel"
                  ? tr("leave_confirm_cancel", { date: fmtDate(effective, lang, true) })
                  : tr("leave_confirm_downgrade", { date: fmtDate(effective, lang, true), price: prices.monthly })}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} onClick={close}>
                  {tr("leave_keep")}
                </button>
                <button type="button" className={`${styles.btn} ${styles.danger} ${styles.btnBlock}`} onClick={confirm} disabled={busy}>
                  {busy ? "…" : kind === "cancel" ? tr("leave_confirm_btn_cancel") : tr("leave_confirm_btn_downgrade")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
