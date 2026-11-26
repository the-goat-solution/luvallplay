// The Me tab's data: one query for the whole screen (so it opens from the
// cache at once), and its two changes, applied on screen straight away.
import { useMemo, useSyncExternalStore } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { apiForClub, storage } from "../../app.ts";
import { useCurrentClub, type Club, useWho } from "../../hooks.tsx";
import { dropped, queued, watchQueue, withPending, type DroppedAbsence, type QueuedAbsence } from "../../lib/offline.ts";
import { changeAbsence, queueStalled } from "../../lib/queue.ts";

export type Me = ResponseOf<"me.home">;
export type PlayDay = Me["calendar"][number];

export const meKey = (slug: string | null, who: string | null) => ["me", slug, who] as const;

export function useMe() {
  const who = useWho();
  const { current, slug } = useCurrentClub();
  const query = useQuery({
    queryKey: meKey(slug, who),
    queryFn: ({ signal }) => apiForClub(current?.apiBase).me.home({ club: slug as string }, { signal }),
    enabled: !!who && !!slug && !!current,
    staleTime: 30_000,
  });
  const { waiting } = useQueue();
  const data = useMemo(() => (query.data && slug ? withWaiting(query.data, slug, waiting) : query.data), [query.data, slug, waiting]);
  return { ...query, data, apiBase: current?.apiBase, slug };
}

/** The choices that wait on this device, and the ones the club's server refused. */
export function useQueue(): { waiting: QueuedAbsence[]; dropped: DroppedAbsence[]; stalled: boolean } {
  const waiting = useSyncExternalStore(watchQueue, () => storage.get("queue") ?? "");
  const refused = useSyncExternalStore(watchQueue, () => storage.get("dropped") ?? "");
  const stalled = useSyncExternalStore(watchQueue, queueStalled);
  // The stored text is the snapshot (a stable value); the lists are read from it.
  return useMemo(() => ({ waiting: queued(storage), dropped: dropped(storage), stalled }), [waiting, refused, stalled]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A club's Me with the choices that still wait shown over what its server last said. */
export function withWaiting(me: Me, club: string, waiting: readonly QueuedAbsence[]): Me {
  const calendar = withPending(me.calendar, club, waiting);
  return calendar === me.calendar ? me : { ...me, calendar };
}

/**
 * "Can't make it" and "I can come after all" for the current club. Every
 * choice goes through the queue (lib/queue.ts): the day flips (and its spot
 * frees up) at once, the latest choice for a day wins, and it is sent as soon
 * as there's a connection. `waits(date)` says a choice hasn't reached the
 * club yet and can't right now.
 */
export function useAbsence() {
  const { current, slug } = useCurrentClub();
  const queryClient = useQueryClient();
  const { waiting, stalled } = useQueue();
  return {
    change: (v: { date: string; absent: boolean }) => {
      if (slug) void changeAbsence(queryClient, { club: slug, apiBase: current?.apiBase, ...v });
    },
    waits: (date: string) => stalled && waiting.some((q) => q.club === slug && q.date === date),
  };
}

/** The welcome card's Done: gone at once, kept on the account. */
export function useDismissWelcome() {
  const who = useWho();
  const { current, slug } = useCurrentClub();
  const queryClient = useQueryClient();
  const key = meKey(slug, who);
  return useMutation({
    mutationFn: () => apiForClub(current?.apiBase).account.dismissWelcome({}),
    onMutate: () => {
      const before = queryClient.getQueryData<Me>(key);
      if (before) queryClient.setQueryData<Me>(key, { ...before, welcome: false });
    },
  });
}

/**
 * Unread messages across the person's clubs, for the bell in the top bar:
 * from each club's Me (the same queries Home uses, so they share the cache).
 */
export function useUnread(clubs: readonly Club[] | null): number {
  const who = useWho();
  const results = useQueries({
    queries: (clubs ?? []).map((c) => ({
      queryKey: meKey(c.slug, who),
      queryFn: ({ signal }: { signal: AbortSignal }) => apiForClub(c.apiBase).me.home({ club: c.slug }, { signal }),
      enabled: !!who,
      staleTime: 30_000,
    })),
  });
  return results.reduce((n, r) => n + (r.data?.inbox.unread ?? 0), 0);
}
