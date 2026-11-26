// The Family section's data: the guardian's own children in the club shown,
// adding one, correcting one, and what the guardian allows for each.
//
// Asked for only when the club's modules list Juniors. The server decides
// again on every request (it fails closed), so a stale list can't show a
// child's data: the answer is then 404 and the section says it is off.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BodyOf, ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, usePrefs } from "../../hooks.tsx";

export type Family = ResponseOf<"family.list">;
export type Child = Family["children"][number];
export type Consent = Child["consent"];
export const CONSENT_ITEMS = ["leaderboard", "photos", "vision"] as const;

export function useFamilyOn(): boolean {
  const { config } = useCurrentClub();
  return !!config && config.modules.includes("juniors");
}

function useClubApi() {
  const { token } = usePrefs();
  const { current, slug } = useCurrentClub();
  const on = useFamilyOn();
  return { token, slug: slug as string, ready: !!token && !!slug && !!current && on, api: apiForClub(current?.apiBase) };
}

export function useFamily() {
  const { token, slug, ready, api } = useClubApi();
  return useQuery({ queryKey: ["family", slug, token], queryFn: ({ signal }) => api.family.list({ club: slug }, { signal }), enabled: ready, retry: false });
}

function useSetChild() {
  const { token, slug } = useClubApi();
  const queryClient = useQueryClient();
  return (child: Child) =>
    queryClient.setQueryData<Family>(["family", slug, token], (f) =>
      f ? { ...f, children: f.children.some((c) => c.id === child.id) ? f.children.map((c) => (c.id === child.id ? child : c)) : [...f.children, child] } : f,
    );
}

export function useAddChild() {
  const { slug, api } = useClubApi();
  const set = useSetChild();
  return useMutation({ mutationFn: (body: BodyOf<"family.add">) => api.family.add({ club: slug }, body), onSuccess: (r) => set(r.child) });
}

export function useUpdateChild(id: number) {
  const { slug, api } = useClubApi();
  const set = useSetChild();
  return useMutation({ mutationFn: (body: BodyOf<"family.update">) => api.family.update({ club: slug, id }, body), onSuccess: (r) => set(r.child) });
}

export function useSetConsent(id: number) {
  const { slug, api } = useClubApi();
  const set = useSetChild();
  return useMutation({ mutationFn: (body: BodyOf<"family.consent">) => api.family.consent({ club: slug, id }, body), onSuccess: (r) => set(r.child) });
}
