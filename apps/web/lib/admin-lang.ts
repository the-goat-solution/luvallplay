// The language of the admin for this request: the signed-in person's own
// account setting (the same one the players' app uses), English if there is
// none. Pages call `const { lang, t } = await adminText()`; `t` is the typed
// lookup for the admin namespace (packages/i18n/src/admin.ts).
import { at, type AdminKey } from "@luvallplay/i18n/admin";
import type { Lang, Vars } from "@luvallplay/i18n";
import { currentAdmin } from "@/lib/admin-access";

export async function adminLang(): Promise<Lang> {
  const ctx = await currentAdmin().catch(() => null);
  return ctx?.player.lang ?? "en";
}

export async function adminText(): Promise<{ lang: Lang; t: (key: AdminKey, vars?: Vars) => string }> {
  const lang = await adminLang();
  return { lang, t: (key, vars) => at(lang, key, vars) };
}
