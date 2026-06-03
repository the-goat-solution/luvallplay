"use client";

import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { ModalShell } from "@/components/modals/ModalShell";
import { toDateKey } from "@/lib/dates";

export function WaitlistModal() {
  const { tr } = useLanguage();
  const { openModal, setOpenModal, waitlistSession } = useApp();
  const open = openModal === "waitlist";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const close = () => {
    setOpenModal(null);
    setDone(false);
    setName("");
    setEmail("");
    document.body.style.overflow = "";
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          sessionDate: waitlistSession ? toDateKey(waitlistSession) : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      setDone(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally {
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
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
            />
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
              placeholder="your@email.com"
            />
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
            {loading ? tr("processing") : tr("join_waitlist")}
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
