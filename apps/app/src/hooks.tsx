// What screens read: the choices, who is signed in, their clubs, the current
// club and its config, the text.
import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { api, apiForClub, storage, store } from "./app.ts";
import { ownerOf } from "./lib/offline.ts";
import { langs, loadLang, pickLang, translator, type Lang, type T } from "./lib/messages.ts";
import type { Prefs } from "./lib/store.ts";
import { resolveMode, type Mode } from "./lib/theme.ts";
import { withProductRules } from "./lib/modules.ts";
import { windowClass, type WindowClass } from "./lib/window-class.ts";

export type ClubConfig = ResponseOf<"clubs.config">;
export type Club = ResponseOf<"clubs.list">["clubs"][number];

export function usePrefs(): Prefs {
  return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * Whose data a query holds: a fingerprint of the session, or null when signed
 * out. Query keys carry this, never the session token itself, because keys
 * are written to the saved screens (lib/offline.ts) and show up in errors
 * and dev tools.
 */
export function useWho(): string | null {
  const { token } = usePrefs();
  return useMemo(() => (token ? ownerOf(token) : null), [token]);
}

export function useSession() {
  const who = useWho();
  return useQuery({ queryKey: ["session", who], queryFn: ({ signal }) => api.auth.session({ signal }), enabled: !!who, staleTime: 5 * 60_000 });
}

export function useClubs() {
  const who = useWho();
  return useQuery({ queryKey: ["clubs", who], queryFn: ({ signal }) => api.clubs.list({ signal }), enabled: !!who, staleTime: 60_000 });
}

/** The last config seen for a club, so its look is there at once on the next start. */
function remembered(slug: string): ClubConfig | undefined {
  try {
    const raw = storage.get(`config.${slug}`);
    const parsed = raw ? (JSON.parse(raw) as ClubConfig) : undefined;
    return parsed?.club?.slug === slug && parsed.theme?.light && parsed.theme?.dark && Array.isArray(parsed.modules) ? withProductRules({ ...parsed, club: { ...parsed.club, sports: parsed.club.sports ?? [] } }) : undefined;
  } catch {
    return undefined;
  }
}

/** A club's public config (look, modules, terms, money). `apiBase` is the club's own API when known. */
export function useClubConfig(slug: string | null, apiBase?: string) {
  const query = useQuery({
    queryKey: ["config", slug],
    queryFn: async ({ signal }) => withProductRules(await apiForClub(apiBase).clubs.config({ club: slug as string }, { signal })),
    enabled: !!slug,
    staleTime: 60_000,
    initialData: () => (slug ? remembered(slug) : undefined),
    initialDataUpdatedAt: 0,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
  useEffect(() => {
    if (slug && query.data && query.dataUpdatedAt > 0) storage.set(`config.${slug}`, JSON.stringify(query.data));
  }, [slug, query.data, query.dataUpdatedAt]);
  return query;
}

// ── Several clubs ────────────────────────────────────────────────────────
// A person in two or more clubs sees Home (Me, the inbox, Settings) for all
// of them at once, in Luvallplay's look, each item labelled with its club;
// a club's own spaces (Player, Arena, Leaderboard, Vision, Membership) show
// one club, in its look, picked in the top bar. With one club nothing of
// this shows: the app is that club's, everywhere.

/** A part of the screen that belongs to one club: everything inside it (data, words, money, actions) is that club's. */
const ClubScope = createContext<Club | null>(null);

export function ClubScopeProvider({ club, children }: { club: Club; children: ReactNode }) {
  return createElement(ClubScope.Provider, { value: club }, children);
}

/** The club of the part of the screen this is in, or null outside one. */
export function useScopeClub(): Club | null {
  return useContext(ClubScope);
}

/** Two or more clubs: Home brings them together. */
export function useMultiClub(): boolean {
  const clubs = useClubs();
  return (clubs.data?.clubs.length ?? 0) > 1;
}

/** Every club's config, in the order of the list (null while one is loading). */
export function useClubConfigs(clubs: readonly Club[] | null): (ClubConfig | null)[] {
  const results = useQueries({
    queries: (clubs ?? []).map((c) => ({
      queryKey: ["config", c.slug],
      queryFn: async ({ signal }: { signal: AbortSignal }) => withProductRules(await apiForClub(c.apiBase).clubs.config({ club: c.slug }, { signal })),
      staleTime: 60_000,
      initialData: () => remembered(c.slug),
      initialDataUpdatedAt: 0,
    })),
  });
  return results.map((r) => r.data ?? null);
}

/**
 * The person's clubs and the one they are looking at: the club of the part
 * of the screen this is in, else the stored choice when it is theirs, else
 * the first.
 */
export function useCurrentClub() {
  const scope = useContext(ClubScope);
  const { club: chosen } = usePrefs();
  const clubs = useClubs();
  const list = clubs.data?.clubs ?? null;
  const current = scope ?? (list ? (list.find((c) => c.slug === chosen) ?? list[0] ?? null) : null);
  // Before the list arrives, the stored choice already gives the look.
  const slug = current?.slug ?? chosen;
  const config = useClubConfig(slug, current?.apiBase);
  return { clubs: list, current, slug, config: config.data ?? null, loading: clubs.isPending || (!!slug && config.isPending) };
}

export function useSystemDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

export function useMode(): Mode {
  return resolveMode(usePrefs().theme, useSystemDark());
}

export function useWindowClass(): WindowClass {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => windowClass(window.innerWidth),
  );
}

export function useLang(): Lang {
  const { lang } = usePrefs();
  const session = useSession();
  return pickLang(lang, session.data?.player.lang, typeof navigator === "undefined" ? null : navigator.language);
}

/** The translator for the person's language. Pass the club's config to use the club's own words. */
export function useT(config?: ClubConfig | null): T {
  const lang = useLang();
  const terms = config?.terms ?? null;
  // The language's text may still be on its way (lib/messages.ts): asked for here, drawn again when it lands.
  const ready = useSyncExternalStore(langs.subscribe, () => langs.ready(lang));
  useEffect(() => {
    if (!ready) void loadLang(lang).catch(() => {});
  }, [lang, ready]);
  return useMemo(() => translator(lang, terms), [lang, terms, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Going from Home into a club's own page: that club becomes the one shown there. */
export function useEnterClub(): () => void {
  const scope = useContext(ClubScope);
  return () => {
    if (scope) store.set({ club: scope.slug });
  };
}
