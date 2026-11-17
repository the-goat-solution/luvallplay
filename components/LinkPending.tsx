"use client";

import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

/**
 * Put inside a <Link>: while that link's page is loading, the link dims and
 * a thin bronze bar runs along the top of the screen (styles: globals.css).
 */
export function LinkPending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {pending && <span className="tw-nav-bar" aria-hidden="true" />}
      <span className={pending ? "tw-link-pending" : undefined} aria-busy={pending || undefined}>
        {children}
      </span>
    </>
  );
}
