// Cloudflare's bot check (Turnstile) on sign-in (cutover gap B1): the "send my
// code" route refuses with `captcha` once the website's deployment has
// TURNSTILE_SECRET_KEY, so the app sends a token first. Built with
// VITE_TURNSTILE_SITE_KEY; without it nothing is shown and nothing is sent
// (today's behaviour, which works while the secret is unset).
//
// A token works once: after each use the form asks for a new one (`resetKey`).
import { useEffect, useRef } from "react";

export const TURNSTILE_SITE_KEY: string | undefined = import.meta.env?.VITE_TURNSTILE_SITE_KEY || undefined;
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; language?: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;
/** The script, once per page (the website's widget adds it per form; here a form can show twice). */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** The check itself. `onToken("")` when the token expires or the check fails. `resetKey` changes → a fresh check. */
export function Turnstile({ onToken, lang, resetKey }: { onToken: (token: string) => void; lang: string; resetKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    let id: string | null = null;
    let gone = false;
    const el = ref.current;
    void loadTurnstile()
      .then((api) => {
        if (gone) return;
        id = api.render(el, {
          sitekey: TURNSTILE_SITE_KEY!,
          language: lang,
          callback: (token) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => callback.current(""),
        });
      })
      .catch(() => callback.current(""));
    return () => {
      gone = true;
      if (id) window.turnstile?.remove(id);
      callback.current("");
    };
  }, [lang, resetKey]);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} className="turnstile" data-testid="turnstile" />;
}
