"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { FormError } from "@/components/FormError";
import { ContactDetailsForm } from "@/components/forms/ContactDetailsForm";
import { StepHeading } from "@/components/forms/StepHeading";
import { ModalShell, StepBar } from "@/components/modals/ModalShell";
import { SessionCalendarPicker } from "@/components/modals/SessionCalendarPicker";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import { formatDateLong, formatEventTimeRange, getDayName, toDateKey } from "@/lib/dates";
import { PRICES } from "@/lib/constants";
import {
  validateContact,
  type ContactErrors,
} from "@/lib/validate-contact";

export function BookingModal() {
  const { lang, tr } = useLanguage();
  const { openModal, setOpenModal, selectedSession, sessionDates } = useApp();
  const open = openModal === "booking";
  const [step, setStep] = useState(1);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [errors, setErrors] = useState<ContactErrors>({});

  const close = () => {
    setOpenModal(null);
    setStep(1);
    setClientSecret(null);
    setErrors({});
    document.body.style.overflow = "";
  };

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setStep(1);
      setErrors({});
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
    if (step === 1) {
      if (!selectedSession) {
        setErrors({ session: "form_session_required" });
        return;
      }
      setErrors({});
      setStep(2);
      return;
    }
    if (step === 2) {
      const result = validateContact({
        firstName: fn,
        lastName: ln,
        email,
        phone,
        turnstileToken,
      });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
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

  const sessionInfo = selectedSession ? sessionDates[toDateKey(selectedSession)] : undefined;

  const clearError = (key: keyof ContactErrors) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
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
              <button
                type="button"
                className="btn btn-bronze-outline btn-back"
                onClick={back}
              >
                <Trans k="btn_back" />
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                className="btn btn-navy btn-continue"
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
          <StepHeading titleKey="step_session" required />
          <SessionCalendarPicker />
          <FormError messageKey={errors.session} />
        </div>
      )}
      {step === 2 && (
        <div>
          <StepHeading titleKey="step_details" />
          <ContactDetailsForm
            firstName={fn}
            lastName={ln}
            email={email}
            phone={phone}
            errors={errors}
            onFirstNameChange={setFn}
            onLastNameChange={setLn}
            onEmailChange={setEmail}
            onPhoneChange={setPhone}
            onTurnstileToken={setTurnstileToken}
            onClearError={clearError}
          />
        </div>
      )}
      {step === 3 && (
        <div>
          <StepHeading titleKey="step_payment" />
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
            📅{" "}
            {selectedSession ? (
              <>
                {getDayName(selectedSession, lang)}, {formatDateLong(selectedSession, lang)}
                {sessionInfo?.eventStartTime
                  ? `, ${formatEventTimeRange(sessionInfo.eventStartTime, sessionInfo.eventEndTime)}`
                  : ""}
              </>
            ) : (
              "Friday, 6:00 PM – 7:30 PM"
            )}
            <br />
            📍 {sessionInfo?.eventLocation || "Graham Condon Recreation and Sport Centre"}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
