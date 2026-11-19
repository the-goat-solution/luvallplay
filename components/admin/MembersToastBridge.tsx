"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/context/ToastContext";
import { offlineAddedMessage } from "@/components/admin/PlayDaysToastBridge";

const TOAST_PARAMS = ["cashMemberAdded", "cashMemberError"] as const;

// The "Add offline payment member" server action redirects back with one of these query
// params (server actions can't call client-side toast code directly). This
// bridges that redirect into a toast, then strips the param so a refresh
// doesn't re-fire it. Mirrors PlayDaysToastBridge.
export function MembersToastBridge() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const cashMemberAdded = searchParams.get("cashMemberAdded");
    const cashMemberError = searchParams.get("cashMemberError");

    if (cashMemberAdded) {
      showToast(offlineAddedMessage(cashMemberAdded, "Member"), "success");
    }
    if (cashMemberError) showToast(cashMemberError, "error");

    if (cashMemberAdded || cashMemberError) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of TOAST_PARAMS) params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/admin/members?${qs}` : "/admin/members", {
        scroll: false,
      });
    }
  }, [searchParams, showToast, router]);

  return null;
}
