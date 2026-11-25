// Settings: put the app on the home screen (where the browser can).
import { useSyncExternalStore } from "react";
import { install } from "../../lib/install.ts";
import type { T } from "../../lib/messages.ts";

export function InstallCard({ t }: { t: T }) {
  const state = useSyncExternalStore(install.subscribe, install.get);
  if (state === "none") return null;
  return (
    <section className="card stack" aria-labelledby="install-title" data-install={state}>
      <h2 id="install-title">{t("install_title")}</h2>
      {state === "installed" ? (
        <p className="muted">{t("install_done")}</p>
      ) : (
        <>
          <p className="muted">{t("install_text", { brand: t("brand") })}</p>
          {state === "prompt" ? (
            <div>
              <button type="button" className="button button-primary" onClick={() => void install.prompt()}>
                {t("install_btn")}
              </button>
            </div>
          ) : (
            <p className="small">{t("install_ios")}</p>
          )}
        </>
      )}
    </section>
  );
}
