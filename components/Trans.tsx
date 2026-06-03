"use client";

import { useLanguage } from "@/context/LanguageContext";
import type { I18nKey } from "@/lib/i18n";
import type { ElementType } from "react";

export function Trans({
  k,
  vars,
  as: Tag = "span",
  className,
}: {
  k: I18nKey;
  vars?: Record<string, string | number>;
  as?: ElementType;
  className?: string;
}) {
  const { tr } = useLanguage();
  return <Tag className={className}>{tr(k, vars)}</Tag>;
}
