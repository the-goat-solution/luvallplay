"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import { isMobileDevice } from "@/lib/device";
import { Sheet } from "./Sheet";
import styles from "./profile.module.css";

// "Add to Home Screen" guide (docs/plans/player-profiles.md §5a.2): shown
// once per player, on their first signed-in visit from a phone or tablet
// (lib/device.ts, never on desktop) that isn't already running the app. Stays about 45 seconds with a
// progress bar, pauses while touched or while the app is in the background,
// and can be reopened from Account → Add to Home Screen.

const SHOW_MS = 45_000;
export const OPEN_INSTALL_GUIDE_EVENT = "tw:install-guide";

type Platform = "ios26" | "ios" | "ipad" | "ios-other" | "android" | "inapp" | "desktop";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|MicroMessenger|Line\/|Zalo/i.test(ua)) return "inapp";
  const isIPad = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  if (isIPad || isIPhone) {
    if (/CriOS|EdgiOS|FxiOS|OPiOS|GSA\//.test(ua)) return "ios-other";
    if (isIPad) return "ipad";
    // iOS 26 Safari reports an older OS in its user agent; its Safari
    // version (Version/26) is the reliable signal.
    const safari = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
    return safari >= 26 ? "ios26" : "ios";
  }
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const noopSubscribe = () => () => {};
const serverPlatform = (): Platform => "desktop";

async function sendEvent(event: string, detail?: string) {
  try {
    await fetch("/api/profile/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, detail }),
      keepalive: true,
    });
  } catch {
    // best effort
  }
}

