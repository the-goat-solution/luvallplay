"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

type Failure = {
  message: string;
  invoiceUrl: string | null;
};

// Re-runs the member's outstanding Stripe invoice against their saved card.
// On a decline it shows the bank's reason inline plus a copyable invoice
// link, so the admin can tell the member to top up, or send them the link to
// pay on a different card, without opening the Stripe dashboard.
export function MemberRetryButton({
  membershipId,
  memberName,
}: {
  membershipId: number;
  memberName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    if (
      !window.confirm(
        `Retry ${memberName}'s outstanding payment now? This charges the card they have on file.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setFailure(null);
    setSucceeded(false);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/retry-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId }),
      });
      // The session can lapse while this page sits open. Send them to the
      // login page rather than showing an "Unauthorized" they can't act on.
      if (res.status === 401) {
        window.location.href = `/login?stepup=1&next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setFailure({
          message: data.error ?? "The retry failed",
          invoiceUrl: data.invoiceUrl ?? null,
        });
        setBusy(false);
        return;
      }
      setSucceeded(true);
      setBusy(false);
      // The membership row flips to 'active' when Stripe's webhook lands,
      // which can trail the charge by a moment — refresh so the status
      // column catches up as soon as it does.
      router.refresh();
    } catch {
      setFailure({
        message: "Could not reach the server — check your connection.",
        invoiceUrl: null,
      });
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!failure?.invoiceUrl) return;
    try {
      await navigator.clipboard.writeText(failure.invoiceUrl);
      setCopied(true);
    } catch {
      // Clipboard access can be blocked; the link is on screen to copy by
      // hand either way, so there's nothing useful to report here.
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: "5px 12px",
          borderRadius: 6,
          border: "1px solid #184467",
          background: "#fff",
          color: "#184467",
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {showBusy ? (
          <>
            <LoadingIcon size="sm" />
            Retrying…
          </>
        ) : (
          "Retry"
        )}
      </button>

      {succeeded ? (
        <div style={{ marginTop: 6, color: "#1a7a3c", fontSize: 11 }}>
          Payment taken. Status updates once Stripe confirms.
        </div>
      ) : null}

      {failure ? (
        <div style={{ marginTop: 6, maxWidth: 260 }}>
          <div style={{ color: "#b00020", fontSize: 11, lineHeight: 1.45 }}>
            {failure.message}
          </div>
          {failure.invoiceUrl ? (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                onClick={copyLink}
                style={{
                  padding: "3px 8px",
                  borderRadius: 5,
                  border: "1px solid #ccc",
                  background: "#fff",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {copied ? "Link copied" : "Copy invoice link"}
              </button>
              <a
                href={failure.invoiceUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 11,
                  marginLeft: 8,
                  color: "#184467",
                }}
              >
                Open
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
