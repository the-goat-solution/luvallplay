// The Player tab's data: your play stats (the rank card reads the Arena board).
import { useQuery } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, useWho } from "../../hooks.tsx";

export type PlayerStats = ResponseOf<"player.stats">;

export function usePlayerStats() {
  const who = useWho();
  const { current, slug } = useCurrentClub();
  const api = apiForClub(current?.apiBase);
  return useQuery({
    queryKey: ["player-stats", slug, who],
    queryFn: ({ signal }) => api.player.stats({ club: slug as string }, { signal }),
    enabled: !!who && !!slug && !!current,
    staleTime: 60_000,
  });
}
