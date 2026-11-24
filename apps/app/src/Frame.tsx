// The Luvallplay frame (decision AM): the page's look (the club's after
// sign-in or on a club's invite link, Luvallplay's otherwise), the document
// language, and the small "on Luvallplay" footer mark.
import { useEffect, type ReactNode } from "react";
import { useLang, useMode, useT, type ClubConfig } from "./hooks.tsx";
import { applyTheme } from "./lib/theme.ts";

const LUVALLPLAY_THEME_COLOR = { light: "#0e6b4f", dark: "#0b1b2b" };

/** Dresses the page. `club` null: Luvallplay's own look. */
export function useLook(club: ClubConfig | null): void {
  const mode = useMode();
  const lang = useLang();
  const theme = club?.theme ?? null;
  useEffect(() => {
    const primary = applyTheme(document.documentElement, theme, mode);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", primary ?? LUVALLPLAY_THEME_COLOR[mode]);
  }, [theme, mode]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    document.title = club ? `${club.club.name} · Luvallplay` : "Luvallplay";
  }, [club]);
}

export function OnLuvallplay() {
  const t = useT();
  return (
    <p className="on-luvallplay">
      <LuvallplayMark /> {t("on_luvallplay")}
    </p>
  );
}

export function LuvallplayMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="currentColor" opacity="0.14" />
      <path d="M22 16v32h20" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Splash() {
  const t = useT();
  return (
    <div className="splash" role="status" aria-live="polite">
      <LuvallplayMark size={56} />
      <span className="visually-hidden">{t("loading")}</span>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}
