// The Vision tab's data: the trial or a pass, a challenge to track, and saving labels.
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BodyOf, ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, usePrefs } from "../../hooks.tsx";

export type VisionStatus = ResponseOf<"vision.status">;
export type VisionChallenge = ResponseOf<"vision.challenge">;

function useClubApi() {
  const { token } = usePrefs();
  const { current, slug, config } = useCurrentClub();
  const on = !!config && config.modules.includes("vision");
  return { token, slug: slug as string, ready: !!token && !!slug && !!current && on, api: apiForClub(current?.apiBase) };
}

export function useVisionStatus() {
  const { token, slug, ready, api } = useClubApi();
  return useQuery({ queryKey: ["vision", "status", slug, token], queryFn: ({ signal }) => api.vision.status({ club: slug }, {}, { signal }), enabled: ready, staleTime: 60_000 });
}

export function useVisionChallenge(id: number | null) {
  const { token, slug, ready, api } = useClubApi();
  return useQuery({ queryKey: ["vision", "challenge", slug, token, id], queryFn: ({ signal }) => api.vision.challenge({ club: slug, id: id as number }, { signal }), enabled: ready && id !== null, retry: false });
}

export function useSaveLabels() {
  const { slug, api } = useClubApi();
  return useMutation({ mutationFn: (body: BodyOf<"vision.labels">) => api.vision.labels({ club: slug }, body) });
}
