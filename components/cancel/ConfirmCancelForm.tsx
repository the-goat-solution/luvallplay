"use client";

import { useState } from "react";

export function ConfirmCancelForm({
  token,
  planLabel,
  periodEnd,
  alreadyScheduled,
}: {
  token: string;
  planLabel: string;
  periodEnd: string | null;
  alreadyScheduled: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { ok: true; periodEnd: string | null } | { ok: false; error: string } | null
  >(null);

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/cancel-membership/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? "Something went wrong" });
      } else {
        setResult({ ok: true, periodEnd: data.periodEnd ?? null });
      }
    } catch {
      setResult({ ok: false, error: "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  if (alreadyScheduled) {
    return (
      <p style={{ color: "var(--text-dark)", lineHeight: 1.7 }}>
        This membership is already scheduled to cancel
        {periodEnd ? ` at the end of the current period (${periodEnd})` : ""}. No
        further action is needed.
      </p>
    );
  }

  if (result?.ok) {
    return (
      <p style={{ color: "var(--text-dark)", lineHeight: 1.7 }}>
        Done — your {planLabel} membership won&apos;t renew
        {result.periodEnd ? `. You keep access through ${result.periodEnd}.` : "."}
      </p>
    );
  }

  return (
    <>
      <p style={{ color: "var(--text-light)", marginBottom: 24, lineHeight: 1.7 }}>
        You&apos;re about to cancel your <strong>{planLabel}</strong> membership.
        {periodEnd
          ? ` You'll keep access through your current period, ending ${periodEnd}, and won't be charged again.`
          : " You won't be charged again."}
      </p>
      {result && !result.ok && (
        <p style={{ color: "#b00020", fontSize: 13, marginBottom: 16 }}>{result.error}</p>
      )}
      <button
        type="button"
        className="btn btn-navy btn-full"
        onClick={onConfirm}
        disabled={submitting}
      >
        {submitting ? "Canceling…" : "Confirm cancellation"}
      </button>
    </>
  );
}
