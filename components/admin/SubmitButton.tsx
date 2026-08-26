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
      style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}
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
