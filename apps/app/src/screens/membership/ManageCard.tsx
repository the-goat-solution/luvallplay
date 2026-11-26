// Your membership, managed in the app as on the website: status, days left,
// renewal, a pending change, the card on file (update it in Stripe's page),
// upgrade, change day, renew or turn on auto-renew (Stripe), downgrade or
// turn off (the leave flow), resume, and receipts.
import { useState } from "react";
import { openOutside } from "../../lib/native/open.ts";
import type { AppKey } from "@luvallplay/i18n/app";
import { CardPayment } from "../../components/CardPayment.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { dayLabel, money } from "../../lib/format.ts";
import { daysName, planName, usePlace } from "../me/parts.tsx";
import { LeaveFlow } from "./LeaveFlow.tsx";
import { useBilling, useMembershipAction, usePortal, useRefreshSoon, type Member, type MembershipState, type Plan } from "./data.ts";
import { Icon } from "../../components/Icon.tsx";

const ERR: Record<string, AppKey> = { day_paused: "mem_err_day_paused", sessions_full: "mem_err_sessions_full", already_renewed: "mem_err_already_renewed" };
const STATUS = { active: "mem_status_active", ending: "mem_status_ending", upcoming: "mem_status_upcoming", past_due: "mem_status_past_due" } as const;
type Sheet = null | "upgrade" | "day" | "renew" | "autorenew" | "cancel" | "downgrade";

