// "Get the app" (lib/get-app.ts decides when): a dialog in Luvallplay's own
// look, whichever club's look the page wears (the store app is Luvallplay's),
// with the app's icon, three reasons, the phone's own store, and "Not now".
// Loaded only when it's shown, so it costs nothing on the other opens.
import { useEffect, useRef } from "react";
import { schemeTheme, DEFAULT_SCHEME } from "@luvallplay/ui";
import { useMode, useT } from "../hooks.tsx";
import { themeVars } from "../lib/theme.ts";
import type { Platform } from "../lib/get-app.ts";
import { Icon, type IconName } from "./Icon.tsx";

const POINTS: [IconName, "getapp_reminders" | "getapp_fast" | "getapp_clubs"][] = [
  ["bell", "getapp_reminders"],
  ["bolt", "getapp_fast"],
  ["home", "getapp_clubs"],
];

export default function GetTheApp({ link, platform, onClose }: { link: string; platform: Exclude<Platform, null>; onClose: () => void }) {
  const t = useT();
  const mode = useMode();
  const ref = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  // Luvallplay's tokens on the dialog itself; system.css derives the rest there ([data-look-scope]).
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    for (const [name, value] of Object.entries(themeVars(schemeTheme(DEFAULT_SCHEME, mode)))) d.style.setProperty(name, value);
  }, [mode]);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // Focus the title (read out first, no ring on a button nobody chose).
    title.current?.focus({ preventScroll: true });
    return () => d?.close();
  }, []);

  return (
    <dialog ref={ref} className="dialog get-app" data-look-scope aria-labelledby="get-app-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="get-app-hero">
        <button type="button" className="get-app-close" onClick={onClose}>
          <Icon name="close" size={20} label={t("getapp_close")} />
        </button>
        <img className="get-app-icon" src="/icon-192.png" alt="" width={84} height={84} />
      </div>
      <div className="get-app-body stack">
        <div className="stack-tight">
          <h2 id="get-app-title" className="title focus-target" ref={title} tabIndex={-1}>{t("getapp_title")}</h2>
          <p className="muted">{t("getapp_body")}</p>
        </div>
        <ul className="get-app-points">
          {POINTS.map(([icon, key]) => (
            <li key={key}>
              <span className="get-app-point-icon"><Icon name={icon} size={18} /></span>
              {t(key)}
            </li>
          ))}
        </ul>
        <div className="stack-tight">
          <a className="button button-primary get-app-cta" href={link} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            <Icon name="download" size={20} />
            {t(platform === "ios" ? "getapp_ios" : "getapp_android")}
          </a>
          <button type="button" className="button button-quiet" onClick={onClose}>{t("getapp_later")}</button>
        </div>
      </div>
    </dialog>
  );
}
