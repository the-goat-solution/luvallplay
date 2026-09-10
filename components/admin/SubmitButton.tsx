"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

// Submit button for a Server Action <form> — must be a descendant of the
// form (not the form itself) so useFormStatus can read its pending state.
export function SubmitButton({
  children,
  loadingText = "Saving…",
  className,
  style,
}: {
  children: ReactNode;
  loadingText?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { pending } = useFormStatus();
  const showPending = useDelayedLoading(pending);

  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        ...style,
        // Applied after the caller's own style so a click is always
        // visibly acknowledged immediately, even during the delayed-spinner
        // grace window above — without this, a button whose caller sets its
        // own background/color (every admin button does) looks pixel-
        // identical whether disabled or not, which reads as "did that even
        // register?" and invites a second click.
        opacity: pending ? 0.6 : 1,
        cursor: pending ? "default" : "pointer",
      }}
    >
      {showPending ? (
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
