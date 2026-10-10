"use client";

import { useState } from "react";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useToast } from "@/context/ToastContext";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import styles from "./financials.module.css";

// Downloads an Excel export with visible progress. A plain <a download>
// gave no feedback at all while the server built the workbook (a few
// seconds for a long range), which invites repeated clicks; this fetches
// it, shows a spinner meanwhile, then hands the file to the browser — and
// reports a failure instead of silently downloading an error page.
export function ExportButton({ href, children }: { href: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayedLoading(busy, 200);
  const { showToast } = useToast();

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        "three-wolves-financials.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Export failed", "error");
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
          Preparing Excel…
        </>
      ) : (
        children
      )}
    </button>
  );
}
