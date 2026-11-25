// The Player tab's data: your play stats (the rank card reads the Arena board).
import { useQuery } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, usePrefs } from "../../hooks.tsx";

export type PlayerStats = ResponseOf<"player.stats">;

export function usePlayerStats() {
  const { token } = usePrefs();
  const { current, slug } = useCurrentClub();
  const api = apiForClub(current?.apiBase);
  return useQuery({
    queryKey: ["player-stats", slug, token],
    queryFn: ({ signal }) => api.player.stats({ club: slug as string }, { signal }),
    enabled: !!token && !!slug && !!current,
    staleTime: 60_000,
  });
}
