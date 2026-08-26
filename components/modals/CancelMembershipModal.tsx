"use client";

import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { ModalShell } from "@/components/modals/ModalShell";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

export function CancelMembershipModal() {
  const { tr } = useLanguage();
  const { openModal, setOpenModal } = useApp();
  const open = openModal === "cancel";
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const showSubmitting = useDelayedLoading(submitting);
  const [done, setDone] = useState(false);

  const close = () => {
    setOpenModal(null);
    setEmail("");
    setDone(false);
    document.body.style.overflow = "";
  };

  const submit = async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/cancel-membership/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Ignore — we show the same message either way.
    } finally {
      setSubmitting(false);
      setDone(true);
    }
  };

  return (
    <ModalShell
      id="cancel-membership-modal"
      open={open}
      onClose={close}
      title={<Trans k="modal_cancel" />}
    >
      {!done ? (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 18, lineHeight: 1.6 }}>
            <Trans k="cancel_membership_intro" />
          </p>
          <div className="form-group">
            <label className="form-label" htmlFor="cancel-modal-email">
              <Trans k="form_email" />
            </label>
            <input
              id="cancel-modal-email"
              type="email"
              required
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>
          <button
            type="button"
            className="btn btn-navy btn-full"
            disabled={submitting}
            onClick={submit}
          >
            {showSubmitting ? (
              <>
                <LoadingIcon size="sm" />
                {tr("processing")}
              </>
            ) : (
              tr("cancel_membership_btn")
            )}
          </button>
        </div>
      ) : (
        <div className="success-screen">
          <div className="success-icon">✓</div>
          <h3 className="success-title">
            <Trans k="confirm_cancel_sent" />
          </h3>
          <p className="success-body">
            <Trans k="confirm_cancel_sent_body" />
          </p>
        </div>
      )}
    </ModalShell>
  );
}
