"use client";

import { useState, type ReactNode } from "react";
import { BusyLabel } from "./BusyLabel";

/** A sign-out form whose button shows a spinner until the page changes. */
export function SignOutForm({ action, className, role, children }: { action: string; className?: string; role?: string; children: ReactNode }) {
  const [pending, setPending] = useState(false);
  return (
    <form method="POST" action={action} onSubmit={() => setPending(true)}>
      <button type="submit" className={className} role={role} disabled={pending} aria-busy={pending}>
        <BusyLabel busy={pending}>{children}</BusyLabel>
      </button>
    </form>
  );
}
