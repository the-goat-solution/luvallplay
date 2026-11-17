"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Loading state that lasts until the screen has actually changed.
 *
 * `busy` is true while an action runs AND while the navigation or refresh
 * that follows it loads (React transitions keep `isPending` on until the
 * new page has rendered), so a button never goes back to idle in the gap
 * between "saved" and "updated".
 */
export function useBusyAction() {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [isPending, startTransition] = useTransition();

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setWorking(true);
    try {
      return await fn();
    } finally {
      setWorking(false);
    }
  }, []);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const replace = useCallback(
    (href: string) =>
      startTransition(() => {
        router.replace(href);
        router.refresh();
      }),
    [router],
  );
  const push = useCallback((href: string) => startTransition(() => router.push(href)), [router]);

  return { busy: working || isPending, working, refreshing: isPending, run, setWorking, refresh, replace, push };
}
