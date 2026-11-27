"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AdminLink } from "@/components/admin/AdminLink";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useAdminText } from "@/components/admin/AdminLang";
import k from "@/components/admin/kit/kit.module.css";

export type PlayDayOption = { key: string; label: string };

// ‹ previous · dropdown · next ›: switching play day is one tap, with no
// separate "View" button.
export function PlayDayPicker({
  options,
  selected,
  prev,
  next,
}: {
  options: PlayDayOption[];
  selected: string;
  prev: string | null;
  next: string | null;
}) {
  const router = useRouter();
  const { t } = useAdminText();
  const [pending, start] = useTransition();
  const go = (key: string) => start(() => router.push(`/admin/play-days?date=${key}`));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {prev ? (
        <AdminLink href={`/admin/play-days?date=${prev}`} className={k.btnSecondary} title={t("play_prev")}>
          ‹
        </AdminLink>
      ) : (
        <span className={k.btnSecondary} aria-hidden style={{ opacity: 0.4 }}>
          ‹
        </span>
      )}
      <label className={k.srOnly} htmlFor="date">
        {t("play_tab_label")}
      </label>
      <select id="date" className={k.select} value={selected} onChange={(e) => go(e.target.value)} disabled={pending}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {next ? (
        <AdminLink href={`/admin/play-days?date=${next}`} className={k.btnSecondary} title={t("play_next")}>
          ›
        </AdminLink>
      ) : (
        <span className={k.btnSecondary} aria-hidden style={{ opacity: 0.4 }}>
          ›
        </span>
      )}
      {pending && <LoadingIcon size="sm" />}
    </div>
  );
}
