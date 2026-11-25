// The Me tab's data: one query for the whole screen (so it opens from the
// cache at once), and its two changes, applied on screen straight away and
// put back if the club's server refuses them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { apiForClub, storage } from "../../app.ts";
import { useCurrentClub, usePrefs } from "../../hooks.tsx";
import { enqueue } from "../../lib/offline.ts";

export type Me = ResponseOf<"me.home">;
export type PlayDay = Me["calendar"][number];

export const meKey = (slug: string | null, token: string | null) => ["me", slug, token] as const;

export function useMe() {
  const { token } = usePrefs();
  const { current, slug } = useCurrentClub();
  const query = useQuery({
    queryKey: meKey(slug, token),
    queryFn: ({ signal }) => apiForClub(current?.apiBase).me.home({ club: slug as string }, { signal }),
    enabled: !!token && !!slug && !!current,
    staleTime: 30_000,
  });
  return { ...query, apiBase: current?.apiBase, slug };
}

/**
 * "Can't make it" and "I can come after all": the day flips (and its spot
 * frees up) before the server answers. Without a connection the change
 * waits on this device (`queued: true`) and is sent when it's back.
 */
export function useAbsence() {
  const { token } = usePrefs();
  const { current, slug } = useCurrentClub();
  const queryClient = useQueryClient();
  const key = meKey(slug, token);
  return useMutation({
    // Runs offline too: the change is queued rather than paused in memory.
    networkMode: "always",
    mutationFn: async (v: { date: string; absent: boolean }): Promise<{ queued: boolean }> => {
      const later = () => {
        enqueue(storage, { club: slug as string, apiBase: current?.apiBase, ...v });
        return { queued: true };
      };
      if (!navigator.onLine) return later();
      try {
        await apiForClub(current?.apiBase).me.absence({ club: slug as string }, v);
        return { queued: false };
      } catch (err) {
        if ((err as { status?: number }).status === 0) return later();
        throw err;
      }
    },
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<Me>(key);
      if (before) {
        queryClient.setQueryData<Me>(key, {
          ...before,
          calendar: before.calendar.map((d) =>
            d.date === v.date && d.absent !== v.absent ? { ...d, absent: v.absent, spots: Math.max(0, d.spots + (v.absent ? 1 : -1)) } : d,
          ),
        });
      }
      return { before };
    },
    onError: (_err, _v, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: (result) => (result?.queued ? undefined : queryClient.invalidateQueries({ queryKey: key })),
  });
}

/** The welcome card's Done: gone at once, kept on the account. */
export function useDismissWelcome() {
  const { token } = usePrefs();
  const { current, slug } = useCurrentClub();
  const queryClient = useQueryClient();
  const key = meKey(slug, token);
  return useMutation({
    mutationFn: () => apiForClub(current?.apiBase).account.dismissWelcome({}),
    onMutate: () => {
      const before = queryClient.getQueryData<Me>(key);
      if (before) queryClient.setQueryData<Me>(key, { ...before, welcome: false });
    },
  });
}
