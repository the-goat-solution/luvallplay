// The signed-in app: the club's look, its name and logo, the navigation for
// the window's size, the club switcher, and the screen for the current tab.
import { lazy, Suspense, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { storage, store } from "../app.ts";
import { platformOf, storeLinks, storeToOffer } from "../lib/get-app.ts";
import { countOpen } from "../lib/app-opens.ts";
import { LuvallplayMark, Notice, OnLuvallplay, Splash, useLook } from "../Frame.tsx";
import { ClubScopeProvider, useClubConfigs, useClubs, useCurrentClub, useLang, usePrefs, useSession, useT, useWho, useWindowClass, useNavKind, type Club, type ClubConfig } from "../hooks.tsx";
import { isHomePath, moduleForPath, spaceClub, tabForPath, titleKeyForPath, visibleTabs, visibleTabsAcross, type TabId } from "../lib/nav.ts";
import { translator } from "../lib/messages.ts";
import { ClubBadge } from "../components/ClubTag.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useUnread } from "./me/data.ts";
import { focus } from "../lib/focus.ts";
import { online } from "../lib/offline.ts";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { ArenaState } from "./arena/data.ts";
import { useVersus } from "./arena/versus-store.ts";

// Each tab's picture (components/Icon.tsx): Home a house, Player a trophy,
// Arena crossed rackets, Leaderboard a podium, Vision an eye in a camera frame.
const TAB_ICON: Record<TabId, IconName> = { home: "home", player: "trophy", arena: "rackets", leaderboard: "podium", vision: "vision" };

/** The top bar's right side: the inbox bell (unread across clubs) and the person's picture, which opens My profile. */
function TopActions({ clubs, t }: { clubs: Club[] | null; t: ReturnType<typeof useT> }) {
  const session = useSession();
  const unread = useUnread(clubs);
  const p = session.data?.player;
  const initials = p ? `${p.firstName.trim()[0] ?? ""}${p.lastName.trim()[0] ?? ""}`.toUpperCase() || (p.displayName.trim()[0] ?? "").toUpperCase() : "";
  return (
    <div className="top-actions">
      <Link
        to="/inbox"
        className="head-icon"
        aria-label={unread > 0 ? `${t("me_inbox")}, ${t("me_inbox_unread", { n: unread })}` : t("me_inbox")}
        activeProps={{ "aria-current": "page" }}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </Link>
      {/* Named by hidden text, not aria-label: the initials shown aren't words, and a label that doesn't contain what's shown confuses voice control. */}
      <Link to="/profile" className="head-avatar" activeProps={{ "aria-current": "page" }}>
        {p?.avatarUrl ? <img src={p.avatarUrl} alt="" width={36} height={36} /> : initials ? <span aria-hidden="true">{initials}</span> : <Icon name="user" size={20} />}
        <span className="visually-hidden">{t("nav_profile")}</span>
      </Link>
    </div>
  );
}

/**
 * In a club's space (with two or more clubs): the club's crest and name in
 * the top bar, a button that lists the clubs that have this space, to show
 * another. The choice is kept for the next time.
 */
function SpacePicker({ clubs, current, configOf, module }: { clubs: Club[]; current: Club; configOf: (c: Club) => ClubConfig | null; module: string | null }) {
  const t = useT(configOf(current));
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const choices = clubs.filter((c) => module === null || (configOf(c)?.modules.includes(module) ?? false));
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
  const config = configOf(current);
  const head = (
    <>
      {config?.theme.logoUrl ? <img className="club-logo" src={config.theme.logoUrl} alt="" width={40} height={40} /> : <ClubBadge club={current} config={config} size="head" />}
      <span className="club-name">{current.name}</span>
    </>
  );
  if (choices.length < 2) return <div className="space-title">{head}</div>;
  return (
    <div className="switcher space-picker" ref={ref}>
      <button className="space-title space-button" type="button" aria-label={`${current.name}, ${t("switch_club")}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {head}
        <Icon name="chevronDown" size={18} className="chevron" />
      </button>
      {open && (
        <ul className="switcher-list card" id={id} aria-label={t("your_clubs")}>
          {choices.map((c) => (
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
                <ClubBadge club={c} config={configOf(c)} />
                <span className="switcher-name">{c.name}</span>
                {c.slug === current.slug && (
                  <Icon name="check" size={18} className="switcher-check" label={t("switch_current")} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** On the other tabs: back to an accepted game whose "versus" splash was put off (from the board already loaded; never fetched here). */
function MatchPill({ slug, who, t }: { slug: string | null; who: string | null; t: ReturnType<typeof useT> }) {
  const board = useQuery<ArenaState>({ queryKey: ["arena", slug, who], queryFn: skipToken });
  const versus = useVersus(board.data);
  if (!versus.later) return null;
  return (
    <Link to="/arena" className="match-pill" data-testid="match-pill">
      <span className="match-pill-vs" aria-hidden="true">VS</span>
      <span>{t("match_waiting")}</span>
    </Link>
  );
}

const GetTheApp = lazy(() => import("../components/GetTheApp.tsx"));

/** On a phone's browser, every fifth open, once the store app is live: offer it (lib/get-app.ts). */
function useAppOffer() {
  const [offer] = useState(() => {
    const platform = platformOf(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    const link = storeToOffer({
      platform,
      installedWebApp: window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
      storeApp: "Capacitor" in window,
      opens: countOpen(storage),
      links: storeLinks(import.meta.env.VITE_APP_STORE_URL, import.meta.env.VITE_PLAY_STORE_URL),
    });
    return link && platform ? { link, platform } : null;
  });
  const [open, setOpen] = useState(false);
  // A moment after the screen is up, not over the first paint.
  useEffect(() => {
    if (!offer) return;
    const timer = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(timer);
  }, [offer]);
  return { offer: open ? offer : null, close: () => setOpen(false) };
}

export function Shell() {
  const appOffer = useAppOffer();
  const prefs = usePrefs();
  const who = useWho();
  const focused = useSyncExternalStore(focus.subscribe, focus.get);
  const connected = useSyncExternalStore(online.subscribe, online.get);
  const session = useSession();
  const { clubs, current, config: currentConfig, loading } = useCurrentClub();
  const configs = useClubConfigs(clubs);
  const clubsQuery = useClubs();
  const lang = useLang();
  const cls = useWindowClass();
  const nav = useNavKind();
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

  // One club: it is the app's, everywhere. Two or more: Home is all of them
  // in Luvallplay's look; a club space is one club, in its look.
  const list = clubs ?? [];
  const multi = list.length > 1;
  const home = isHomePath(pathname);
  const configOf = (c: Club): ClubConfig | null => configs[list.indexOf(c)] ?? null;
  const modulesOf = (c: Club) => configOf(c)?.modules ?? null;
  const space = multi && !home ? spaceClub(list, modulesOf, prefs.club, moduleForPath(pathname)) : null;
  const scopeClub = multi ? space : current;
  const config = multi ? (space ? configOf(space) : null) : currentConfig;
  const t = useT(config);
  // The tab's title names the screen, and a new screen takes the focus (so a
  // screen reader starts at its content, not at the tab that was tapped).
  const titleKey = titleKeyForPath(pathname);
  useLook(config, titleKey ? t(titleKey) : undefined);
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    // Only when something was activated to get here (a tab, a link): a
    // redirect while the app opens leaves the keyboard's start where it is.
    if (document.activeElement && document.activeElement !== document.body) mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  // In no club yet: Home explains, and there are no club tabs to show.
  const noClub = !!clubs && list.length === 0;
  const tabs = noClub ? [] : multi ? visibleTabsAcross(list.map(modulesOf)) : visibleTabs(currentConfig ? currentConfig.modules : null);
  // Each tab in its club's words ("Wolf Vision" is a club's name for Vision).
  const tabLabel = (tab: (typeof tabs)[number]) => {
    if (!multi) return t(tab.label);
    const target = spaceClub(list, modulesOf, prefs.club, tab.module);
    return translator(lang, (target && configOf(target)?.terms) || null)(tab.label);
  };
  const here = tabForPath(pathname);
  // A screen of a module the club (or, with several, every club) has off doesn't exist.
  const known = multi ? configs.length > 0 && configs.every((c) => c !== null) : !!currentConfig;
  const gone = (noClub && !home) || (known && !!here && !tabs.some((x) => x.id === here.id));
  // The Arena's "your match is on" pill: the club whose Arena would open.
  const arenaClub = multi ? spaceClub(list, modulesOf, prefs.club, "arena") : current;
  const arenaOn = !!arenaClub && !!(multi ? configOf(arenaClub) : currentConfig)?.modules.includes("arena");
  useEffect(() => {
    if (gone) void navigate({ to: "/home", replace: true });
  }, [gone, navigate]);

  if (!prefs.token) return <Splash />;
  // Wait for the list of clubs (it's saved on the device, so this is normally at once):
  // one club or several decides what Home is, and nothing should flip after it shows.
  if (clubsQuery.isPending || (!multi && !currentConfig && loading)) return <Splash />;

  // A club's space whose club isn't known yet (its config is loading): the mark, not another club's screen.
  const waiting = multi && !home && !space && !known;
  const screen = waiting ? <Splash /> : <Suspense fallback={<Splash />}>{gone ? null : <Outlet />}</Suspense>;

  return (
    <div className="shell" data-tabs={noClub ? "none" : undefined} data-window-class={cls} data-nav={nav} data-focus={focused ? "on" : undefined}>
      <a className="skip-link" href="#main">{t("skip_to_content")}</a>
      <header className="shell-head" data-space={multi ? (home ? "home" : "club") : undefined}>
        {multi && home ? (
          <p className="space-title">
            <LuvallplayMark size={30} brand />
            <span className="club-name">{t("brand")}</span>
          </p>
        ) : multi && space ? (
          <SpacePicker clubs={list} current={space} configOf={configOf} module={moduleForPath(pathname)} />
        ) : (
          <>
            {config?.theme.logoUrl ? <img className="club-logo" src={config.theme.logoUrl} alt="" width={40} height={40} /> : !config && <LuvallplayMark size={30} brand />}
            <p className="club-name">{config?.club.name ?? t("brand")}</p>
          </>
        )}
        <TopActions clubs={clubs} t={t} />
      </header>
      {!noClub && (
        <nav className="shell-nav" aria-label={t("nav_label")}>
          <ul>
            {tabs.map((tab) => (
              <li key={tab.id}>
                <Link to={tab.path} className="tab" activeProps={{ "aria-current": "page" }}>
                  <Icon name={TAB_ICON[tab.id]} />
                  <span>{tabLabel(tab)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main className="shell-main" id="main" tabIndex={-1} ref={mainRef}>
        {arenaOn && !pathname.startsWith("/arena") && <MatchPill slug={arenaClub?.slug ?? null} who={who} t={t} />}
        {prefs.needsDetails && !onWelcome && (
          <Notice>
            {t("needs_details")} <Link to="/welcome">{t("needs_details_link")}</Link>
          </Notice>
        )}
        {scopeClub?.status === "disabled" && <Notice tone="error">{t("club_disabled", { club: scopeClub.name })}</Notice>}
        {!connected ? <Notice>{t("offline_saved")}</Notice> : session.isError && !session.data && <Notice tone="error">{t("offline")}</Notice>}
        {scopeClub ? <ClubScopeProvider club={scopeClub}>{screen}</ClubScopeProvider> : screen}
        {/* "on Luvallplay" under a club's look; in Luvallplay's own it would say nothing. */}
        {config && (
          <footer className="shell-foot">
            <OnLuvallplay />
          </footer>
        )}
        {appOffer.offer && !focused && (
          <Suspense fallback={null}>
            <GetTheApp link={appOffer.offer.link} platform={appOffer.offer.platform} onClose={appOffer.close} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
