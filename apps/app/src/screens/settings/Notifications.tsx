// Settings → Notifications (the store app only; a browser has no card).
// Off until the person turns it on here: only then is the phone asked for
// permission. Each kind of notification is its own switch.
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { api, storage } from "../../app.ts";
import { useWho, type useT } from "../../hooks.tsx";
import { disablePush, enablePush, rememberedPushToken, type PushDeps } from "../../lib/native/push-device.ts";
import { pushPlugin, type PushState } from "../../lib/native/push.ts";

type T = ReturnType<typeof useT>;
type Push = ResponseOf<"account.push">;
type Kind = keyof Push["kinds"];

const KINDS: readonly [Kind, Parameters<T>[0]][] = [
  ["challenge", "push_kind_challenge"],
  ["result", "push_kind_result"],
  ["message", "push_kind_message"],
  ["reminder", "push_kind_reminder"],
  ["roster", "push_kind_roster"],
  ["payment", "push_kind_payment"],
];

const deps = (): PushDeps => ({ storage, server: { register: (v) => api.account.pushDevice(v), remove: (v) => api.account.pushRemoveDevice(v) } });

export function NotificationsCard({ t }: { t: T }) {
  const native = pushPlugin();
  const who = useWho();
  const id = useId();
  const queryClient = useQueryClient();
  const key = ["push", who];
  const push = useQuery({ queryKey: key, queryFn: ({ signal }) => api.account.push({ signal }), enabled: !!native && !!who });
  const [here, setHere] = useState(() => rememberedPushToken(storage) !== null);
  const [state, setState] = useState<PushState | null>(null);

  const setKinds = useMutation({
    mutationFn: (kinds: Partial<Push["kinds"]>) => api.account.pushKinds(kinds),
    onMutate: (kinds) => {
      const before = queryClient.getQueryData<Push>(key);
      if (before) queryClient.setQueryData<Push>(key, { ...before, kinds: { ...before.kinds, ...kinds } });
      return before;
    },
    onError: (_e, _v, before) => queryClient.setQueryData(key, before),
    onSuccess: (r) => queryClient.setQueryData<Push>(key, (old) => (old ? { ...old, kinds: r.kinds } : old)),
  });
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (!on) {
        await disablePush(deps());
        return "off" as const;
      }
      const result = await enablePush(deps());
      // Just turned on with nothing chosen yet: every kind starts on, and each can be switched off below.
      if (result === "on" && push.data && !Object.values(push.data.kinds).some(Boolean)) {
        await setKinds.mutateAsync({ challenge: true, result: true, message: true, reminder: true, roster: true, payment: true });
      }
      return result;
    },
    onSuccess: (result) => setState(result === "off" ? null : result),
    // Whatever happened, the switch shows what this phone now holds.
    onSettled: () => {
      setHere(rememberedPushToken(storage) !== null);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  // A browser, a store build without push, or a server that can't keep a phone's address: no card.
  if (!native || !push.data?.available) return null;
  return (
    <section className="card stack" aria-labelledby={`${id}-title`} data-card="notifications">
      <h2 id={`${id}-title`}>{t("push_title")}</h2>
      <label className="choice">
        <input type="checkbox" checked={here} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} aria-describedby={`${id}-hint`} />
        <span>{t("push_here")}</span>
      </label>
      <p className="muted small" id={`${id}-hint`}>{t("push_hint")}</p>
      {state === "blocked" && <p className="notice" role="status">{t("push_blocked")}</p>}
      {(toggle.isError || setKinds.isError) && <p className="notice notice-error" role="alert">{t("error_generic")}</p>}
      {here && (
        <fieldset className="stack">
          <legend>{t("push_kinds")}</legend>
          {KINDS.map(([kind, label]) => (
            <label className="choice" key={kind}>
              <input type="checkbox" checked={push.data.kinds[kind]} onChange={(e) => setKinds.mutate({ [kind]: e.target.checked })} />
              <span>{t(label)}</span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
