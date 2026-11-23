"use client";

import { useCallback, useEffect, useRef } from "react";

// Invisible reCAPTCHA v2, which Google requires before it sends an SMS code.
// The browser only solves the check; our server sends the text (lib/sms.ts).

type Grecaptcha = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => number;
  execute: (id: number) => void;
  reset: (id: number) => void;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    __twRecaptchaLoaded?: () => void;
  }
}

let loader: Promise<Grecaptcha> | null = null;

function loadRecaptcha(): Promise<Grecaptcha> {
  if (window.grecaptcha?.render) return Promise.resolve(window.grecaptcha);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      window.__twRecaptchaLoaded = () => (window.grecaptcha ? resolve(window.grecaptcha) : reject(new Error("recaptcha")));
      const s = document.createElement("script");
      s.src = "https://www.google.com/recaptcha/api.js?onload=__twRecaptchaLoaded&render=explicit";
      s.async = true;
      s.onerror = () => {
        loader = null;
        reject(new Error("recaptcha"));
      };
      document.head.appendChild(s);
    });
  }
  return loader;
}

export function useRecaptcha(siteKey: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<number | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    // Warm the script up so the first tap isn't slow.
    loadRecaptcha().catch(() => {});
  }, [siteKey]);

  const getToken = useCallback(async (): Promise<string> => {
    if (!siteKey) throw new Error("recaptcha");
    const g = await loadRecaptcha();
    if (!containerRef.current) throw new Error("recaptcha");
    if (widgetRef.current === null) {
      widgetRef.current = g.render(containerRef.current, {
        sitekey: siteKey,
        size: "invisible",
        callback: (token: string) => pending.current?.resolve(token),
        "error-callback": () => pending.current?.reject(new Error("recaptcha")),
        "expired-callback": () => pending.current?.reject(new Error("recaptcha")),
      });
    } else {
      g.reset(widgetRef.current);
    }
    return new Promise<string>((resolve, reject) => {
      pending.current = { resolve, reject };
      g.execute(widgetRef.current as number);
    });
  }, [siteKey]);

  return { containerRef, getToken };
}
