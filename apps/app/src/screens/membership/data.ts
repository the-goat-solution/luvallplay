// Membership self-service data: the membership and its prices, billing
// (from Stripe, loaded after the screen), one change at a time, the card
// portal, joining, and booking a casual spot. Every change refreshes Me too.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BodyOf, ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, useWho } from "../../hooks.tsx";

export type MembershipState = ResponseOf<"membership.state">;
export type Member = NonNullable<MembershipState["membership"]>;
export type Billing = ResponseOf<"membership.billing">;
export type Day = MembershipState["days"][number];
export type Plan = Member["plan"];

function useClubApi() {
  const who = useWho();
  const { current, slug, config } = useCurrentClub();
  const on = !!config && config.modules.includes("memberships");
  return { who, slug: slug as string, ready: !!who && !!slug && !!current, on, api: apiForClub(current?.apiBase) };
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["membership"] });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  };
}

export function useMembership() {
  const { who, slug, ready, on, api } = useClubApi();
  return useQuery({ queryKey: ["membership", "state", slug, who], queryFn: ({ signal }) => api.membership.state({ club: slug }, { signal }), enabled: ready && on });
}

export function useBilling(enabled: boolean) {
  const { who, slug, ready, on, api } = useClubApi();
  return useQuery({ queryKey: ["membership", "billing", slug, who], queryFn: ({ signal }) => api.membership.billing({ club: slug }, { signal }), enabled: ready && on && enabled, retry: false });
}

export function useMembershipAction() {
  const { slug, api } = useClubApi();
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: BodyOf<"membership.action">) => api.membership.action({ club: slug }, body), onSuccess: refresh });
}

export function usePortal() {
  const { slug, api } = useClubApi();
  return useMutation({ mutationFn: () => api.membership.portal({ club: slug }, {}) });
}

export function useJoin() {
  const { slug, api } = useClubApi();
  return useMutation({ mutationFn: (body: BodyOf<"membership.join">) => api.membership.join({ club: slug }, body) });
}

export function useBook() {
  const { slug, api } = useClubApi();
  return useMutation({ mutationFn: (date: string) => api.play.book({ club: slug }, { date }) });
}

/** After a payment: the webhook finishes the job a moment later, so look again shortly. */
export function useRefreshSoon() {
  const refresh = useRefresh();
  return (ms = 2500) => window.setTimeout(refresh, ms);
}
