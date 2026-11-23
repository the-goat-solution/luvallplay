"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useProfileT } from "@/lib/profile-i18n";
import type { ThreadSummary } from "@/lib/messages-db";
import { MessagesPanel } from "../MessagesPanel";
import { Sheet } from "../Sheet";
import { fmtDate } from "../membership/format";
import m from "./me.module.css";

export type MembershipPill = { kind: "renews" | "ends" | "active"; date: string | null } | { kind: "none" };

/** Opens the inbox sheet from anywhere on the page (the preview card, links). */
export const OPEN_INBOX_EVENT = "tw:open-inbox";

export function openInbox(threadId?: number): void {
  window.dispatchEvent(new CustomEvent(OPEN_INBOX_EVENT, { detail: { threadId } }));
}

/**
 * Me header: avatar, name, membership pill, inbox bell, settings gear, and
 * (for club admins) the Club admin button. The bell opens the inbox as a
 * sheet on phones and a wide dialog with list + thread side by side on
 * tablets. ?inbox=1 or ?thread=12 (links in message emails) open it too.
 */
export function MeHeader({
  name,
  initials,
  avatarUrl,
  pill,
  threads,
  isAdmin,
}: {
  name: string;
  initials: string;
  avatarUrl: string | null;
  pill: MembershipPill;
  threads: ThreadSummary[];
  isAdmin: boolean;
}) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const params = useSearchParams();
  const unread = threads.filter((t) => t.unread).length;
  const linkThread = Number(params.get("thread"));
  const [inbox, setInbox] = useState<{ open: boolean; threadId: number | null }>(() => ({
    open: params.get("inbox") === "1" || (Number.isInteger(linkThread) && linkThread > 0),
    threadId: Number.isInteger(linkThread) && linkThread > 0 ? linkThread : null,
  }));

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ threadId?: number }>).detail?.threadId ?? null;
      setInbox({ open: true, threadId: id });
    };
    window.addEventListener(OPEN_INBOX_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_INBOX_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setInbox({ open: false, threadId: null });
    // Drop ?inbox / ?thread so a refresh doesn't reopen it; refresh the badge.
    if (params.get("inbox") || params.get("thread")) router.replace("/profile", { scroll: false });
    router.refresh();
  }, [params, router]);

  const pillText =
    pill.kind === "none"
      ? tr("me_pill_none")
      : pill.kind === "active" || !pill.date
        ? tr("me_pill_active")
        : tr(pill.kind === "renews" ? "me_pill_renews" : "me_pill_ends", { date: fmtDate(pill.date, lang) });

  return (
    <header className={m.header}>
      <div className={m.avatar} aria-hidden="true">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : initials}
      </div>
      <div className={m.who}>
        <h1 className={m.name}>{name}</h1>
        <span className={`${m.pill} ${pill.kind === "none" ? "" : m.pillActive}`}>{pillText}</span>
      </div>
      <div className={m.icons}>
        <button
          type="button"
          className={m.iconBtn}
          onClick={() => setInbox({ open: true, threadId: null })}
          aria-label={unread > 0 ? `${tr("me_inbox")}, ${tr("me_inbox_unread", { n: unread })}` : tr("me_inbox")}
          aria-haspopup="dialog"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 003.4 0" />
          </svg>
          {unread > 0 && <span className={m.dot}>{unread > 9 ? "9+" : unread}</span>}
        </button>
        <Link href="/profile/settings" className={m.iconBtn} aria-label={tr("me_settings")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </Link>
      </div>
      {isAdmin && <ClubAdminButton />}
      <Sheet open={inbox.open} onClose={close} title={tr("me_inbox")} wide>
        <MessagesPanel initialThreads={threads} layout="split" initialOpenId={inbox.threadId} bare key={inbox.threadId ?? "list"} />
      </Sheet>
    </header>
  );
}

/**
 * "Club admin" for people with a club role. On the web it simply opens
 * /admin (same cookie). The native app (Phase 5) asks /api/admin/handoff for
 * a single-use 60-second link instead, so its token never leaves the app.
 */
export function ClubAdminButton({ className }: { className?: string }) {
  const { tr } = useProfileT();
  return (
    <a href="/admin" className={className ?? m.adminBtn}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
      </svg>
      {tr("me_club_admin")}
      <span aria-hidden="true">→</span>
    </a>
  );
}
