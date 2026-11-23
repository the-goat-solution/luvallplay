// @luvallplay/i18n: all of the app's text, in typed per-area namespaces.
// Phase 2 merged the four separate dictionaries (lib/i18n.ts, profile-i18n.ts,
// arena-i18n.ts, jersey-i18n.ts) into this package. Languages: en and vi.
//
//   translate("arena", "vi", "err_cap_today")
//   translate("profile", lang, "me_streak", { n: 3 })

import { arena, type ArenaKey } from "./arena.ts";
import { format, type Lang, type Vars } from "./format.ts";
import { jersey, type JerseyKey } from "./jersey.ts";
import { profile, type ProfileKey } from "./profile.ts";
import { site, type SiteKey } from "./site.ts";

export { LANGS, format, type Lang, type Messages, type Vars } from "./format.ts";
export type { ArenaKey, JerseyKey, ProfileKey, SiteKey };

export const messages = { site, profile, arena, jersey };

export type Namespace = keyof typeof messages;
export type MessageKey<N extends Namespace> = keyof (typeof messages)[N]["en"] & string;
export const NAMESPACES = Object.keys(messages) as Namespace[];

/** A message in `lang`, falling back to English, then to the key itself. */
export function translate<N extends Namespace>(ns: N, lang: Lang, key: MessageKey<N>, vars?: Vars): string {
  const dict = messages[ns] as unknown as Record<Lang, Record<string, string>>;
  return format(dict[lang]?.[key] ?? dict.en[key] ?? key, vars);
}
