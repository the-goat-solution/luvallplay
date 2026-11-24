// What screens read: the choices, who is signed in, their clubs, the current
// club and its config, the text.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { api, apiForClub, storage, store } from "./app.ts";
import { pickLang, translator, type Lang, type T } from "./lib/messages.ts";
import type { Prefs } from "./lib/store.ts";
import { resolveMode, type Mode } from "./lib/theme.ts";
import { windowClass, type WindowClass } from "./lib/window-class.ts";

export type ClubConfig = ResponseOf<"clubs.config">;
export type Club = ResponseOf<"clubs.list">["clubs"][number];

export function usePrefs(): Prefs {
  return useSyncExternalStore(store.subscribe, store.get);
}

export function useSession() {
  const { token } = usePrefs();
  return useQuery({ queryKey: ["session", token], queryFn: ({ signal }) => api.auth.session({ signal }), enabled: !!token, staleTime: 5 * 60_000 });
}

export function useClubs() {
  const { token } = usePrefs();
  return useQuery({ queryKey: ["clubs", token], queryFn: ({ signal }) => api.clubs.list({ signal }), enabled: !!token, staleTime: 60_000 });
}

/** The last config seen for a club, so its look is there at once on the next start. */
function remembered(slug: string): ClubConfig | undefined {
  try {
    const raw = storage.get(`config.${slug}`);
    const parsed = raw ? (JSON.parse(raw) as ClubConfig) : undefined;
    return parsed?.club?.slug === slug && parsed.theme?.light && parsed.theme?.dark ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A club's public config (look, modules, terms, money). `apiBase` is the club's own API when known. */
export function useClubConfig(slug: string | null, apiBase?: string) {
  const query = useQuery({
    queryKey: ["config", slug],
    queryFn: ({ signal }) => apiForClub(apiBase).clubs.config({ club: slug as string }, { signal }),
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

/** The person's clubs and the one they are looking at (the stored choice when it is theirs, else the first). */
export function useCurrentClub() {
  const { club: chosen } = usePrefs();
  const clubs = useClubs();
  const list = clubs.data?.clubs ?? null;
  const current = list ? (list.find((c) => c.slug === chosen) ?? list[0] ?? null) : null;
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
  return useMemo(() => translator(lang, terms), [lang, terms]);
}
