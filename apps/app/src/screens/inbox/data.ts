// The inbox's data: the list, one conversation (refreshed every 20 seconds
// while it's on screen, as on the website), starting one and replying.
// Reading or writing refreshes the Me tab's unread count too.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, useWho } from "../../hooks.tsx";

export type ThreadItem = ResponseOf<"messages.list">["threads"][number];
export type Thread = ResponseOf<"messages.thread">["thread"];

const POLL_MS = 20_000;

function useClubApi() {
  const who = useWho();
  const { current, slug } = useCurrentClub();
  return { who, slug, ready: !!who && !!slug && !!current, api: apiForClub(current?.apiBase) };
}

export function useThreads() {
  const { who, slug, ready, api } = useClubApi();
  return useQuery({
    queryKey: ["messages", slug, who],
    queryFn: ({ signal }) => api.messages.list({ club: slug as string }, { signal }),
    enabled: ready,
    staleTime: 15_000,
  });
}

export function useThread(id: number | null) {
  const { who, slug, ready, api } = useClubApi();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["messages", slug, who, id],
    queryFn: async ({ signal }) => {
      const answer = await api.messages.thread({ club: slug as string, id: id as number }, { signal });
      // Reading marks it read: the list and Me's bell follow.
      void queryClient.invalidateQueries({ queryKey: ["messages", slug, who], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["me", slug, who] });
      return answer.thread;
    },
    enabled: ready && id !== null,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
}

export function useReply(id: number) {
  const { who, slug, api } = useClubApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.messages.reply({ club: slug as string, id }, { body }),
    onSuccess: (answer) => {
      queryClient.setQueryData<Thread>(["messages", slug, who, id], (t) => (t ? { ...t, status: "open", messages: [...t.messages, answer.message] } : t));
      void queryClient.invalidateQueries({ queryKey: ["messages", slug, who], exact: true });
    },
  });
}

export function useStartThread() {
  const { who, slug, api } = useClubApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { subject: string; body: string }) => api.messages.start({ club: slug as string }, v),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["messages", slug, who], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["me", slug, who] });
    },
  });
}
