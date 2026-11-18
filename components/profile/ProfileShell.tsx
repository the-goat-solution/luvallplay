"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import type { Lang } from "@/lib/i18n";
import { LangSync } from "./LangToggle";
import { InstallGuide } from "./InstallGuide";
import { SignOutForm } from "./SignOutForm";
import styles from "./profile.module.css";

const TABS: { href: string; key: ProfileKey; icon: ReactNode }[] = [
  {
    href: "/profile/account",
    key: "tab_account",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </svg>
    ),
  },
  {
    href: "/profile/membership",
    key: "tab_membership",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M3 10h18M7 15h4" />
      </svg>
    ),
  },
  {
    href: "/profile/arena",
    key: "tab_arena",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4l9 9M20 4l-9 9" />
        <ellipse cx="5.6" cy="5.6" rx="2.6" ry="3.4" transform="rotate(-45 5.6 5.6)" />
        <ellipse cx="18.4" cy="5.6" rx="2.6" ry="3.4" transform="rotate(45 18.4 5.6)" />
        <path d="M11 15l-5 5M13 15l5 5" />
        <circle cx="12" cy="19.5" r="1.6" />
      </svg>
    ),
  },
  {
    href: "/profile/wolf-vision",
    key: "tab_wolfvision",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2v2M12 20v2" />
      </svg>
    ),
  },
  {
    href: "/profile/player",
    key: "tab_player",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
        <path d="M17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3" />
      </svg>
    ),
  },
];

/** Inside each tab link: dims and pulses while that tab is loading. */
function TabContent({ icon, label, badge }: { icon: ReactNode; label: string; badge: number }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {pending && <span className={styles.navBar} aria-hidden="true" />}
      <span className={pending ? styles.tabPending : undefined} style={{ display: "contents" }} aria-busy={pending || undefined}>
        {icon}
        <span>{label}</span>
      </span>
      {badge > 0 && (
        <span className={styles.badge} aria-label={`${badge} new`}>
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </>
  );
}

/**
 * On the other tabs: a small pill back to an accepted challenge whose
 * "Let's go" screen was minimized in the Arena.
 */
function MatchPill({ id }: { id: number | null }) {
  const { tr } = useProfileT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!id) return;
    const read = () => {
      try {
        const min = JSON.parse(localStorage.getItem("tw-arena-vs-min") || "[]") as number[];
        setShow(Array.isArray(min) && min.includes(id));
      } catch {
        setShow(false);
      }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [id]);
  if (!id || !show) return null;
  return (
    <Link href="/profile/arena" className={styles.matchPill}>
      <span className={styles.matchPillVs}>VS</span>
      <span>{tr("match_waiting")}</span>
    </Link>
  );
}

export type ShellPlayer = {
  firstName: string;
  lastName: string;
  email: string;
  lang: Lang;
  avatarUrl?: string | null;
};

function initials(p: ShellPlayer): string {
  const a = p.firstName.trim()[0] ?? p.email[0] ?? "?";
  const b = p.lastName.trim()[0] ?? "";
  return `${a}${b}`.toUpperCase();
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Pull-to-refresh for the installed app (home-screen web apps don't have one). */
function usePullToRefresh(onRefresh: () => void) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!isStandalone()) return;
    const pullRef = { current: 0 };
    const onStart = (e: TouchEvent) => {
      pullRef.current = 0;
      if (window.scrollY <= 0 && !document.body.style.overflow) start.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      setPull(dy > 0 ? Math.min(dy, 140) : 0);
    };
    const onEnd = () => {
      if (start.current !== null && pullRef.current > 80) {
        setRefreshing(true);
        onRefresh();
        window.setTimeout(() => setRefreshing(false), 1200);
      }
      start.current = null;
      setPull(0);
    };
    const track = (e: TouchEvent) => {
      if (start.current !== null) pullRef.current = e.touches[0].clientY - start.current;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchmove", track, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchmove", track);
      window.removeEventListener("touchend", onEnd);
    };
  }, [onRefresh]);
  return { pull, refreshing };
}

export function ProfileShell({
  player,
  showInstallGuide,
  badges,
  liveMatchId = null,
  children,
}: {
  player: ShellPlayer;
  showInstallGuide: boolean;
  badges?: Partial<Record<"account" | "membership" | "player" | "arena", number>>;
  /** An accepted challenge waiting to be played (for the minimized "Let's go" pill). */
  liveMatchId?: number | null;
  children: ReactNode;
}) {
  const { tr } = useProfileT();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = usePullToRefresh(() => router.refresh());

  useEffect(() => {
    // Static files only: signed-in pages and data are never cached.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // Other tabs load in the background, so switching tabs is instant.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const prefetch = () => TABS.forEach((t) => router.prefetch(t.href));
    if (idle) idle(prefetch);
    else window.setTimeout(prefetch, 1500);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const badgeFor = (href: string) => {
    const key = href.split("/").pop() as "account" | "membership" | "player" | "arena";
    return badges?.[key] ?? 0;
  };

  return (
    <div className={styles.app}>
      <LangSync lang={player.lang} />
      <header className={styles.topbar}>
        <Link href="/profile/membership" className={styles.brand} aria-label="Three Wolves">
          <img src="/icons/wolf-mark-light.png" alt="" width={44} height={24} />
          <span className={styles.brandTitle}>{tr("app_title")}</span>
        </Link>
        <div className={styles.topbarSpacer} />
        <Link href="/" className={styles.siteBtn}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>{tr("back_to_site")}</span>
        </Link>
        <div ref={menuRef} style={{ position: "static" }}>
          <button
            type="button"
            className={styles.avatarBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${player.firstName} ${player.lastName}`.trim() || player.email}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {player.avatarUrl ? <img src={player.avatarUrl} alt="" className={styles.avatarImg} /> : initials(player)}
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <div className={styles.menuEmail}>{player.email}</div>
              <Link href="/profile/account" role="menuitem" onClick={() => setMenuOpen(false)}>
                {tr("tab_account")}
              </Link>
              <a href="/leaderboard" role="menuitem">
                {tr("leaderboard")}
              </a>
              <Link href="/" role="menuitem">
                {tr("view_site")}
              </Link>
              <SignOutForm action="/api/auth/logout" role="menuitem">
                {tr("sign_out")}
              </SignOutForm>
            </div>
          )}
        </div>
      </header>
      {!online && <div className={styles.offline}>{tr("offline")}</div>}
      {(pull > 20 || refreshing) && (
        <div className={styles.ptr} style={{ opacity: refreshing ? 1 : Math.min(1, pull / 80) }}>
          {refreshing ? tr("refreshing") : pull > 80 ? tr("release_to_refresh") : tr("pull_to_refresh")}
        </div>
      )}

      <nav className={styles.tabs} aria-label="Profile">
        {TABS.map((t) => {
          const active = pathname?.startsWith(t.href);
          const badge = badgeFor(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`${styles.tab} ${active ? styles.tabActive : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <TabContent icon={t.icon} label={tr(t.key)} badge={badge} />
            </Link>
          );
        })}
      </nav>

      <main className={styles.main}>{children}</main>
      {!pathname?.startsWith("/profile/arena") && <MatchPill id={liveMatchId} />}
      <InstallGuide autoShow={showInstallGuide} />
    </div>
  );
}
