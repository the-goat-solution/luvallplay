// The top of Home: "Good morning, Mia" by the device's clock, and today's
// date, so the app opens like it knows who's there and when.
import type { AppKey } from "@luvallplay/i18n/app";
import { useLang, useT } from "../hooks.tsx";
import { localeOf } from "../lib/format.ts";
import { partOfDay } from "../lib/home.ts";

export function Greeting({ firstName, country }: { firstName: string; country?: string }) {
  const t = useT();
  const lang = useLang();
  const now = new Date();
  const part = partOfDay(now.getHours());
  const name = firstName.trim();
  const today = now.toLocaleDateString(localeOf(lang, country ?? "NZ"), { weekday: "long", day: "numeric", month: "long" });
  return (
    <header className="greeting">
      <p className="greeting-date">{today}</p>
      <h1>{name ? t(`greet_${part}` as AppKey, { name }) : t(`greet_${part}_anon` as AppKey)}</h1>
    </header>
  );
}
