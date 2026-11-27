"use client";

// The admin's language for client components. The frame (AdminShell) provides
// it; a client component calls `const { lang, t } = useAdminText()`. Server
// components use adminText() from lib/admin-lang.ts instead.
import { createContext, useContext, type ReactNode } from "react";
import { at, type AdminKey } from "@luvallplay/i18n/admin";
import type { Lang, Vars } from "@luvallplay/i18n";

const AdminLangContext = createContext<Lang>("en");

export function AdminLangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <AdminLangContext.Provider value={lang}>{children}</AdminLangContext.Provider>;
}

export function useAdminText(): { lang: Lang; t: (key: AdminKey, vars?: Vars) => string } {
  const lang = useContext(AdminLangContext);
  return { lang, t: (key, vars) => at(lang, key, vars) };
}
