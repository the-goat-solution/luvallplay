// /handover#t=<token>&to=<screen>: a member signed in on the club's website
// arrives here signed in (the cutover's handover, lib/handover.ts). Already
// signed in: straight to the screen. Otherwise the token is swapped once; a
// used or expired one opens sign-in, which then opens the same screen.
import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, store } from "../app.ts";
import { handoverStep, parseHandover, signInFor } from "../lib/handover.ts";
import { useT } from "../hooks.tsx";
import { SignedOutPage } from "./SignIn.tsx";

export function HandoverScreen() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Once per page: the token works once, and a second swap (React's development double run) would refuse it.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const step = handoverStep(parseHandover(globalThis.location?.hash ?? ""), Boolean(store.get().token));
    // `replace` everywhere: the token leaves the address and the history at once.
    if (step.kind === "open") return router.history.replace(step.to);
    if (step.kind === "signin") return router.history.replace(signInFor(step.to));
    router.history.replace("/handover");
    api.auth
      .handover({ token: step.token })
      .then((session) => {
        queryClient.clear();
        store.set({ token: session.token, needsDetails: session.needsDetails });
        router.history.replace(session.needsDetails ? `/welcome${step.to === "/home" ? "" : `?next=${encodeURIComponent(step.to)}`}` : step.to);
      })
      .catch(() => router.history.replace(signInFor(step.to)));
  }, [router, queryClient]);
  return (
    <SignedOutPage club={null}>
      <p className="muted" role="status" aria-live="polite" data-screen="handover">{t("handover_signing_in")}</p>
    </SignedOutPage>
  );
}
