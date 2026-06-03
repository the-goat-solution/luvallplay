"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { ModalShell, StepBar } from "@/components/modals/ModalShell";
import { SessionCalendarPicker } from "@/components/modals/SessionCalendarPicker";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { toDateKey } from "@/lib/dates";
import { PRICES } from "@/lib/constants";

export function BookingModal() {
  const { tr } = useLanguage();
  const { openModal, setOpenModal, selectedSession } = useApp();
  const open = openModal === "booking";
  const [step, setStep] = useState(1);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

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
    }
  }, [open]);

  const createIntent = async () => {
    if (!selectedSession) return;
    const res = await fetch("/api/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionDate: toDateKey(selectedSession),
        firstName: fn.trim(),
        lastName: ln.trim(),
        email: email.trim(),
        phone: phone.trim(),
        turnstileToken: turnstileToken || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Payment setup failed");
    setClientSecret(data.clientSecret);
    setStep(3);
  };

  const next = async () => {
    if (step === 1 && !selectedSession) return;
    if (step === 2) {
      if (!fn.trim() || !ln.trim() || !email.trim()) return;
      try {
        await createIntent();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Error");
      }
      return;
    }
    if (step < 3) setStep(step + 1);
  };

  const back = () => {
    if (step > 1) setStep(step - 1);
  };

  return (
    <ModalShell
      id="booking-modal"
      open={open}
      onClose={close}
      title={<Trans k="modal_book" />}
      footer={
        step < 4 ? (
          <>
            {step > 1 && step < 4 && (
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
            <Trans k="step_session" />
          </h4>
          <SessionCalendarPicker />
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
            <Trans k="form_email_hint" />
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
                placeholder={tr("form_fn_ph")}
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
                placeholder={tr("form_ln_ph")}
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
              placeholder={tr("form_email_ph")}
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
              placeholder="+64 xx xxx xxxx"
            />
          </div>
          <TurnstileWidget onToken={setTurnstileToken} />
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
            Secure payment of <strong>NZD ${PRICES.casual}.00</strong> for one casual
            session.
          </p>
          <div className="order-summary">
            <div className="order-line">
              <span>Casual session — 1 x NZD $10.00</span>
              <span>$10.00</span>
            </div>
            <div className="order-total">
              <span>Total</span>
              <span>NZD $10.00</span>
            </div>
          </div>
          <StripeCardForm
            clientSecret={clientSecret}
            amountLabel={`${tr("pay_btn_pre")}${PRICES.casual}.00`}
            onSuccess={() => setStep(4)}
          />
          <div className="stripe-badge">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Secured by Stripe
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="success-screen">
          <div className="success-icon">✓</div>
          <h3 className="success-title">
            <Trans k="confirm_book" />
          </h3>
          <p className="success-body">
            <Trans k="confirm_book_body" />
          </p>
          <div className="success-detail">
            <strong>
              <Trans k="session_details" />
            </strong>
            <br />
            📅 Friday, 6:00 PM – 7:30 PM
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
