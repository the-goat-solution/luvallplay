"use client";

import Link, { useLinkStatus } from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

// An in-app admin link that shows it's working. Admin pages are rendered
// on the server on every visit (some do real work first — the Financials
// ledger syncs Stripe), so a plain <a> gave no sign anything was happening
// until the new page arrived. Client-side navigation via next/link, plus
// useLinkStatus for this link's own pending state: the link dims at once
// and, if the page takes a moment, a small spinner appears beside it.
function PendingMark() {
  const { pending } = useLinkStatus();
  const show = useDelayedLoading(pending, 250);
  return show ? (
    <span style={{ display: "inline-flex", marginLeft: 6, verticalAlign: "middle" }}>
      <LoadingIcon size="sm" />
    </span>
  ) : null;
}

export function AdminLink({
  href,
  children,
  className,
  style,
  title,
  scroll,
  current,
  prefetchShell = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  scroll?: boolean;
  current?: boolean;
  // Prefetch just the admin loading screen (app/admin/(console)/loading.tsx) so it
  // appears the instant the link is clicked. For a dynamic page Next only
  // prefetches down to the nearest loading boundary — the page itself, and
  // any server work it does, still runs only on the real visit.
  prefetchShell?: boolean;
}) {
  return (
    <Link
      href={href}
      className={className}
      style={style}
      title={title}
      scroll={scroll}
      aria-current={current ? "page" : undefined}
      // Otherwise no prefetch at all: in-page links (sort, filter, edit)
      // stay on the same route, so there's no loading screen to fetch.
      prefetch={prefetchShell ? null : false}
    >
      {children}
      <PendingMark />
    </Link>
  );
}
