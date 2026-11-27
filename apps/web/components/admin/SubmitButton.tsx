"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { useAdminText } from "@/components/admin/AdminLang";

// Submit button for a Server Action <form> — must be a descendant of the
// form (not the form itself) so useFormStatus can read its pending state.
export function SubmitButton({
  children,
  loadingText,
  className,
  style,
  disabled = false,
  confirmMessage,
}: {
  children: ReactNode;
  loadingText?: string;
  className?: string;
  style?: CSSProperties;
  // Extra reason to hold the button (e.g. a file still being prepared).
  disabled?: boolean;
  // Ask before submitting (e.g. an action that sends emails).
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  const { t } = useAdminText();
  const savingText = loadingText ?? t("common_saving");
  const showPending = useDelayedLoading(pending);

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      onClick={
        confirmMessage
          ? (e) => {
              if (!window.confirm(confirmMessage)) e.preventDefault();
            }
          : undefined
      }
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
        opacity: pending || disabled ? 0.6 : 1,
        cursor: pending || disabled ? "default" : "pointer",
      }}
    >
      {showPending ? (
        <>
          <LoadingIcon size="sm" />
          {savingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
