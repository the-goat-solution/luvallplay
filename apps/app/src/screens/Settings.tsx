// Settings (the ⚙ in the header), as on the website: the Club admin button,
// picture, details, language, appearance, privacy, the person's data and
// signing out. Language is kept on the account too, so the website and the
// club's emails follow. Still to come (they touch signing in): changing the
// phone number (it needs text-message codes).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, store } from "../app.ts";
import { useCurrentClub, useLang, usePrefs, useSession, useT } from "../hooks.tsx";
import { AccountCards } from "./settings/Account.tsx";
import { ClubAdmin } from "./settings/ClubAdmin.tsx";
import { ConnectedApps } from "./settings/ConnectedApps.tsx";
import { useSaveLanguage } from "./settings/data.ts";
import type { ThemeChoice } from "../lib/theme.ts";

export default function SettingsScreen() {
  const { config, current } = useCurrentClub();
  const t = useT(config);
  const lang = useLang();
  const { theme } = usePrefs();
  const session = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const saveLanguage = useSaveLanguage();

  async function signOut(all: boolean) {
    setBusy(true);
    try {
      await api.auth.logout({ all });
    } catch {
      // Offline or already ended: this device is signed out all the same.
    }
    store.signOut();
    queryClient.clear();
  }

  const themes: [ThemeChoice, string][] = [["system", t("settings_theme_system")], ["light", t("settings_theme_light")], ["dark", t("settings_theme_dark")]];
  return (
    <section className="screen stack" data-screen="nav_settings">
      <h1>{t("settings_title")}</h1>
      <div className="panes">
        <AccountCards />
        <ConnectedApps />
        <fieldset className="card stack">
          <legend>{t("settings_language")}</legend>
          {(["en", "vi"] as const).map((l) => (
            <label className="choice" key={l}>
              <input type="radio" name="lang" value={l} checked={lang === l} onChange={() => {
                  store.set({ lang: l });
                  saveLanguage.mutate(l);
                }} />
              <span lang={l}>{t(l === "en" ? "settings_lang_en" : "settings_lang_vi")}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="card stack">
          <legend>{t("settings_theme")}</legend>
          {themes.map(([value, label]) => (
            <label className="choice" key={value}>
              <input type="radio" name="theme" value={value} checked={theme === value} onChange={() => store.set({ theme: value })} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {current?.canOpenAdmin && <ClubAdmin clubName={current.name} email={session.data?.player.email} />}
        <div className="card stack">
          <h2>{t("settings_account")}</h2>
          {session.data && <p className="muted">{t("settings_signed_in_as", { email: session.data.player.email })}</p>}
          <button className="button" type="button" disabled={busy} onClick={() => void signOut(false)}>
            {t("settings_sign_out")}
          </button>
          <button className="button button-danger" type="button" disabled={busy} aria-describedby="sign-out-all-hint" onClick={() => void signOut(true)}>
            {t("settings_sign_out_all")}
          </button>
          <p className="muted" id="sign-out-all-hint">{t("settings_sign_out_all_hint")}</p>
        </div>
      </div>
    </section>
  );
}
