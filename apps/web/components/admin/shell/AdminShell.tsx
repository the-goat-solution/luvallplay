"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminLink } from "@/components/admin/AdminLink";
import { CountBadge } from "@/components/admin/kit";
import { FlashToast } from "@/components/admin/FlashToast";
import { activeHref, type BadgeKey, type NavGroup } from "@/components/admin/nav-config";
import s from "./shell.module.css";
import { clubShortName } from "@/lib/club-brand";

// The admin frame: a sidebar on wide screens; on a phone, a top bar with a
// menu button that slides the same sidebar in. Pages render inside <main>.
export function AdminShell({
  groups,
  badges,
  who,
  children,
}: {
  groups: NavGroup[];
  badges: Partial<Record<BadgeKey, number>>;
  /** Signed-in admin's name (null only if the session vanished mid-request). */
  who: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/admin";
  const current = activeHref(pathname, groups);
  const [open, setOpen] = useState(false);
  const currentLabel = groups.flatMap((g) => g.items).find((i) => i.href === current)?.label ?? "Club admin";
  const attention = (Object.values(badges) as number[]).reduce((a, b) => a + (b > 0 ? b : 0), 0);

  // Close the phone menu once the next page is showing.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={s.shell}>
      <header className={s.topbar}>
        <button
          type="button"
          className={s.menuButton}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="admin-sidebar"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden>☰</span>
          {attention > 0 && <span className={s.dot} aria-hidden />}
        </button>
        <span className={s.topTitle}>{currentLabel}</span>
      </header>

      {open && <div className={s.scrim} onClick={() => setOpen(false)} aria-hidden />}

      <aside id="admin-sidebar" className={`${s.sidebar} ${open ? s.sidebarOpen : ""}`} aria-label="Club admin">
        <div className={s.brand}>
          <AdminLink href="/admin" className={s.brandLink}>
            {clubShortName()}
            <span className={s.brandSub}>Club admin</span>
          </AdminLink>
          <button type="button" className={s.closeButton} aria-label="Close menu" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        <nav className={s.nav}>
          {groups.map((g) => (
            <div key={g.label || "home"} className={s.group}>
              {g.label && <div className={s.groupLabel}>{g.label}</div>}
              <ul className={s.items}>
                {g.items.map((item) => {
                  const isActive = item.href === current;
                  return (
                    <li key={item.href}>
                      <AdminLink
                        href={item.href}
                        current={isActive}
                        prefetchShell
                        className={`${s.item} ${isActive ? s.itemActive : ""}`}
                      >
                        <span className={s.itemLabel}>{item.label}</span>
                        {item.badge && <CountBadge n={badges[item.badge] ?? 0} />}
                      </AdminLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={s.footer}>
          <a href="/casual-play" target="_blank" rel="noopener" className={s.footerLink}>
            Court board ↗
          </a>
          {who !== null ? (
            // Signed in as yourself: admin is part of your account, so the way
            // out is back to your profile (sign out lives in Settings).
            <a href="/profile" className={s.footerLink}>
              <span className={s.who}>{who}</span>
              My profile
            </a>
          ) : (
            <a href="/login?next=/admin" className={s.footerLink}>
              Sign in
            </a>
          )}
        </div>
      </aside>

      {/* useSearchParams needs a Suspense boundary of its own. */}
      <Suspense fallback={null}>
        <FlashToast pathname={pathname} />
      </Suspense>
      <main className={s.main}>{children}</main>
    </div>
  );
}
