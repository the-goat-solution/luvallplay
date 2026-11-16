"use client";

import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import type { Lang } from "@/lib/i18n";

function saveLang(l: Lang) {
  document.documentElement.lang = l;
  try {
    localStorage.setItem("tw_lang", l);
  } catch {
    // private mode: language just won't be remembered
  }
}

export function LangToggle({ dark = false, onChange }: { dark?: boolean; onChange?: (l: Lang) => void }) {
  const { lang, setLang } = useLanguage();
  const set = (l: Lang) => {
    setLang(l);
    saveLang(l);
    onChange?.(l);
  };
  const base: React.CSSProperties = {
    minWidth: 44,
    minHeight: 44,
    border: "none",
    background: "transparent",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: "0.1em",
    color: dark ? "rgba(252,251,242,.55)" : "var(--text-light)",
  };
  const active: React.CSSProperties = { color: dark ? "var(--bronze-light)" : "var(--navy)" };
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 4 }} role="group" aria-label="Language">
      <button type="button" style={{ ...base, ...(lang === "en" ? active : {}) }} onClick={() => set("en")} aria-pressed={lang === "en"}>
        EN
      </button>
      <button type="button" style={{ ...base, ...(lang === "vi" ? active : {}) }} onClick={() => set("vi")} aria-pressed={lang === "vi"}>
        VI
      </button>
    </div>
  );
}

/**
 * Applies the account's language (or the one saved on this device) once on
 * mount, since the site's language otherwise lives only in memory.
 */
export function LangSync({ lang }: { lang?: Lang }) {
  const { setLang } = useLanguage();
  useEffect(() => {
    let l: Lang | undefined = lang;
    if (!l) {
      try {
        const saved = localStorage.getItem("tw_lang");
        if (saved === "en" || saved === "vi") l = saved;
      } catch {
        // ignore
      }
    }
    if (l) {
      setLang(l);
      document.documentElement.lang = l;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
