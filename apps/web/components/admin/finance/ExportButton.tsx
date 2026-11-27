"use client";

import { useState } from "react";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useToast } from "@/context/ToastContext";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import styles from "./financials.module.css";
import { clubSlug } from "@/lib/club-brand";
import { useAdminText } from "@/components/admin/AdminLang";

// Downloads an Excel export with visible progress. A plain <a download>
// gave no feedback at all while the server built the workbook (a few
// seconds for a long range), which invites repeated clicks; this fetches
// it, shows a spinner meanwhile, then hands the file to the browser — and
// reports a failure instead of silently downloading an error page.
export function ExportButton({ href, children }: { href: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy, 200);
  const { showToast } = useToast();
  const { t } = useAdminText();

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (res.status === 401) {
        // An export needs a code entered in the last five minutes: off to the code screen and back here.
        const kind = ((await res.json().catch(() => null)) as { scope?: string } | null)?.scope === "action" ? "action" : "1";
        window.location.assign(new URL(`/login?stepup=${kind}&next=${encodeURIComponent(window.location.pathname + window.location.search)}`, window.location.origin));
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? t("fin_export_failed_code", { code: res.status }));
      }
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        `${clubSlug()}-financials.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("fin_export_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={styles.button}
      onClick={download}
      disabled={busy}
      aria-busy={busy}
      style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
    >
      {showBusy ? (
        <>
          <LoadingIcon size="sm" />
          {t("fin_export_preparing")}
        </>
      ) : (
        children
      )}
    </button>
  );
}
