// Settings' data: the account (the same in every club) and its changes.
// Every change refreshes what shows the person elsewhere (Me's header, the
// session's name and language).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BodyOf, ResponseOf } from "@luvallplay/api/contract";
import { api } from "../../app.ts";
import { usePrefs } from "../../hooks.tsx";

export type Profile = ResponseOf<"account.profile">;

export function useProfile() {
  const { token } = usePrefs();
  return useQuery({ queryKey: ["profile", token], queryFn: ({ signal }) => api.account.profile({ signal }), enabled: !!token, staleTime: 30_000 });
}

function useRefreshAccount() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["profile"] });
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  };
}

export function useSaveDetails() {
  const refresh = useRefreshAccount();
  return useMutation({ mutationFn: (v: BodyOf<"account.details">) => api.account.details(v), onSuccess: refresh });
}

export function useSaveLanguage() {
  const refresh = useRefreshAccount();
  return useMutation({ mutationFn: (lang: "en" | "vi") => api.account.language({ lang }), onSuccess: refresh });
}

/** "Show me on the leaderboard" (the switch itself moves at once; see Privacy). */
export function useSavePrivacy() {
  const { token } = usePrefs();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (leaderboardVisible: boolean) => api.account.privacy({ leaderboardVisible }),
    onSuccess: (_r, leaderboardVisible) => {
      queryClient.setQueryData<Profile>(["profile", token], (p) => (p ? { ...p, leaderboardVisible } : p));
    },
  });
}

export function usePhoto() {
  const refresh = useRefreshAccount();
  const save = useMutation({ mutationFn: (image: string) => api.account.photo({ image }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.account.removePhoto(), onSuccess: refresh });
  return { save, remove };
}

/** Fetches the account's data and hands it to the browser as a file. */
export function useDownloadData() {
  return useMutation({
    mutationFn: async () => {
      const data = await api.account.export();
      const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-club-data.json";
      document.body.append(a);
      a.click();
      a.remove();
    },
  });
}
