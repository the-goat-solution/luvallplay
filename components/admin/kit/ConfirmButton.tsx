"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import k from "./kit.module.css";

/**
 * A submit button that asks first ("Remove Mai as admin?"). Inside a <form>
 * with a server action; shows a pending state while the action runs.
 */
export function ConfirmButton({
  confirm,
  children,
  tone = "danger",
  name,
  value,
}: {
  confirm: string;
  children: ReactNode;
  tone?: "danger" | "primary" | "secondary";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const cls = tone === "danger" ? k.btnDanger : tone === "primary" ? k.btn : k.btnSecondary;
  return (
    <button
      type="submit"
      className={cls}
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "…" : children}
    </button>
  );
}
