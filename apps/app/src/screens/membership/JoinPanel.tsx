// No membership yet: the day, the plan, how to pay (renews or once), then
// Stripe. Details come from the account, so it's plan → pay, as on the website.
import { useState } from "react";
import { CardPayment } from "../../components/CardPayment.tsx";
import { dayLabel, money } from "../../lib/format.ts";
import { daysName, planName, usePlace } from "../me/parts.tsx";
import { useJoin, useRefreshSoon, type Day, type MembershipState, type Plan } from "./data.ts";

const JOIN_ERR = { sessions_full: "mem_full", already_member: "mem_already_member", day_paused: "mem_err_day_paused" } as const;

export function JoinPanel({ state }: { state: MembershipState }) {
  const { t, locale, currency } = usePlace();
  const join = useJoin();
  const refreshSoon = useRefreshSoon();
  const open = state.days.filter((d) => !state.pausedDays.includes(d));
  const [day, setDay] = useState<Day>(open[0] ?? state.days[0] ?? "friday");
  const [plan, setPlan] = useState<Plan>("quarterly");
  const [recurring, setRecurring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ clientSecret: string; periodStart: string | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const price = money(plan === "quarterly" ? state.prices.quarterly : state.prices.monthly, currency);
  const paused = state.pausedDays.includes(day);

  if (done !== null) {
    return (
      <section className="card stack join">
        <p className="notice" role="status">{done ? t("mem_joined", { date: dayLabel(done, locale, true) }) : t("mem_joined_soon")}</p>
      </section>
    );
  }
  const start = () => {
    setError(null);
    join.mutate(
      { plan, day, recurring },
      {
        onSuccess: (r) => setPayment(r),
        onError: (e) => setError(t(JOIN_ERR[(e as { code?: string }).code as keyof typeof JOIN_ERR] ?? "mem_err_generic")),
      },
    );
  };
  return (
    <section className="card stack join" aria-labelledby="join-title">
      <div className="stack-tight">
        <h2 className="title" id="join-title">{t("mem_join_title")}</h2>
        <p className="muted small">{t("mem_join_sub")}</p>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {!payment ? (
        <>
          {state.days.length > 1 && (
            <div className="segmented" role="radiogroup" aria-label={t("mem_day")}>
              {state.days.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={day === d} onClick={() => setDay(d)}>
                  {daysName(t, d)}
                </button>
              ))}
            </div>
          )}
          {paused ? (
            <p className="notice">{t("mem_paused_day", { day: daysName(t, day) })}</p>
          ) : (
            <>
              <div className="plans">
                {(["monthly", "quarterly"] as const).map((p) => (
                  <button key={p} type="button" className={`plan plan-choice${p === "quarterly" ? " plan-best" : ""}`} aria-pressed={plan === p} onClick={() => setPlan(p)}>
                    {p === "quarterly" && <span className="tag">{t("mem_best_value")}</span>}
                    <span className="plan-name">{planName(t, p)}</span>
                    <span className="plan-price">{money(p === "quarterly" ? state.prices.quarterly : state.prices.monthly, currency)}</span>
                    <span className="muted small">{t(p === "quarterly" ? "mem_per_12w" : "mem_per_4w")}</span>
                  </button>
                ))}
              </div>
              <fieldset className="stack-tight">
                <legend className="label">{t("mem_billing")}</legend>
                {[true, false].map((r) => (
                  <label key={String(r)} className="choice choice-card">
                    <input type="radio" name="join-billing" checked={recurring === r} onChange={() => setRecurring(r)} />
                    <span className="row-text">
                      <strong>{t(r ? "mem_billing_auto" : "mem_billing_once")}</strong>
                      <span className="muted small">{t(r ? "mem_billing_auto_d" : "mem_billing_once_d")}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div>
                <button type="button" className="button button-primary" disabled={join.isPending} onClick={start}>
                  {join.isPending ? t("processing") : `${t("mem_continue_to_pay")} · ${price}`}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            {t("mem_plan_line", { plan: planName(t, plan), day: daysName(t, day) })}
            {payment.periodStart ? ` · ${t("mem_starts_on", { date: dayLabel(payment.periodStart, locale) })}` : ""}
          </p>
          <CardPayment
            clientSecret={payment.clientSecret}
            label={t("mem_pay", { amount: price })}
            returnPath="/membership"
            onDone={() => {
              setDone(payment.periodStart ?? "");
              refreshSoon();
            }}
          />
        </>
      )}
    </section>
  );
}
