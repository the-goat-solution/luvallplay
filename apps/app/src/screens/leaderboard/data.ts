// The Leaderboard's data: the board for a source and period, and a player's card.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { QueryOf, ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, useWho } from "../../hooks.tsx";

export type Board = ResponseOf<"leaderboard.board">;
export type BoardRow = Board["rows"][number];
export type BoardQuery = NonNullable<QueryOf<"leaderboard.board">>;
export type Card = ResponseOf<"leaderboard.player">["card"];

function useClubApi() {
  const who = useWho();
  const { current, slug, config } = useCurrentClub();
  const on = !!config && config.modules.includes("arena");
  return { who, slug: slug as string, ready: !!who && !!slug && !!current && on, api: apiForClub(current?.apiBase) };
}

export function useBoard(q: BoardQuery) {
  const { who, slug, ready, api } = useClubApi();
  return useQuery({
    queryKey: ["leaderboard", slug, who, q.source ?? "all", q.period ?? "lifetime", q.key ?? ""],
    queryFn: ({ signal }) => api.leaderboard.board({ club: slug }, q, { signal }),
    enabled: ready,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function usePlayerCard(id: number | null) {
  const { who, slug, ready, api } = useClubApi();
  return useQuery({
    queryKey: ["player-card", slug, who, id],
    queryFn: ({ signal }) => api.leaderboard.player({ club: slug, id: id as number }, { signal }),
    enabled: ready && id !== null,
    staleTime: 10_000,
  });
}
