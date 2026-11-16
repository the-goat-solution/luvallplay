"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";

// Generic version of the per-page toast bridges: a server action redirects
// back with ?toast= or ?toastError=, this shows it and strips the param.
export function AdminToastBridge() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const toast = searchParams.get("toast");
    const toastError = searchParams.get("toastError");
    if (toast) showToast(toast, "success");
    if (toastError) showToast(toastError, "error");
    if (toast || toastError) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("toast");
      params.delete("toastError");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, pathname, showToast, router]);

  return null;
}
