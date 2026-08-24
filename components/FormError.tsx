"use client";

import { useLanguage } from "@/context/LanguageContext";
import type { I18nKey } from "@/lib/i18n";

export function FormError({ messageKey }: { messageKey?: I18nKey }) {
  const { tr } = useLanguage();
  if (!messageKey) return null;
  return <p className="form-error">{tr(messageKey)}</p>;
}
