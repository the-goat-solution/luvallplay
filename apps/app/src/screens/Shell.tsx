// The signed-in app: the club's look, its name and logo, the navigation for
// the window's size, the club switcher, and the screen for the current tab.
import { Suspense, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { store } from "../app.ts";
import { Notice, OnLuvallplay, Splash, useLook } from "../Frame.tsx";
import { useCurrentClub, usePrefs, useSession, useT, useWindowClass, type Club } from "../hooks.tsx";
import { tabForPath, visibleTabs, type TabId } from "../lib/nav.ts";
import { navKind } from "../lib/window-class.ts";
import { focus } from "../lib/focus.ts";

// The same pictures as the website's tabs: Player a trophy, Arena crossed
// rackets, Leaderboard a podium.
const ICONS: Record<TabId, string> = {
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  player: "M7 4h10v4a5 5 0 0 1-10 0V4Zm5 9v4m-4 3h8M7 6H4a3 3 0 0 0 3 4m10-4h3a3 3 0 0 1-3 4",
  arena: "M4 4l9 9M20 4l-9 9M11 15l-5 5M13 15l5 5M3.5 3.5a2.4 3.2 -45 1 0 4.2 4.2a2.4 3.2 -45 1 0-4.2-4.2ZM16.3 3.5a2.4 3.2 45 1 0 4.2 4.2a2.4 3.2 45 1 0-4.2-4.2Z",
  leaderboard: "M3 21h18M9 21V8h6v13M3 21v-8h6M15 21V11h6v10",
  vision: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
};
const SETTINGS_ICON =
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3 2-1-2-4-2 1-2-1-.5-2h-4L11 6 9 7 7 6 5 10l2 1v2l-2 1 2 4 2-1 2 1 .5 2h4l.5-2 2-1 2 1 2-4-2-1Z";


function Icon({ d }: { d: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
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
  const focused = useSyncExternalStore(focus.subscribe, focus.get);
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
  // A name saved anywhere (here, in Settings or on the website) ends the reminder.
  const named = !!session.data?.player.firstName.trim();
  useEffect(() => {
    if (prefs.needsDetails && named) store.set({ needsDetails: false });
  }, [prefs.needsDetails, named]);
  const onWelcome = pathname === "/welcome";

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
    <div className="shell" data-window-class={cls} data-nav={navKind(cls)} data-focus={focused ? "on" : undefined}>
      <header className="shell-head">
        {config?.theme.logoUrl && <img className="club-logo" src={config.theme.logoUrl} alt="" width={40} height={40} />}
        <p className="club-name">{config?.club.name ?? t("brand")}</p>
        {clubs && current && clubs.length > 1 && <ClubSwitcher clubs={clubs} current={current} />}
        <Link to="/settings" className="head-icon" aria-label={t("nav_settings")} activeProps={{ "aria-current": "page" }}>
          <Icon d={SETTINGS_ICON} />
        </Link>
      </header>
      <nav className="shell-nav" aria-label={t("nav_label")}>
        <ul>
          {tabs.map((tab) => (
            <li key={tab.id}>
              <Link to={tab.path} className="tab" activeProps={{ "aria-current": "page" }}>
                <Icon d={ICONS[tab.id]} />
                <span>{t(tab.label)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="shell-main" id="main">
        {prefs.needsDetails && !onWelcome && (
          <Notice>
            {t("needs_details")} <Link to="/welcome">{t("needs_details_link")}</Link>
          </Notice>
        )}
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
