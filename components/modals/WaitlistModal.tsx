"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { FormError } from "@/components/FormError";
import { ModalShell } from "@/components/modals/ModalShell";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { toDateKey } from "@/lib/dates";
import { validateWaitlist } from "@/lib/validate-contact";
import type { I18nKey } from "@/lib/i18n";

// Upper bound on how long the submit button may sit on "Processing...".
// Vercel cuts a function off well before this, so hitting it means the
// response was lost in transit rather than still being worked on.
const REQUEST_TIMEOUT_MS = 20_000;

export function WaitlistModal() {
  const { tr } = useLanguage();
  const { openModal, setOpenModal, waitlistSession } = useApp();
  const open = openModal === "waitlist";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const showLoading = useDelayedLoading(loading);
  const [errors, setErrors] = useState<{ name?: I18nKey; email?: I18nKey }>({});

  // A stalled request must never outlive the modal: without this the in-flight
  // fetch keeps `loading` true after the user closes the form, and reopening
  // it lands on a permanently disabled "Processing..." button that only a page
  // reload clears.
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

  // Mirrors the other modals (see BookingModal/MembershipModal/DonateModal):
  // lock the page behind the overlay, and reset whichever screen the modal was
  // left on so it always reopens on the form.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setDone(false);
      setErrors({});
      setLoading(false);
    }
  }, [open]);

  const submit = async () => {
    if (loading) return;
    const result = validateWaitlist(name, email);
    if (!result.ok) {
      setErrors(result.errors);
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
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          sessionDate: waitlistSession ? toDateKey(waitlistSession) : undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // A failing route doesn't always answer with JSON (a gateway timeout
        // or an HTML error page), and the raw parse error is meaningless to
        // the person reading it.
        const data = await res.json().catch(() => null);
        throw new Error(
          typeof data?.error === "string" ? data.error : tr("waitlist_failed"),
        );
      }
      setDone(true);
    } catch (e) {
      // Aborted by close() — the modal is already gone, so there's nobody to
      // tell. A timeout is ours to report.
      if (controller.signal.aborted && !timedOut) return;
      alert(
        timedOut
          ? tr("waitlist_timeout")
          : e instanceof Error
            ? e.message
            : tr("waitlist_failed"),
      );
    } finally {
      clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <ModalShell
      id="waitlist-modal"
      open={open}
      onClose={close}
      title={<Trans k="modal_waitlist" />}
    >
      {!done ? (
        <div id="wl-form">
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
              <Trans k="waitlist_full_msg" />
            </div>
          </div>
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
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next.name;
                  return next;
                });
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
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next.email;
                  return next;
                });
              }}
              placeholder="your@email.com"
            />
            <FormError messageKey={errors.email} />
            <p className="form-hint">
              We&apos;ll notify you as soon as a spot opens. No payment required.
            </p>
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
              tr("join_waitlist")
            )}
          </button>
        </div>
      ) : (
        <div className="success-screen">
          <div className="success-icon">✓</div>
          <h3 className="success-title">
            <Trans k="confirm_waitlist" />
          </h3>
          <p className="success-body">
            <Trans k="confirm_waitlist_body" />
          </p>
        </div>
      )}
    </ModalShell>
  );
}
