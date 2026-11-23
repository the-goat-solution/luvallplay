"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { ModalShell, StepBar } from "@/components/modals/ModalShell";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import {
  DONATION_MIN_CENTS,
  DONATION_MAX_CENTS,
  type DonationFrequency,
} from "@/lib/constants";

export function DonateModal() {
  const { tr } = useLanguage();
  const { openModal, setOpenModal } = useApp();
  const open = openModal === "donate";
  const [step, setStep] = useState(1);
  const [frequency, setFrequency] = useState<DonationFrequency>("once");
  const [amount, setAmount] = useState("25");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const showSubmitting = useDelayedLoading(submitting);

  const close = () => {
    setOpenModal(null);
    setStep(1);
    setClientSecret(null);
    setSubmitting(false);
    document.body.style.overflow = "";
  };

  // Each time the modal opens it starts again at step 1.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setStep(1);
  }

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
  }, [open]);

  const parsedAmount = Number(amount);
  const amountCents = Math.round(parsedAmount * 100);

  const validateAmount = () => {
    if (
      !Number.isFinite(parsedAmount) ||
      amountCents < DONATION_MIN_CENTS ||
      amountCents > DONATION_MAX_CENTS
    ) {
      setAmountError(tr("donate_amt_error"));
      return false;
    }
    setAmountError(null);
    return true;
  };

  const createDonation = async () => {
    const endpoint =
      frequency === "monthly"
        ? "/api/create-donation-subscription"
        : "/api/create-donation-intent";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: parsedAmount,
        firstName: fn.trim(),
        lastName: ln.trim(),
        email: email.trim(),
        phone: phone.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start donation");
    setClientSecret(data.clientSecret);
    setStep(3);
  };

  const next = async () => {
    if (step === 1) {
      if (!validateAmount()) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!fn.trim() || !ln.trim() || !email.trim()) return;
      setSubmitting(true);
      try {
        await createDonation();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Error");
      } finally {
        setSubmitting(false);
      }
      return;
    }
  };

  const back = () => {
    if (step > 1) setStep(step - 1);
  };

  const amountLabel = `${tr("donate_pay_btn_pre")}${amount}${
    frequency === "monthly" ? tr("donate_per_month_suffix") : ""
  }`;

  return (
    <ModalShell
      id="donate-modal"
      open={open}
      onClose={close}
      title={<Trans k="modal_donate" />}
      footer={
        step < 4 ? (
          <>
            {step > 1 && (
              <button
                type="button"
                className="btn btn-bronze-outline"
                onClick={back}
                disabled={submitting}
              >
                <Trans k="btn_back" />
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                className="btn btn-navy"
                style={{ flex: 1 }}
                onClick={next}
                disabled={submitting}
              >
                {showSubmitting ? (
                  <>
                    <LoadingIcon size="sm" />
                    <Trans k="processing" />
                  </>
                ) : (
                  <Trans k="btn_continue" />
                )}
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <StepBar step={step} total={4} />
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
            <Trans k="step_amount" />
          </h4>
          <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 18 }}>
            <Trans k="donate_amt_hint" />
          </p>
          <div className="plan-pick">
            {(["once", "monthly"] as DonationFrequency[]).map((f) => (
              <div
                key={f}
                className={`plan-opt${frequency === f ? " sel" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setFrequency(f)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setFrequency(f);
                }}
              >
                <div className="plan-radio">
                  <div className="plan-dot" />
                </div>
                <div className="plan-opt-info">
                  <div className="plan-opt-name">
                    <Trans k={f === "once" ? "donate_freq_once" : "donate_freq_monthly"} />
                  </div>
                  <div className="plan-opt-desc">
                    <Trans k={f === "once" ? "donate_freq_once_d" : "donate_freq_monthly_d"} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="form-group">
            <label className="form-label">
              <Trans k="donate_amt_lbl" />
            </label>
            <input
              type="number"
              min={DONATION_MIN_CENTS / 100}
              max={DONATION_MAX_CENTS / 100}
              step="1"
              inputMode="decimal"
              className="form-input"
              value={amount}
              placeholder={tr("donate_amt_ph")}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountError(null);
              }}
            />
            {amountError && (
              <p className="form-hint" style={{ color: "var(--bronze-dark)" }}>
                {amountError}
              </p>
            )}
          </div>
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
            <Trans k="donate_details_hint" />
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
          <div className="order-summary">
            <div className="order-line">
              <span>
                <Trans k={frequency === "monthly" ? "donate_freq_monthly" : "donate_freq_once"} />{" "}
                Donation
              </span>
              <span>
                NZD ${amount}
                {frequency === "monthly" ? tr("donate_per_month_suffix") : ""}
              </span>
            </div>
          </div>
          <StripeCardForm
            clientSecret={clientSecret}
            amountLabel={amountLabel}
            onSuccess={() => setStep(4)}
          />
          <div className="stripe-badge">Secured by Stripe</div>
        </div>
      )}
      {step === 4 && (
        <div className="success-screen">
          <div className="success-icon">🏸</div>
          <h3 className="success-title">
            <Trans k="confirm_donate" />
          </h3>
          <p className="success-body">
            <Trans
              k={frequency === "monthly" ? "confirm_donate_body_monthly" : "confirm_donate_body_once"}
            />
          </p>
        </div>
      )}
    </ModalShell>
  );
}
