"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { usePausedDays } from "@/context/SignupPauseContext";
import { Trans } from "@/components/Trans";
import { ContactDetailsForm } from "@/components/forms/ContactDetailsForm";
import { StepHeading } from "@/components/forms/StepHeading";
import { ModalShell, StepBar } from "@/components/modals/ModalShell";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import {
  isMembershipPlan,
  resolveAllPlanDisplays,
  splitPlanId,
  type CmsPricingPlan,
  type PlanDisplay,
} from "@/lib/pricing-plans";
import { validateContact, type ContactErrors } from "@/lib/validate-contact";

type BlockedReason = "sessions_full" | "already_member" | "day_paused" | null;

const DAY_NAME: Record<"en" | "vi", Record<string, string>> = {
  en: { friday: "Friday", wednesday: "Wednesday" },
  vi: { friday: "Thứ Sáu", wednesday: "Thứ Tư" },
};

export function MembershipModal({
  pricingPlans,
}: {
  pricingPlans?: CmsPricingPlan[] | null;
}) {
  const { lang, tr } = useLanguage();
  const {
    openModal,
    setOpenModal,
    selectedPlan,
    setSelectedPlan,
    openCasualModal,
    openDayRequestModal,
  } = useApp();
  const pausedDays = usePausedDays();
  const wednesdayPaused = pausedDays.includes("wednesday");
  const fridayPaused = pausedDays.includes("friday");
  const open = openModal === "membership";
  const [step, setStep] = useState(1);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [recurring, setRecurring] = useState(true);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [errors, setErrors] = useState<ContactErrors>({});
  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<BlockedReason>(null);
  const [blockedDay, setBlockedDay] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const showSubmitting = useDelayedLoading(submitting);

  const close = () => {
    setOpenModal(null);
    setStep(1);
    setClientSecret(null);
    setErrors({});
    setPeriodStart(null);
    setBlockedReason(null);
    setBlockedDay(null);
    setSubmitting(false);
    document.body.style.overflow = "";
  };

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setStep(1);
      setRecurring(true);
      setErrors({});
      setPeriodStart(null);
      setBlockedReason(null);
      setBlockedDay(null);
    }
  }, [open]);

  const planDisplays = useMemo(
    () => resolveAllPlanDisplays(pricingPlans, lang, tr),
    [pricingPlans, lang, tr],
  );
  const planById = useMemo(
    () => Object.fromEntries(planDisplays.map((p) => [p.planId, p])),
    [planDisplays],
  );
  const casualPlan = planDisplays.find((p) => p.planId === "casual");
  const fridayPlans = planDisplays.filter(
    (p) => splitPlanId(p.planId)?.day === "friday",
  );
  const wednesdayPlans = planDisplays.filter(
    (p) => splitPlanId(p.planId)?.day === "wednesday",
  );
  const groupHeadingStyle = {
    fontFamily: "var(--font-display)",
    fontSize: 15,
    color: "var(--navy)",
    fontWeight: 700,
    marginBottom: 10,
  } as const;

  const renderPlanOption = (plan: PlanDisplay) => (
    <div
      key={plan.planId}
      className={`plan-opt${selectedPlan === plan.planId ? " sel" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => setSelectedPlan(plan.planId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setSelectedPlan(plan.planId);
      }}
    >
      <div className="plan-radio">
        <div className="plan-dot" />
      </div>
      <div className="plan-opt-info">
        <div className="plan-opt-name">{plan.name}</div>
        <div className="plan-opt-desc">{plan.description}</div>
      </div>
      <div className="plan-opt-price">{plan.modalPriceLabel}</div>
    </div>
  );

  // A paused day's plans aren't selectable — offer "notify me" instead.
  const renderPausedGroup = (day: "friday" | "wednesday") => (
    <div className="info-box" style={{ marginBottom: 0 }}>
      <div style={{ flex: 1 }}>
        <Trans k="mem_day_paused" vars={{ day: DAY_NAME[lang][day] }} />
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-bronze-outline"
            onClick={() => {
              close();
              openDayRequestModal(day);
            }}
          >
            {tr("day_request_submit")}
          </button>
        </div>
      </div>
    </div>
  );

  const createSubscription = async () => {
    const split = splitPlanId(selectedPlan);
    if (!split) return; // casual never reaches this path — see next()
    const res = await fetch("/api/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: split.tier,
        day: split.day,
        firstName: fn.trim(),
        lastName: ln.trim(),
        email: email.trim(),
        phone: phone.trim(),
        recurring,
        turnstileToken: turnstileToken || undefined,
      }),
    });
    const data = await res.json();
    if (
      res.status === 409 &&
      (data.error === "sessions_full" ||
        data.error === "already_member" ||
        data.error === "day_paused")
    ) {
      setBlockedReason(data.error);
      setBlockedDay(typeof data.day === "string" ? data.day : null);
      return;
    }
    if (!res.ok) throw new Error(data.error ?? "Subscription setup failed");
    setClientSecret(data.clientSecret);
    setPeriodStart(
      typeof data.periodStart === "string" ? data.periodStart : null,
    );
    setStep(3);
  };

  const selectedPlanPaused = (() => {
    const split = splitPlanId(selectedPlan);
    return split ? pausedDays.includes(split.day) : false;
  })();

  const next = async () => {
    if (step === 1 && selectedPlanPaused) return;
    if (step === 1 && selectedPlan === "casual") {
      close();
      openCasualModal();
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
      if (isMembershipPlan(selectedPlan)) {
        setSubmitting(true);
        try {
          await createSubscription();
        } catch (e) {
          alert(e instanceof Error ? e.message : "Error");
        } finally {
          setSubmitting(false);
        }
        return;
      }
    }
    if (step < 3) setStep(step + 1);
  };

  const back = () => {
    if (step > 1) setStep(step - 1);
  };

  const selected = planById[selectedPlan] ?? planDisplays[1];
  const { name, period, priceNzd: price } = selected;
  const selectedDay = splitPlanId(selectedPlan)?.day;
  const selectedDayLabel = selectedDay ? DAY_NAME[lang][selectedDay] : "";

  const clearError = (key: keyof ContactErrors) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <ModalShell
      id="membership-modal"
      open={open}
      onClose={close}
      title={<Trans k="modal_join" />}
      footer={
        !blockedReason && step < 4 ? (
          <>
            {step > 1 && step < 4 && (
              <button
                type="button"
                className="btn btn-bronze-outline btn-back"
                onClick={back}
                disabled={submitting}
              >
                <Trans k="btn_back" />
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                className="btn btn-navy btn-continue"
                onClick={next}
                disabled={submitting || (step === 1 && selectedPlanPaused)}
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
      {blockedReason ? (
        <div className="success-screen">
          <div className="success-icon">😕</div>
          <h3 className="success-title">
            <Trans
              k={
                blockedReason === "already_member"
                  ? "mem_already_member"
                  : blockedReason === "day_paused"
                    ? "mem_day_paused_blocked"
                    : "mem_sessions_full"
              }
              vars={
                blockedDay ? { day: DAY_NAME[lang][blockedDay] } : undefined
              }
            />
          </h3>
        </div>
      ) : (
        <>
          <StepBar step={step} />
          {step === 1 && (
            <div>
              <StepHeading titleKey="step_plan" required />
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-light)",
                  marginBottom: 18,
                }}
              >
                Choose the membership that works best for you.
              </p>
              {casualPlan && (
                <div className="plan-pick" style={{ marginBottom: 18 }}>
                  {renderPlanOption(casualPlan)}
                </div>
              )}
              {fridayPlans.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <h4 style={groupHeadingStyle}>
                    <Trans k="mem_group_friday" />
                  </h4>
                  {fridayPaused ? (
                    renderPausedGroup("friday")
                  ) : (
                    <div className="plan-pick">
                      {fridayPlans.map(renderPlanOption)}
                    </div>
                  )}
                </div>
              )}
              {wednesdayPlans.length > 0 && (
                <div>
                  <h4 style={groupHeadingStyle}>
                    <Trans k="mem_group_wednesday" />
                  </h4>
                  {wednesdayPaused ? (
                    renderPausedGroup("wednesday")
                  ) : (
                    <div className="plan-pick">
                      {wednesdayPlans.map(renderPlanOption)}
                    </div>
                  )}
                </div>
              )}
              {isMembershipPlan(selectedPlan) && !selectedPlanPaused && (
                <div>
                  <h4 style={groupHeadingStyle}>
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
                          if (e.key === "Enter" || e.key === " ")
                            setRecurring(isRecurring);
                        }}
                      >
                        <div className="plan-radio">
                          <div className="plan-dot" />
                        </div>
                        <div className="plan-opt-info">
                          <div className="plan-opt-name">
                            <Trans
                              k={isRecurring ? "mem_recurring" : "mem_onetime"}
                            />
                          </div>
                          <div className="plan-opt-desc">
                            <Trans
                              k={
                                isRecurring
                                  ? "mem_recurring_d"
                                  : "mem_onetime_d"
                              }
                            />
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
                hintKey="form_membership_hint"
              />
            </div>
          )}
          {step === 3 && (
            <div>
              <StepHeading titleKey="step_payment" />
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-light)",
                  marginBottom: 18,
                }}
              >
                {periodStart ? (
                  <Trans
                    k="mem_start_delayed"
                    vars={{ date: periodStart, day: selectedDayLabel }}
                  />
                ) : (
                  <Trans k="mem_start_today" />
                )}
              </p>
              <div className="order-summary">
                <div className="order-line">
                  <span>{name} Membership</span>
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
              <div className="stripe-badge">Secured by Stripe</div>
            </div>
          )}
          {step === 4 && (
            <div className="success-screen">
              <div className="success-icon">🏸</div>
              <h3 className="success-title">
                <Trans k="confirm_join" />
              </h3>
              <p className="success-body">
                {periodStart ? (
                  <Trans
                    k="confirm_join_body_delayed"
                    vars={{ date: periodStart, day: selectedDayLabel }}
                  />
                ) : (
                  <Trans
                    k="confirm_join_body"
                    vars={{ day: selectedDayLabel }}
                  />
                )}
              </p>
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}
