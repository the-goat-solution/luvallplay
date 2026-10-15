"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";

const TOAST_PARAMS = ["toast", "toastError"] as const;

// The jersey page's server actions redirect back with a ready-made
// message in one of these params; show it as a toast, then strip it so a
// refresh doesn't re-fire it. Mirrors DayRequestsToastBridge.
export function JerseyToastBridge() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const toast = searchParams.get("toast");
    const toastError = searchParams.get("toastError");

    if (toast) showToast(toast, "success");
    if (toastError) showToast(toastError, "error");

    if (toast || toastError) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/admin/jersey?${qs}` : "/admin/jersey", {
        scroll: false,
      });
    }
  }, [searchParams, showToast, router]);

  return null;
}
