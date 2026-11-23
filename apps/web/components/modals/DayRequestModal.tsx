"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { usePausedDays } from "@/context/SignupPauseContext";
import { Trans } from "@/components/Trans";
import { FormError } from "@/components/FormError";
import { ModalShell } from "@/components/modals/ModalShell";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { WEEKDAYS, type Weekday } from "@/lib/constants";
import { validateWaitlist } from "@/lib/validate-contact";
import type { I18nKey } from "@/lib/i18n";

// Same reasoning as WaitlistModal's timeout.
const REQUEST_TIMEOUT_MS = 20_000;

export function weekdayKey(day: Weekday): I18nKey {
  return `wd_${day}` as I18nKey;
}

// "Notify me when this day opens" — used both for a paused day (e.g.
// Wednesday) coming back and for requesting a day the club doesn't run yet.
// Requests show up for admins at /admin/play-days/schedule.
export function DayRequestModal() {
  const { tr } = useLanguage();
  const { openModal, setOpenModal, dayRequestDay } = useApp();
  const pausedDays = usePausedDays();
  const open = openModal === "dayRequest";
  const [day, setDay] = useState<Weekday | "">("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const showLoading = useDelayedLoading(loading);
  const [errors, setErrors] = useState<{
    name?: I18nKey;
    email?: I18nKey;
    day?: I18nKey;
  }>({});
  const abortRef = useRef<AbortController | null>(null);

  const close = () => {
    abortRef.current?.abort();
    setOpenModal(null);
    setDone(false);
    setName("");
    setEmail("");
    setErrors({});
    setLoading(false);
    document.body.style.overflow = "";
  };

  // Opening (or switching the requested day while open) resets the form.
  // Starts as "closed" so a modal that mounts already open is reset too.
  const [prev, setPrev] = useState<{ open: boolean; day: Weekday | null }>({
    open: false,
    day: dayRequestDay,
  });
  if (prev.open !== open || prev.day !== dayRequestDay) {
    setPrev({ open, day: dayRequestDay });
    if (open) {
      setDay(dayRequestDay ?? "");
      setDone(false);
      setErrors({});
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
  }, [open, dayRequestDay]);

  // Opened from a paused day's "notify me" button: the day is fixed and the
  // copy explains the pause. Otherwise it's an open-ended day request.
  const pausedPreset =
    dayRequestDay !== null && pausedDays.includes(dayRequestDay);
  const dayLabel = day ? tr(weekdayKey(day)) : "";

  const submit = async () => {
    if (loading) return;
    const result = validateWaitlist(name, email);
    const nextErrors: typeof errors = { ...result.errors };
    if (!day) nextErrors.day = "form_required";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/day-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), day }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          typeof data?.error === "string" ? data.error : tr("day_request_failed"),
        );
      }
      setDone(true);
    } catch (e) {
      if (controller.signal.aborted && !timedOut) return;
      alert(
        timedOut
          ? tr("waitlist_timeout")
          : e instanceof Error
            ? e.message
            : tr("day_request_failed"),
      );
    } finally {
      clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <ModalShell
      id="day-request-modal"
      open={open}
      onClose={close}
      title={<Trans k={pausedPreset ? "modal_day_paused" : "modal_day_request"} />}
    >
      {!done ? (
        <div>
          <div className="info-box" style={{ marginBottom: 20 }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              {pausedPreset ? (
                <Trans k="day_request_paused_msg" vars={{ day: dayLabel }} />
              ) : (
                <Trans k="day_request_msg" />
              )}
            </div>
          </div>
          {!pausedPreset && (
            <div className="form-group">
              <label className="form-label" htmlFor="day-request-day">
                <Trans k="day_request_day_label" />
              </label>
              <select
                id="day-request-day"
                className="form-input"
                value={day}
                aria-invalid={Boolean(errors.day)}
                onChange={(e) => {
                  setDay(e.target.value as Weekday | "");
                  setErrors((prev) => ({ ...prev, day: undefined }));
                }}
              >
                <option value="">—</option>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {tr(weekdayKey(d))}
                  </option>
                ))}
              </select>
              <FormError messageKey={errors.day} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">
              <Trans k="your_name" />
            </label>
            <input
              className="form-input"
              value={name}
              required
              aria-invalid={Boolean(errors.name)}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              placeholder="Your full name"
            />
            <FormError messageKey={errors.name} />
          </div>
          <div className="form-group">
            <label className="form-label">
              <Trans k="form_email" />
            </label>
            <input
              type="email"
              className="form-input"
              value={email}
              required
              aria-invalid={Boolean(errors.email)}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors((prev) => ({ ...prev, email: undefined }));
              }}
              placeholder="your@email.com"
            />
            <FormError messageKey={errors.email} />
          </div>
          <button
            type="button"
            className="btn btn-navy btn-full"
            disabled={loading}
            onClick={submit}
          >
            {showLoading ? (
              <>
                <LoadingIcon size="sm" />
                {tr("processing")}
              </>
            ) : (
              tr("day_request_submit")
            )}
          </button>
        </div>
      ) : (
        <div className="success-screen">
          <div className="success-icon">✓</div>
          <h3 className="success-title">
            <Trans k="confirm_day_request" />
          </h3>
          <p className="success-body">
            <Trans k="confirm_day_request_body" vars={{ day: dayLabel }} />
          </p>
        </div>
      )}
    </ModalShell>
  );
}
