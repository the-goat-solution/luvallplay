"use client";

import { useState } from "react";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { useLanguage } from "@/context/LanguageContext";
import {
  MONTHLY_PRICE_CENTS,
  QUARTERLY_PRICE_CENTS,
  type MembershipDay,
  type MembershipTier,
} from "@/lib/constants";
import { formatDateLong } from "@/lib/dates";

const DAY_LABEL: Record<MembershipDay, string> = {
  friday: "Friday",
  wednesday: "Wednesday",
};

const PLANS: { tier: MembershipTier; name: string; desc: string; cents: number }[] = [
  { tier: "monthly", name: "Monthly", desc: "4 weeks of sessions", cents: MONTHLY_PRICE_CENTS },
  { tier: "quarterly", name: "Quarterly", desc: "12 weeks — save ~15%", cents: QUARTERLY_PRICE_CENTS },
];

const ERRORS: Record<string, string> = {
  already_renewed:
    "There's already a membership (or a renewal waiting on payment) for this day. If you just started a renewal and didn't finish paying, try again in 30 minutes.",
  sessions_full:
    "There isn't an upcoming session with room right after your current membership. Please contact us and we'll sort it out.",
};

function formatKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return formatDateLong(new Date(y, m - 1, d), "en");
}

export function RenewMembershipForm({
  token,
  firstName,
  day,
  currentPlan,
  currentEndLabel,
}: {
  token: string;
  firstName: string;
  day: MembershipDay;
  currentPlan: MembershipTier;
  currentEndLabel: string;
}) {
  const { tr } = useLanguage();
  const [plan, setPlan] = useState<MembershipTier>(currentPlan);
  const [submitting, setSubmitting] = useState(false);
  const showSubmitting = useDelayedLoading(submitting);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{
    clientSecret: string;
    periodStart: string;
    periodEnd: string;
    priceNzd: number;
  } | null>(null);
  const [done, setDone] = useState(false);

  const dayLabel = DAY_LABEL[day];

  const start = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/renew-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, plan }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code = typeof data?.error === "string" ? data.error : "";
        setError(ERRORS[code] ?? (code || "Something went wrong. Please try again."));
        return;
      }
      setPayment(data);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done && payment) {
    return (
      <div className="success-screen">
        <div className="success-icon">🏸</div>
        <h3 className="success-title">Membership renewed!</h3>
        <p className="success-body">
          Thanks, {firstName}. Your {dayLabel} membership now runs from{" "}
          <strong>{formatKey(payment.periodStart)}</strong> to{" "}
          <strong>{formatKey(payment.periodEnd)}</strong>. A confirmation email is on its way.
        </p>
      </div>
    );
  }

  if (payment) {
    return (
      <div>
        <p style={{ fontSize: 14, color: "var(--text-mid)", lineHeight: 1.7, marginBottom: 18 }}>
          Your renewed {dayLabel} membership will run from{" "}
          <strong>{formatKey(payment.periodStart)}</strong> to{" "}
          <strong>{formatKey(payment.periodEnd)}</strong>.
        </p>
        <div className="order-summary">
          <div className="order-total">
            <span>Total</span>
            <span>NZD ${payment.priceNzd.toFixed(2)}</span>
          </div>
        </div>
        <StripeCardForm
          clientSecret={payment.clientSecret}
          amountLabel={`${tr("pay_btn_pre")}${payment.priceNzd.toFixed(2)}`}
          onSuccess={() => setDone(true)}
        />
        <div className="stripe-badge">Secured by Stripe</div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--text-mid)", lineHeight: 1.7, marginBottom: 18, textAlign: "center" }}>
        Hi {firstName} — your {dayLabel} membership ends on{" "}
        <strong>{currentEndLabel}</strong>. Renew now and your next membership
        starts straight after it.
      </p>
      <div className="plan-pick">
        {PLANS.map((p) => (
          <div
            key={p.tier}
            className={`plan-opt${plan === p.tier ? " sel" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setPlan(p.tier)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setPlan(p.tier);
            }}
          >
            <div className="plan-radio">
              <div className="plan-dot" />
            </div>
            <div className="plan-opt-info">
              <div className="plan-opt-name">
                {p.name} ({dayLabel})
              </div>
              <div className="plan-opt-desc">{p.desc}</div>
            </div>
            <div className="plan-opt-price">${p.cents / 100}</div>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" style={{ color: "#b00020", fontSize: 13, marginBottom: 14 }}>
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-navy btn-full"
        disabled={submitting}
        onClick={start}
      >
        {showSubmitting ? (
          <>
            <LoadingIcon size="sm" />
            {tr("processing")}
          </>
        ) : (
          "Continue to payment"
        )}
      </button>
      <p className="form-hint" style={{ textAlign: "center", marginTop: 10 }}>
        One-time payment — nothing renews automatically.
      </p>
    </div>
  );
}
