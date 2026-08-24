"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { ModalShell, StepBar } from "@/components/modals/ModalShell";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import { PRICES, type PlanId } from "@/lib/constants";

export function MembershipModal() {
  const { tr } = useLanguage();
  const {
    openModal,
    setOpenModal,
    selectedPlan,
    setSelectedPlan,
    openCasualModal,
  } = useApp();
  const open = openModal === "membership";
  const [step, setStep] = useState(1);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [recurring, setRecurring] = useState(true);

  const close = () => {
    setOpenModal(null);
    setStep(1);
    setClientSecret(null);
    document.body.style.overflow = "";
  };

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setStep(1);
      setRecurring(true);
    }
  }, [open]);

  const planLabels: Record<PlanId, { name: string; period: string }> = {
    casual: { name: tr("p_cas"), period: tr("p_cas_per") },
    monthly: { name: tr("p_mon"), period: tr("p_mon_per") },
    quarterly: { name: tr("p_qtr"), period: tr("p_qtr_per") },
  };

  const createSubscription = async () => {
    const res = await fetch("/api/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: selectedPlan,
        firstName: fn.trim(),
        lastName: ln.trim(),
        email: email.trim(),
        phone: phone.trim(),
        recurring,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Subscription setup failed");
    setClientSecret(data.clientSecret);
    setStep(3);
  };

  const next = async () => {
    if (step === 1 && selectedPlan === "casual") {
      close();
      openCasualModal();
      return;
    }
    if (step === 2) {
      if (!fn.trim() || !ln.trim() || !email.trim()) return;
      if (selectedPlan === "monthly" || selectedPlan === "quarterly") {
        try {
          await createSubscription();
        } catch (e) {
          alert(e instanceof Error ? e.message : "Error");
        }
        return;
      }
    }
    if (step < 3) setStep(step + 1);
  };

  const back = () => {
    if (step > 1) setStep(step - 1);
  };

  const price = PRICES[selectedPlan] ?? PRICES.monthly;
  const { name, period } = planLabels[selectedPlan] ?? planLabels.monthly;

  return (
    <ModalShell
      id="membership-modal"
      open={open}
      onClose={close}
      title={<Trans k="modal_join" />}
      footer={
        step < 4 ? (
          <>
            {step > 1 && (
              <button type="button" className="btn btn-bronze-outline" onClick={back}>
                <Trans k="btn_back" />
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                className="btn btn-navy"
                style={{ flex: 1 }}
                onClick={next}
              >
                <Trans k="btn_continue" />
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <StepBar step={step} />
      {step === 1 && (
        <div>
          <h4
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 19,
              color: "var(--navy)",
              fontWeight: 700,
              marginBottom: 5,
            }}
          >
            <Trans k="step_plan" />
          </h4>
          <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 18 }}>
            Choose the membership that works best for you.
          </p>
          <div className="plan-pick">
            {(["casual", "monthly", "quarterly"] as PlanId[]).map((plan) => (
              <div
                key={plan}
                className={`plan-opt${selectedPlan === plan ? " sel" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedPlan(plan)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    setSelectedPlan(plan);
                }}
              >
                <div className="plan-radio">
                  <div className="plan-dot" />
                </div>
                <div className="plan-opt-info">
                  <div className="plan-opt-name">
                    <Trans k={plan === "casual" ? "p_cas" : plan === "monthly" ? "p_mon" : "p_qtr"} />
                  </div>
                  <div className="plan-opt-desc">
                    {plan === "casual"
                      ? "Pay per session"
                      : plan === "monthly"
                        ? tr("f_cancel")
                        : tr("p_qtr_d")}
                  </div>
                </div>
                <div className="plan-opt-price">
                  {plan === "casual"
                    ? "$10"
                    : plan === "monthly"
                      ? "$33/mo"
                      : "$85/3mo"}
                </div>
              </div>
            ))}
          </div>
          {(selectedPlan === "monthly" || selectedPlan === "quarterly") && (
            <div>
              <h4
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 15,
                  color: "var(--navy)",
                  fontWeight: 700,
                  marginBottom: 10,
                }}
              >
                <Trans k="mem_billing" />
              </h4>
              <div className="plan-pick">
                {[true, false].map((isRecurring) => (
                  <div
                    key={String(isRecurring)}
                    className={`plan-opt${recurring === isRecurring ? " sel" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setRecurring(isRecurring)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setRecurring(isRecurring);
                    }}
                  >
                    <div className="plan-radio">
                      <div className="plan-dot" />
                    </div>
                    <div className="plan-opt-info">
                      <div className="plan-opt-name">
                        <Trans k={isRecurring ? "mem_recurring" : "mem_onetime"} />
                      </div>
                      <div className="plan-opt-desc">
                        <Trans k={isRecurring ? "mem_recurring_d" : "mem_onetime_d"} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {step === 2 && (
        <div>
          <h4
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 19,
              color: "var(--navy)",
              fontWeight: 700,
              marginBottom: 5,
            }}
          >
            <Trans k="step_details" />
          </h4>
          <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 18 }}>
            We&apos;ll send your membership confirmation to your email.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                <Trans k="form_fn" />
              </label>
              <input
                className="form-input"
                value={fn}
                onChange={(e) => setFn(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                <Trans k="form_ln" />
              </label>
              <input
                className="form-input"
                value={ln}
                onChange={(e) => setLn(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">
              <Trans k="form_email" />
            </label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              <Trans k="form_phone" />
            </label>
            <input
              type="tel"
              className="form-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
      )}
      {step === 3 && (
        <div>
          <h4
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 19,
              color: "var(--navy)",
              fontWeight: 700,
              marginBottom: 5,
            }}
          >
            <Trans k="step_payment" />
          </h4>
          <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 18 }}>
            Your membership activates immediately after payment.
          </p>
          <div className="order-summary">
            <div className="order-line">
              <span>
                {name} Membership
              </span>
              <span>
                NZD ${price}
                {selectedPlan !== "casual" && !recurring
                  ? ` / ${tr("mem_onetime")}`
                  : ` / ${period}`}
              </span>
            </div>
          </div>
          <StripeCardForm
            clientSecret={clientSecret}
            amountLabel={`${tr("pay_btn_pre")}${price}.00`}
            onSuccess={() => setStep(4)}
          />
          <div className="stripe-badge">
            Secured by Stripe
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="success-screen">
          <div className="success-icon">🏸</div>
          <h3 className="success-title">
            <Trans k="confirm_join" />
          </h3>
          <p className="success-body">
            <Trans k="confirm_join_body" />
          </p>
          <div className="success-detail">
            <strong>
              <Trans k="session_details" />
            </strong>
            <br />
            📅 Every Friday, 6:00 PM – 7:30 PM
            <br />
            📍 Graham Condon Recreation and Sport Centre
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;3 Sisson Drive, Papanui, Christchurch 8053
          </div>
        </div>
      )}
    </ModalShell>
  );
}
