"use client";

import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";

/** Translated profile text inside server components. */
export function PT({ k, vars }: { k: ProfileKey; vars?: Record<string, string | number> }) {
  const { tr } = useProfileT();
  return <>{tr(k, vars)}</>;
}
