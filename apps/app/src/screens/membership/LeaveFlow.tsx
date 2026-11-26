// Downgrading (Quarterly → Monthly) or turning off auto-renew, as on the
// website: what you'd give up ("Keep my membership" first), alternatives, a
// reason, then a plain confirmation. No discount offer, by decision.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { AppKey } from "@luvallplay/i18n/app";
import { Dialog } from "../../components/Dialog.tsx";
import { dayLabel, money } from "../../lib/format.ts";
import { planName, usePlace } from "../me/parts.tsx";
import { useMembershipAction, type Member, type MembershipState } from "./data.ts";

const REASONS: [string, AppKey][] = [
  ["price", "leave_reason_price"],
  ["time", "leave_reason_time"],
  ["moving", "leave_reason_moving"],
  ["injury", "leave_reason_injury"],
  ["level", "leave_reason_level"],
  ["other", "leave_reason_other"],
];

export function LeaveFlow({ kind, m, state, renewsOn, onClose, onChangeDay }: { kind: "cancel" | "downgrade"; m: Member; state: MembershipState; renewsOn: string | null; onClose: () => void; onChangeDay: () => void }) {
  const { t, locale, currency } = usePlace();
  const action = useMembershipAction();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const price = (p: "monthly" | "quarterly") => money(state.prices[p], currency);
  const effective = kind === "cancel" ? m.periodEnd : (renewsOn ?? m.periodEnd);
  const saving = money(state.prices.monthly * 3 - state.prices.quarterly, currency);
  const confirm = () =>
    action.mutate(
      kind === "cancel" ? { action: "cancel", reason, comment: comment || undefined } : { action: "change", plan: "monthly", day: m.day, reason, comment: comment || undefined },
      {
        onSuccess: (r) => {
          const date = dayLabel(r.endsOn ?? r.from ?? effective, locale, true);
          setDone(kind === "cancel" ? t("leave_done_cancel", { date }) : t("leave_done_downgrade", { date }));
        },
      },
    );
  const title = kind === "cancel" ? t("leave_title_cancel") : t("leave_title_downgrade");
  return (
    <Dialog label={title} onClose={onClose}>
      <h2>{title}</h2>
      {done ? (
        <>
          <p className="notice" role="status">{done}</p>
          <div><button type="button" className="button button-primary" onClick={onClose}>{t("close")}</button></div>
        </>
      ) : (
        <>
          <p className="muted small">{t("leave_step", { n: step, total: 4 })}</p>
          {action.isError && <p className="notice notice-error" role="alert">{t("mem_err_generic")}</p>}
          {step === 1 && (
            <>
              <strong>{t("leave_miss_title")}</strong>
              <ul className="leave-list">
                {m.daysLeft > 0 && <li>{t("leave_miss_days", { n: m.daysLeft })}</li>}
                <li>{t("leave_miss_price", { plan: planName(t, m.plan), price: price(m.plan) })}</li>
                {m.plan === "quarterly" && <li>{t("leave_miss_quarterly_saving", { save: saving })}</li>}
                {state.streak > 1 && <li>{t("leave_miss_streak", { n: state.streak })}</li>}
                {state.monthRank && state.monthRank <= 20 && <li>{t("leave_miss_rank", { rank: state.monthRank })}</li>}
              </ul>
              <div className="actions">
                <button type="button" className="button button-primary" onClick={onClose}>{t("leave_keep")}</button>
                <button type="button" className="button button-quiet" onClick={() => setStep(2)}>{t("leave_continue")}</button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <strong>{t("leave_alt_title")}</strong>
              <div className="actions">
                <button type="button" className="button" onClick={onChangeDay}>{t("leave_alt_day")}</button>
                <Link to="/inbox/new" className="button">{t("leave_alt_message_btn")}</Link>
              </div>
              <p className="muted small">{t("leave_alt_message")}</p>
              <div><button type="button" className="button button-quiet" onClick={() => setStep(3)}>{t("leave_alt_still")}</button></div>
            </>
          )}
          {step === 3 && (
            <>
              <fieldset className="stack-tight">
                <legend><strong>{t("leave_reason_title")}</strong></legend>
                <p className="muted small">{t("leave_reason_sub")}</p>
                {REASONS.map(([value, key]) => (
                  <label key={value} className="choice choice-card">
                    <input type="radio" name="leave-reason" checked={reason === value} onChange={() => setReason(value)} />
                    <span>{t(key)}</span>
                  </label>
                ))}
              </fieldset>
              <label className="field">
                <span>{t("leave_comment")}</span>
                <textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <div className="actions">
                <button type="button" className="button" onClick={onClose}>{t("leave_keep")}</button>
                <button type="button" className="button button-primary" disabled={!reason} onClick={() => setStep(4)}>{t("leave_continue")}</button>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <strong>{t("leave_confirm_title")}</strong>
              <p className="notice">
                {kind === "cancel"
                  ? t("leave_confirm_cancel", { date: dayLabel(effective, locale, true) })
                  : t("leave_confirm_downgrade", { date: dayLabel(effective, locale, true), price: price("monthly") })}
              </p>
              <div className="actions">
                <button type="button" className="button button-primary" onClick={onClose}>{t("leave_keep")}</button>
                <button type="button" className="button button-danger" disabled={action.isPending} onClick={confirm}>
                  {action.isPending ? t("processing") : kind === "cancel" ? t("leave_confirm_btn_cancel") : t("leave_confirm_btn_downgrade")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
