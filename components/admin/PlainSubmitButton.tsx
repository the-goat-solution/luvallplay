"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

// For a <form> with no function `action` (a plain native GET/navigation
// submit) — useFormStatus doesn't track these since React never intercepts
// them, so pending state is tracked locally instead.
export function PlainSubmitButton({
  children,
  loadingText = "Loading…",
  className,
  style,
}: {
  children: ReactNode;
  loadingText?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [submitting, setSubmitting] = useState(false);
  const showSubmitting = useDelayedLoading(submitting);

  return (
    <button
      type="submit"
      onClick={() => {
        // Deferred a tick: disabling the button synchronously inside its
        // own click handler can cancel the browser's native form submit
        // before it fires, since the button is no longer active by the
        // time the default action runs.
        setTimeout(() => setSubmitting(true), 0);
      }}
      disabled={submitting}
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}
    >
      {showSubmitting ? (
        <>
          <LoadingIcon size="sm" />
          {loadingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
