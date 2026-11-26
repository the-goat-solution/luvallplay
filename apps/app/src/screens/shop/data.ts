// The club shop's data: products and your orders; ordering, confirming a
// card payment, cancelling. Every change refreshes the shop.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, useWho } from "../../hooks.tsx";

export type Shop = ResponseOf<"shop.list">;
export type Product = Shop["products"][number];
export type Order = Shop["orders"][number];

function useShopApi() {
  const who = useWho();
  const { current, slug, config } = useCurrentClub();
  const on = !!config && config.modules.includes("shop");
  return { key: ["shop", slug, who] as const, slug: slug as string, ready: !!who && !!slug && !!current && on, api: apiForClub(current?.apiBase) };
}

export function useShop() {
  const { key, slug, ready, api } = useShopApi();
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api.shop.list({ club: slug }, { signal }), enabled: ready, staleTime: 30_000 });
}

export function useShopActions() {
  const { key, slug, api } = useShopApi();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const order = useMutation({ mutationFn: (v: { variantId: number; method: "card" | "cash" }) => api.shop.order({ club: slug }, v), onSettled: refresh });
  const confirm = useMutation({ mutationFn: (id: number) => api.shop.confirm({ club: slug, id }, {}), onSettled: refresh });
  const cancel = useMutation({ mutationFn: (id: number) => api.shop.cancel({ club: slug, id }, {}), onSettled: refresh });
  return { order, confirm, cancel };
}