export function InstallGuide({ autoShow }: { autoShow: boolean }) {
  const { tr } = useProfileT();
  const [open, setOpen] = useState(false);
  // Known on the client only; the server snapshot is "desktop".
  const platform = useSyncExternalStore(noopSubscribe, detectPlatform, serverPlatform);
  const [elapsed, setElapsed] = useState(0);
  const [holding, setHolding] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  const close = useCallback((reason: "dismissed" | "timeout") => {
    setOpen(false);
    void sendEvent(reason === "timeout" ? "install_hint_timeout" : "install_hint_dismissed");
  }, []);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      void sendEvent("install_accepted", "appinstalled");
      window.setTimeout(() => setOpen(false), 2500);
    };
    const onManualOpen = () => {
      if (!isMobileDevice()) return;
      setElapsed(0);
      setInstalled(false);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener(OPEN_INSTALL_GUIDE_EVENT, onManualOpen);

    if (isStandalone()) {
      // Already running as the installed app: record it once per launch.
      if (!sessionStorage.getItem("tw_homescreen_logged")) {
        sessionStorage.setItem("tw_homescreen_logged", "1");
        void sendEvent("opened_homescreen");
      }
    } else if (autoShow && isMobileDevice()) {
      const t = window.setTimeout(() => {
        setOpen(true);
        void sendEvent("install_hint_shown", detectPlatform());
      }, 1200);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBip);
        window.removeEventListener("appinstalled", onInstalled);
        window.removeEventListener(OPEN_INSTALL_GUIDE_EVENT, onManualOpen);
      };
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(OPEN_INSTALL_GUIDE_EVENT, onManualOpen);
    };
  }, [autoShow]);

  // The 45-second timer: only runs while the page is visible and nobody is
  // touching the guide.
  useEffect(() => {
    if (!open || installed) return;
    const step = 200;
    const id = window.setInterval(() => {
      if (holding || document.hidden) return;
      setElapsed((e) => {
        const next = e + step;
        if (next >= SHOW_MS) {
          window.setTimeout(() => close("timeout"), 0);
        }
        return next;
      });
    }, step);
    return () => window.clearInterval(id);
  }, [open, holding, installed, close]);

  const k = (text: ProfileKey) => <span className={styles.kbd}>{tr(text)}</span>;

  // Fills {placeholders} in a translated sentence with highlighted labels.
  const rich = (key: ProfileKey, parts: Record<string, ReactNode>) => {
    const text = tr(key);
    return text.split(/(\{\w+\})/).map((chunk, i) => {
      const m = /^\{(\w+)\}$/.exec(chunk);
      return <Fragment key={i}>{m && parts[m[1]] ? parts[m[1]] : chunk}</Fragment>;
    });
  };

  const shareIcon = (
    <span className={styles.kbd}>
      <svg width="14" height="16" viewBox="0 0 14 18" aria-hidden="true">
        <path d="M7 1v11M3 5l4-4 4 4M1 9v8h12V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {tr("ig_share")}
    </span>
  );

  let steps: ReactNode[] = [];
  let arrow: string | null = null;
  if (platform === "ios26") {
    steps = [
      rich("ig_ios26_1", { more: k("ig_more"), share: shareIcon }),
      rich("ig_ios_2", { add: k("ig_add") }),
      rich("ig_ios26_3", { webapp: k("ig_webapp"), addbtn: k("ig_addbtn") }),
    ];
    arrow = styles.igArrowBottomRight;
  } else if (platform === "ios") {
    steps = [rich("ig_ios_1", { share: shareIcon }), rich("ig_ios_2", { add: k("ig_add") }), rich("ig_ios_3", { addbtn: k("ig_addbtn") })];
    arrow = styles.igArrowBottomCenter;
  } else if (platform === "ipad") {
    steps = [rich("ig_ipad_1", { share: shareIcon }), rich("ig_ios_2", { add: k("ig_add") }), rich("ig_ios_3", { addbtn: k("ig_addbtn") })];
    arrow = styles.igArrowTopRight;
  } else if (platform === "ios-other") {
    steps = [rich("ig_ios_chrome_1", { share: shareIcon }), rich("ig_ios_2", { add: k("ig_add") }), rich("ig_ios_3", { addbtn: k("ig_addbtn") })];
    arrow = styles.igArrowTopRight;
  } else if (platform === "android" || platform === "desktop") {
    steps = [rich("ig_android_1", { menu: k("ig_menu") }), rich("ig_android_2", { install: k("ig_install_app"), addhome: k("ig_addhome") })];
    arrow = canPrompt ? null : styles.igArrowTopRight;
  }

  const installNow = async () => {
    const evt = promptRef.current;
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    promptRef.current = null;
    setCanPrompt(false);
    if (choice.outcome === "accepted") {
      setInstalled(true);
      void sendEvent("install_accepted", "prompt");
      window.setTimeout(() => setOpen(false), 2500);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + "/profile");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: nothing else to do
    }
  };

  const remaining = Math.max(0, Math.ceil((SHOW_MS - elapsed) / 1000));
  const progress = Math.min(1, elapsed / SHOW_MS);

  return (
    <>
      {open && arrow && !installed && (
        <svg className={`${styles.igArrow} ${arrow}`} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v15m0 0l-6-6m6 6l6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <Sheet
        open={open}
        onClose={() => close("dismissed")}
        onHoldChange={setHolding}
        header={
          <div className={styles.igProgress} role="progressbar" aria-label={tr("ig_time_left", { s: remaining })} aria-valuemin={0} aria-valuemax={45} aria-valuenow={45 - remaining}>
            <div style={{ transform: `scaleX(${1 - progress})` }} />
          </div>
        }
      >
        <div className={styles.igHead}>
          <img className={styles.igIcon} src="/icons/icon-192.png" alt="" width={60} height={60} />
          <div>
            <h2 className={styles.sheetTitle} style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>
              {platform === "inapp" ? tr("ig_inapp_title") : tr("ig_title")}
            </h2>
            <p className={styles.small} style={{ marginTop: 4 }}>
              {platform === "inapp" ? null : tr("ig_sub")}
            </p>
          </div>
        </div>

        {installed ? (
          <div className={styles.success}>{tr("ig_installed")}</div>
        ) : platform === "inapp" ? (
          <>
            <p className={styles.muted} style={{ marginBottom: 12 }}>
              {tr("ig_inapp_body")}
            </p>
            <p className={styles.muted} style={{ marginBottom: 16 }}>
              {rich("ig_inapp_hint", { open: k("ig_open_browser"), menu: k("ig_more") })}
            </p>
            <button type="button" className={`${styles.btn} ${styles.navy} ${styles.btnBlock}`} onClick={copyLink}>
              {copied ? tr("ig_copied") : tr("ig_copy_link")}
            </button>
          </>
        ) : (
          <>
            {canPrompt && (
              <button
                type="button"
                className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`}
                style={{ marginBottom: 14 }}
                onClick={installNow}
              >
                {tr("ig_install")}
              </button>
            )}
            {!canPrompt && <ol className={styles.igSteps}>{steps.map((s, i) => <li key={i}><span>{s}</span></li>)}</ol>}
            <p className={styles.small} style={{ marginBottom: 14 }}>
              {tr("ig_signin_note")}
            </p>
          </>
        )}
        <button type="button" className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`} onClick={() => close("dismissed")}>
          {tr("ig_got_it")}
        </button>
        <p className={styles.small} style={{ textAlign: "center", marginTop: 10 }} aria-live="off">
          {!installed && tr("ig_time_left", { s: remaining })}
        </p>
      </Sheet>
    </>
  );
}
