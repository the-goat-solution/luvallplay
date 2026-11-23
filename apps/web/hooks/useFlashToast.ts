"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";

// Server actions can't call client-side toast code, so they redirect back
// with a query param (?toast=…, ?cashAdded=…). This hook turns each known
// param into a toast, then strips them from the URL so a refresh doesn't
// fire them again. One hook for every admin page (it replaced five
// near-identical *ToastBridge components).

export type FlashKind = "success" | "error";
/** Message for a param's value, or null to show nothing. */
export type FlashRule = (value: string) => { text: string; kind: FlashKind } | null;
export type FlashRules = Record<string, FlashRule>;

export function useFlashToast(rules: FlashRules): void {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const hits = Object.keys(rules).filter((key) => searchParams.get(key) !== null);
    if (hits.length === 0) return;
    for (const key of hits) {
      const message = rules[key](searchParams.get(key) ?? "");
      if (message) showToast(message.text, message.kind);
    }
    const params = new URLSearchParams(searchParams.toString());
    for (const key of hits) params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [rules, searchParams, pathname, router, showToast]);
}
