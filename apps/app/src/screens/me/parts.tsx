// Small pieces the Me cards share: the person's place (language, country,
// time zone, currency), day and plan names, and links to the club's website
// for what the app doesn't do yet.
import type { ReactNode } from "react";
import type { AppKey } from "@luvallplay/i18n/app";
import { useCurrentClub, useLang, useT } from "../../hooks.tsx";
import { localeOf } from "../../lib/format.ts";

export function usePlace() {
  const { config } = useCurrentClub();
  const lang = useLang();
  const t = useT(config);
  const club = config?.club;
  return {
    t,
    locale: localeOf(lang, club?.country ?? "NZ"),
    timezone: club?.timezone ?? "UTC",
    currency: club?.currency ?? "NZD",
    webUrl: club?.webUrl ?? null,
    clubName: club?.name ?? "",
  };
}

const DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

/** "Fridays" for a membership day. */
export function daysName(t: (k: AppKey) => string, day: string): string {
  return DAYS.has(day) ? t(`days_${day}` as AppKey) : day;
}

export function planName(t: (k: AppKey) => string, plan: "monthly" | "quarterly"): string {
  return t(plan === "quarterly" ? "mem_quarterly" : "mem_monthly");
}

/** A path on the club's website, or null when the club has none (the action is then left out). */
export function webHref(webUrl: string | null, path: string): string | null {
  if (!webUrl || !/^https?:\/\//.test(webUrl)) return null;
  return `${webUrl.replace(/\/+$/, "")}${path}`;
}

/** A button-styled link that opens the club's website in the browser, and says so. */
export function WebsiteLink({ href, className = "button", children }: { href: string; className?: string; children: ReactNode }) {
  const { t } = usePlace();
  return (
    <a className={`${className} link-out`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
      <span className="visually-hidden"> ({t("me_on_website")})</span>
    </a>
  );
}
