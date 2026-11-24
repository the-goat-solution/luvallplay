// The signed-in app: the club's look, its name and logo, the navigation for
// the window's size, the club switcher, and the screen for the current tab.
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { store } from "../app.ts";
import { Notice, OnLuvallplay, Splash, useLook } from "../Frame.tsx";
import { useCurrentClub, usePrefs, useSession, useT, useWindowClass, type Club } from "../hooks.tsx";
import { tabForPath, visibleTabs, type TabId } from "../lib/nav.ts";
import { navKind } from "../lib/window-class.ts";

const ICONS: Record<TabId, string> = {
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  arena: "M7 4h10v4a5 5 0 0 1-10 0V4Zm5 9v4m-4 3h8M7 6H4a3 3 0 0 0 3 4m10-4h3a3 3 0 0 1-3 4",
  vision: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  player: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3 2-1-2-4-2 1-2-1-.5-2h-4L11 6 9 7 7 6 5 10l2 1v2l-2 1 2 4 2-1 2 1 .5 2h4l.5-2 2-1 2 1 2-4-2-1Z",
};

function TabIcon({ id }: { id: TabId }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[id]} />
    </svg>
  );
}

function ClubSwitcher({ clubs, current }: { clubs: Club[]; current: Club }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  return (
    <div className="switcher" ref={ref}>
      <button className="button button-quiet" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {t("switch_club")}
      </button>
      {open && (
        <ul className="switcher-list card" id={id} aria-label={t("your_clubs")}>
          {clubs.map((c) => (
            <li key={c.slug}>
              <button
                className="switcher-item"
                type="button"
                aria-current={c.slug === current.slug ? "true" : undefined}
                onClick={() => {
                  store.set({ club: c.slug });
                  setOpen(false);
                }}
              >
                <span>{c.name}</span>
                {c.slug === current.slug && <span className="muted">{t("switch_current")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Shell() {
  const prefs = usePrefs();
  const session = useSession();
  const { clubs, current, config, loading } = useCurrentClub();
  useLook(config);
  const t = useT(config);
  const cls = useWindowClass();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Signed out (here, on another tab's 401, or the token was refused): back to sign-in.
  useEffect(() => {
    if (!prefs.token) void navigate({ to: "/signin", replace: true });
  }, [prefs.token, navigate]);

  const tabs = visibleTabs(config ? config.modules : null);
  const here = tabForPath(pathname);
  // A screen of a module the club has off doesn't exist for this club.
  const gone = !!config && !!here && !tabs.some((x) => x.id === here.id);
  useEffect(() => {
    if (gone) void navigate({ to: "/me", replace: true });
  }, [gone, navigate]);

  if (!prefs.token) return <Splash />;
  if (!config && loading) return <Splash />;

  return (
    <div className="shell" data-window-class={cls} data-nav={navKind(cls)}>
      <header className="shell-head">
        {config?.theme.logoUrl && <img className="club-logo" src={config.theme.logoUrl} alt="" width={40} height={40} />}
        <p className="club-name">{config?.club.name ?? t("brand")}</p>
        {clubs && current && clubs.length > 1 && <ClubSwitcher clubs={clubs} current={current} />}
      </header>
      <nav className="shell-nav" aria-label={t("nav_label")}>
        <ul>
          {tabs.map((tab) => (
            <li key={tab.id}>
              <Link to={tab.path} className="tab" activeProps={{ "aria-current": "page" }}>
                <TabIcon id={tab.id} />
                <span>{t(tab.label)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="shell-main" id="main">
        {prefs.needsDetails && <Notice>{t("needs_details")}</Notice>}
        {current?.status === "disabled" && <Notice tone="error">{t("club_disabled", { club: current.name })}</Notice>}
        {session.isError && !session.data && <Notice tone="error">{t("offline")}</Notice>}
        <Suspense fallback={<Splash />}>{gone ? null : <Outlet />}</Suspense>
        <footer className="shell-foot">
          <OnLuvallplay />
        </footer>
      </main>
    </div>
  );
}
