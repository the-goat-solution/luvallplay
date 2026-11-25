// The Arena's data: the board, refreshed every 5 seconds while the tab is
// on screen (as on the website; TanStack pauses it in the background and
// refreshes on return), and one action at a time, which answers with the
// fresh board. A refused action fetches the board again.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BodyOf, ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, usePrefs } from "../../hooks.tsx";

export type ArenaState = ResponseOf<"arena.state">;
export type Challenge = ArenaState["live"][number];
export type Pair = Challenge["posting"];
export type Chip = Pair["players"][number];
export type ArenaAction = BodyOf<"arena.action">;

const POLL_MS = 5_000;

function useArenaApi() {
  const { token } = usePrefs();
  const { current, slug, config } = useCurrentClub();
  // Only for a club with the Arena on (switching to one without it leaves this screen).
  const on = !!config && config.modules.includes("arena");
  return { key: ["arena", slug, token] as const, slug: slug as string, ready: !!token && !!slug && !!current && on, api: apiForClub(current?.apiBase) };
}

export function useArena() {
  const { key, slug, ready, api } = useArenaApi();
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api.arena.state({ club: slug }, { signal }), enabled: ready, refetchInterval: POLL_MS, staleTime: 2_000 });
}

export function useArenaAction() {
  const { key, slug, api } = useArenaApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: ArenaAction) => api.arena.action({ club: slug }, action),
    onSuccess: (r) => queryClient.setQueryData(key, r.state),
    onError: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** The error code of a refused action (the Arena's own, e.g. bad_code), for err_<code>. */
export function errorCode(err: unknown): string {
  const e = err as { code?: string; status?: number; offline?: boolean } | null;
  if (e?.offline) return "offline";
  if (e?.status === 401) return "signed_out";
  return e?.code ?? "generic";
}

export const pairTitle = (p: Pair) => p.name || `${p.players[0].name} & ${p.players[1].name}`;

/** A game's tracked stats (opened from the feed). */
export function useMatchStats(id: number) {
  const { slug, ready, api } = useArenaApi();
  return useQuery({ queryKey: ["arena-stats", slug, id], queryFn: ({ signal }) => api.arena.matchStats({ club: slug, id }, { signal }), enabled: ready, retry: false, staleTime: 60_000 });
}
