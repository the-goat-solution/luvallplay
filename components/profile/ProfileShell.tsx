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

export type ShellPlayer = {
  firstName: string;
  lastName: string;
  email: string;
  lang: Lang;
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
  children,
}: {
  player: ShellPlayer;
  showInstallGuide: boolean;
  badges?: Partial<Record<"account" | "membership" | "player", number>>;
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
    const key = href.split("/").pop() as "account" | "membership" | "player";
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
        <div ref={menuRef} style={{ position: "static" }}>
          <button
            type="button"
            className={styles.avatarBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${player.firstName} ${player.lastName}`.trim() || player.email}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {initials(player)}
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
      <InstallGuide autoShow={showInstallGuide} />
    </div>
  );
}