export function ManageCard({ m, state, cardUpdated }: { m: Member; state: MembershipState; cardUpdated: boolean }) {
  const { t, locale, currency } = usePlace();
  const billing = useBilling(true);
  const action = useMembershipAction();
  const portal = usePortal();
  const refreshSoon = useRefreshSoon();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(cardUpdated ? { ok: true, text: t("mem_card_updated") } : null);
  const [renewPlan, setRenewPlan] = useState<Plan>(m.plan);
  const [payment, setPayment] = useState<{ clientSecret: string; label: string; mode: "payment" | "setup"; periodStart?: string } | null>(null);
  const b = billing.data;
  const otherDay = state.days.find((d) => d !== m.day) ?? null;
  const renewsOn = b?.nextCharge?.date ?? m.periodEnd;
  const date = (d: string | null | undefined, year = false) => dayLabel(d ?? null, locale, year);
  const price = (p: Plan) => money(state.prices[p], currency);

  const run = (body: Parameters<typeof action.mutate>[0], ok: (r: Record<string, unknown>) => string) =>
    action.mutate(body, {
      onSuccess: (r) => {
        setMessage({ ok: true, text: ok(r) });
        setSheet(null);
        void billing.refetch();
      },
      onError: (e) => {
        setMessage({ ok: false, text: t(ERR[(e as { code?: string }).code ?? ""] ?? "mem_err_generic") });
        setSheet(null);
      },
    });
  const startRenew = () =>
    action.mutate(sheet === "renew" ? { action: "renew", plan: renewPlan } : { action: "autorenew_setup" }, {
      onSuccess: (r) =>
        r.clientSecret &&
        setPayment(
          sheet === "renew"
            ? { clientSecret: r.clientSecret, label: t("mem_pay", { amount: price(renewPlan) }), mode: "payment", periodStart: r.periodStart }
            : { clientSecret: r.clientSecret, label: t("mem_autorenew_save"), mode: "setup" },
        ),
      onError: (e) => {
        setMessage({ ok: false, text: t(ERR[(e as { code?: string }).code ?? ""] ?? "mem_err_generic") });
        setSheet(null);
      },
    });
  const paid = (intentId: string | undefined) => {
    const p = payment;
    setPayment(null);
    if (p?.mode === "setup" && intentId) {
      run({ action: "autorenew_confirm", plan: renewPlan, setupIntentId: intentId }, (r) => t("mem_autorenew_done", { date: date(r.periodStart as string, true) }));
    } else {
      setMessage({ ok: true, text: t("mem_renewed", { date: date(p?.periodStart, true) }) });
      setSheet(null);
      refreshSoon(1500);
    }
  };
  const openPortal = () =>
    portal.mutate(undefined, {
      onSuccess: (r) => openOutside(r.url),
      onError: () => setMessage({ ok: false, text: t("mem_err_generic") }),
    });
  const close = () => {
    setSheet(null);
    setPayment(null);
  };

  return (
    <section className="card stack membership" aria-labelledby="mem-title">
      <div className="card-head">
        <div className="stack-tight">
          <h2 className="title" id="mem-title">{t("mem_plan_line", { plan: planName(t, m.plan), day: daysName(t, m.day) })}</h2>
          <p className="muted small">
            {m.recurring ? t("mem_auto_renews") : t("mem_one_time")}
            {m.method === "cash" ? ` · ${t("mem_cash")}` : m.method === "bank_transfer" ? ` · ${t("mem_bank_transfer")}` : ""}
          </p>
        </div>
        <span className={`status status-${m.status}`}>{t(STATUS[m.status])}</span>
      </div>
      {message && <p className={`notice${message.ok ? "" : " notice-error"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      <dl className="stats">
        <div className="stat"><dt>{t("mem_days_left")}</dt><dd className="stat-value">{m.daysLeft}</dd></div>
        <div className="stat">
          <dt>{m.recurring && !m.cancelAtPeriodEnd ? t("mem_auto_renews") : t("mem_period", { start: date(m.periodStart), end: date(m.periodEnd) })}</dt>
          <dd className="stat-when">
            {m.status === "upcoming" ? t("mem_starts_on", { date: date(m.periodStart) }) : m.recurring && !m.cancelAtPeriodEnd ? t("mem_renews_on", { date: date(renewsOn) }) : t("mem_ends_on", { date: date(m.periodEnd) })}
          </dd>
        </div>
      </dl>
      {m.cancelAtPeriodEnd && (
        <div className="notice stack-tight">
          <span>{t("mem_ending_note", { date: date(m.periodEnd, true) })}</span>
          <div><button type="button" className="button button-primary" disabled={action.isPending} onClick={() => run({ action: "resume" }, () => t("mem_resumed"))}>{t("mem_resume")}</button></div>
        </div>
      )}
      {m.continuation && <p className="muted small icon-line"><Icon name="check" size={16} />{t("mem_continuation", { plan: planName(t, m.continuation.plan), date: date(m.continuation.periodStart, true) })}</p>}
      {b?.pendingChange && (
        <div className="notice stack-tight">
          <span>{t("mem_pending_change", { plan: planName(t, b.pendingChange.plan), day: daysName(t, b.pendingChange.day), date: date(b.pendingChange.from, true) })}</span>
          <div><button type="button" className="button button-quiet button-small" disabled={action.isPending} onClick={() => run({ action: "cancel_change" }, () => t("saved"))}>{t("mem_cancel_change")}</button></div>
        </div>
      )}
      <div className="row">
        <span className="row-text">
          <strong>{t("mem_card")}</strong>
          <span className="muted small">
            {b?.card ? `${b.card.brand.toUpperCase()} •••• ${b.card.last4} · ${String(b.card.expMonth).padStart(2, "0")}/${String(b.card.expYear).slice(-2)}` : b || billing.isError ? t("mem_card_none") : t("loading")}
          </span>
          {b?.nextCharge && <span className="muted small">{t("mem_next_charge", { amount: money(b.nextCharge.amountCents, currency), date: date(b.nextCharge.date) })}</span>}
        </span>
        {(m.recurring || b?.card) && (
          <button type="button" className="button button-quiet button-small" disabled={portal.isPending} onClick={openPortal}>{portal.isPending ? t("processing") : t("mem_update_card")}</button>
        )}
      </div>
      <div className="stack-tight">
        {m.manageable && m.plan === "monthly" && !b?.pendingChange && (
          <button type="button" className="button button-accent" onClick={() => setSheet("upgrade")}><Icon name="star" size={18} />{t("mem_upgrade")}</button>
        )}
        {m.manageable && otherDay && !state.pausedDays.includes(otherDay) && (
          <button type="button" className="button" onClick={() => setSheet("day")}>{t("mem_change_day")}</button>
        )}
        {!m.recurring && !m.continuation && m.periodEnd && (
          <div className="actions">
            <button type="button" className="button button-primary" onClick={() => setSheet("autorenew")}>{t("mem_autorenew_on")}</button>
            <button type="button" className="button" onClick={() => setSheet("renew")}>{t("mem_renew")}</button>
          </div>
        )}
        {m.manageable && (
          <div className="actions actions-center">
            {m.plan === "quarterly" && !b?.pendingChange && <button type="button" className="button button-quiet button-small" onClick={() => setSheet("downgrade")}>{t("mem_downgrade")}</button>}
            <button type="button" className="button button-quiet button-small" onClick={() => setSheet("cancel")}>{t("mem_turn_off")}</button>
          </div>
        )}
      </div>
      {b && b.receipts.length > 0 && (
        <details className="disclosure">
          <summary>{t("mem_receipts")} ({b.receipts.length})</summary>
          <ul className="rows">
            {b.receipts.map((r, i) => (
              <li key={i} className="row">
                <span className="row-text">
                  <strong>{r.description}</strong>
                  <span className="muted small">{date(r.date, true)} · {money(r.amountCents, currency)}{r.refunded ? ` · ${t("mem_refunded")}` : ""}</span>
                </span>
                {r.url && <a className="button button-quiet button-small" href={r.url} target="_blank" rel="noopener noreferrer">{t("mem_receipt")}<Icon name="external" size={16} /></a>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {sheet === "upgrade" && (
        <Dialog label={t("mem_upgrade_title")} onClose={close}>
          <h2>{t("mem_upgrade_title")}</h2>
          <p className="muted">{t("mem_upgrade_body", { q: price("quarterly"), m: price("monthly"), save: money(state.prices.monthly * 3 - state.prices.quarterly, currency), date: date(renewsOn, true) })}</p>
          <div className="actions">
            <button type="button" className="button button-primary" disabled={action.isPending} onClick={() => run({ action: "change", plan: "quarterly", day: m.day }, (r) => t("mem_upgraded", { date: date((r.from as string) ?? renewsOn, true) }))}>
              {t("mem_upgrade_confirm", { date: date(renewsOn) })}
            </button>
            <button type="button" className="button button-quiet" onClick={close}>{t("cancel")}</button>
          </div>
        </Dialog>
      )}
      {sheet === "day" && otherDay && (
        <Dialog label={t("mem_change_day_title")} onClose={close}>
          <h2>{t("mem_change_day_title")}</h2>
          <p className="muted">{t("mem_change_day_body", { day: daysName(t, otherDay), date: date(renewsOn, true) })}</p>
          <div className="actions">
            <button type="button" className="button button-primary" disabled={action.isPending} onClick={() => run({ action: "change", plan: b?.pendingChange?.plan ?? m.plan, day: otherDay }, (r) => t("mem_day_changed", { day: daysName(t, otherDay), date: date((r.from as string) ?? renewsOn, true) }))}>
              {t("mem_change_day_confirm", { day: daysName(t, otherDay) })}
            </button>
            <button type="button" className="button button-quiet" onClick={close}>{t("cancel")}</button>
          </div>
        </Dialog>
      )}
      {(sheet === "renew" || sheet === "autorenew") && (
        <Dialog label={sheet === "renew" ? t("mem_renew_title") : t("mem_autorenew_title")} onClose={close}>
          <h2>{sheet === "renew" ? t("mem_renew_title") : t("mem_autorenew_title")}</h2>
          {!payment ? (
            <>
              <p className="muted">{sheet === "renew" ? t("mem_renew_body", { date: date(m.periodEnd, true) }) : t("mem_autorenew_body", { date: date(m.periodEnd, true) })}</p>
              <fieldset className="stack-tight">
                {(["monthly", "quarterly"] as const).map((p) => (
                  <label key={p} className="choice choice-card">
                    <input type="radio" name="renew-plan" checked={renewPlan === p} onChange={() => setRenewPlan(p)} />
                    <span className="row-text">
                      <strong>{planName(t, p)}</strong>
                      <span className="muted small">{price(p)} {t(p === "quarterly" ? "mem_per_12w" : "mem_per_4w")}</span>
                    </span>
                    {p === "quarterly" && <span className="tag">{t("mem_best_value")}</span>}
                  </label>
                ))}
              </fieldset>
              <div className="actions">
                <button type="button" className="button button-primary" disabled={action.isPending} onClick={startRenew}>{action.isPending ? t("processing") : t("mem_continue_to_pay")}</button>
                <button type="button" className="button button-quiet" onClick={close}>{t("cancel")}</button>
              </div>
            </>
          ) : (
            <CardPayment clientSecret={payment.clientSecret} label={payment.label} mode={payment.mode} returnPath="/membership" onDone={paid} />
          )}
        </Dialog>
      )}
      {(sheet === "cancel" || sheet === "downgrade") && (
        <LeaveFlow kind={sheet} m={m} state={state} renewsOn={renewsOn} onClose={() => setSheet(null)} onChangeDay={() => setSheet("day")} />
      )}
    </section>
  );
}
