// Home for a person in two or more clubs (hooks.tsx explains the idea):
// every club's Home brought together, in Luvallplay's look. Each card and
// row carries its club's tag and acts on its club (it sits in that club's
// scope), so a "Can't make it", a booking or a payment always goes to the
// right one. Memberships and photos are in My profile.
//
// - The filter: all clubs, or one; remembered on this device.
// - Next up: the next play day across clubs.
// - The way in, for a club they aren't a member of yet.
// - The calendar: every club's days in one list.
// - Messages: the latest conversations across clubs.
// - Each club's shop, for the clubs that have one.
// Each club's Me is the same query as when that club is shown on its own, so
// they share the cache (and the saved copy for offline).
import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { apiForClub, store } from "../../app.ts";
import { ClubScopeProvider, useClubConfigs, usePrefs, useSession, useT, type Club, type ClubConfig } from "../../hooks.tsx";
import { latestThreads, mergeCalendars, nextAcross } from "../../lib/home.ts";
import { ClubTag } from "../../components/ClubTag.tsx";
import { LoadError } from "../../components/LoadError.tsx";
import { meKey, type Me } from "./data.ts";
import { JoinCard } from "./Membership.tsx";
import { Greeting } from "../../components/Greeting.tsx";
import { HomeLoading } from "../Home.tsx";
import { NextUp } from "./NextUp.tsx";
import { CalendarCard } from "./PlayCalendar.tsx";
import { WelcomeCard } from "./Welcome.tsx";
import { ShopSection } from "../shop/ShopSection.tsx";

type T = ReturnType<typeof useT>;
type Loaded = { club: Club; config: ClubConfig | null; me: Me };

function Filter({ clubs, configs, chosen, t }: { clubs: Club[]; configs: (ClubConfig | null)[]; chosen: string | null; t: T }) {
  return (
    <div className="club-filter" role="group" aria-label={t("home_filter")}>
      <button type="button" className="chip-button" aria-pressed={chosen === null} onClick={() => store.set({ homeClub: null })}>
        {t("home_all_clubs")}
      </button>
      {clubs.map((c, i) => (
        <button key={c.slug} type="button" className="chip-button chip-club" aria-pressed={chosen === c.slug} onClick={() => store.set({ homeClub: c.slug })}>
          <ClubTag club={c} config={configs[i]} />
        </button>
      ))}
    </div>
  );
}

function Messages({ loaded, t }: { loaded: Loaded[]; t: T }) {
  const id = useId();
  const threads = latestThreads(loaded.map((l) => ({ club: l, threads: l.me.inbox.latest })), 4);
  return (
    <section className="card stack" aria-labelledby={id}>
      <h2 id={id}>{t("me_inbox_preview")}</h2>
      {threads.length === 0 ? (
        <p className="muted">{t("home_inbox_none")}</p>
      ) : (
        <ul className="threads">
          {threads.map(({ club: l, item: th }) => (
            <li key={`${l.club.slug}:${th.id}`} className={th.unread ? "thread unread" : "thread"}>
              <Link className="thread-link" to="/inbox/$id" params={{ id: String(th.id) }} search={{ club: l.club.slug }}>
                <ClubTag club={l.club} config={l.config} quiet />
                <strong>
                  {th.unread && <span className="unread-dot" aria-hidden="true" />}
                  {th.subject}
                  {th.unread && <span className="visually-hidden"> ({t("msg_new_badge")})</span>}
                </strong>
                <span className="muted small thread-preview">{th.preview}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/inbox" className="button">
        {t("me_inbox_open")}
      </Link>
    </section>
  );
}

export function AllClubsHome({ clubs }: { clubs: Club[] }) {
  const { token, homeClub } = usePrefs();
  const session = useSession();
  const t = useT(null);
  const configs = useClubConfigs(clubs);
  const results = useQueries({
    queries: clubs.map((c) => ({
      queryKey: meKey(c.slug, token),
      queryFn: ({ signal }: { signal: AbortSignal }) => apiForClub(c.apiBase).me.home({ club: c.slug }, { signal }),
      enabled: !!token,
      staleTime: 30_000,
    })),
  });

  const settled = results.every((r) => r.data || r.isError);
  const all: Loaded[] = clubs.flatMap((club, i) => (results[i].data ? [{ club, config: configs[i], me: results[i].data as Me }] : []));
  const failed = clubs.filter((_, i) => !results[i].data && results[i].isError);
  // A filter for a club the person has left: all clubs again.
  const chosen = homeClub && clubs.some((c) => c.slug === homeClub) ? homeClub : null;
  const shown = chosen ? all.filter((l) => l.club.slug === chosen) : all;

  if (!settled || all.length === 0) {
    const retry = () => results.forEach((r) => r.isError && void r.refetch());
    return (
      <section className="screen stack" data-screen="nav_home" data-state={settled ? "error" : "loading"}>
        {settled ? <LoadError onRetry={retry} /> : <HomeLoading />}
      </section>
    );
  }

  const next = nextAcross(shown.map((l) => ({ club: l, calendar: l.me.calendar })));
  const rows = mergeCalendars(shown.map((l) => ({ club: l, calendar: l.me.calendar }))).map(({ club: l, item }) => ({ club: l.club, day: item, casualPrice: l.me.casualPrice }));
  const welcome = all.find((l) => l.me.welcome);

  return (
    <section className="screen stack" data-screen="nav_home" data-state="ready" data-home="clubs">
      <Greeting firstName={session.data?.player.firstName ?? all[0].me.player.firstName} />
      <Filter clubs={clubs} configs={configs} chosen={chosen} t={t} />
      {clubs.filter((c) => c.status === "disabled" && (!chosen || c.slug === chosen)).map((c) => (
        <p key={c.slug} className="notice notice-error" role="status">{t("club_disabled", { club: c.name })}</p>
      ))}
      {failed.filter((c) => !chosen || c.slug === chosen).map((c) => (
        <ClubScopeProvider key={c.slug} club={c}>
          <div className="stack-tight">
            <ClubTag club={c} config={configs[clubs.indexOf(c)]} />
            <LoadError compact onRetry={() => void results[clubs.indexOf(c)].refetch()} />
          </div>
        </ClubScopeProvider>
      ))}
      <div className="me-grid">
        <div className="stack">
          {next ? (
            <ClubScopeProvider club={next.club.club}>
              <NextUp day={next.item} />
            </ClubScopeProvider>
          ) : (
            <NextUp day={null} />
          )}
          {shown.map((l) =>
            !l.me.membership && l.me.join ? (
              <ClubScopeProvider key={l.club.slug} club={l.club}>
                <JoinCard join={l.me.join} />
              </ClubScopeProvider>
            ) : null,
          )}
          <CalendarCard rows={rows} sub={t("home_cal_sub")} />
        </div>
        <div className="stack">
          <Messages loaded={shown} t={t} />
          {welcome && (!chosen || welcome.club.slug === chosen) && (
            <ClubScopeProvider club={welcome.club}>
              <WelcomeCard firstName={welcome.me.player.firstName} />
            </ClubScopeProvider>
          )}
          {shown.map((l) => (
            <ClubScopeProvider key={l.club.slug} club={l.club}>
              <ShopSection />
            </ClubScopeProvider>
          ))}
        </div>
      </div>
    </section>
  );
}
