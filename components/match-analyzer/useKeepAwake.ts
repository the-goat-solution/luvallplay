"use client";

import { useEffect, useState } from "react";

// Keeps the phone's screen on while Wolf Vision films or analyses a game. A
// locked screen stops the camera (and pauses an upload's analysis), so this
// matters for the whole session, not just "nice to have".
//
//   1. The Screen Wake Lock API (iOS 16.4+, Android Chrome). The browser drops
//      the lock whenever the page is hidden (app switcher, notification shade,
//      a call), so it is requested again every time the page comes back.
//   2. Fallback where the API is missing or refuses (older iOS, iOS home-screen
//      apps before 18.4, Low Power Mode): a tiny muted video looping inline.
//      A playing video keeps iOS and Android from dimming and locking (the
//      technique NoSleep.js uses). It is only started from a tap, so autoplay
//      rules are met.
//
// Returns how the screen is being kept on: "lock", "video", or "off".

type Sentinel = { released: boolean; release: () => Promise<void>; addEventListener: (t: "release", cb: () => void) => void };
type WakeNav = Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } };

let fallback: HTMLVideoElement | null = null;

function fallbackVideo(): HTMLVideoElement {
  if (fallback) return fallback;
  const v = document.createElement("video");
  v.src = "/wolf-vision-awake.mp4";
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("muted", "");
  v.setAttribute("aria-hidden", "true");
  // On screen (1 px, almost transparent): iOS does not count off-screen or hidden videos.
  Object.assign(v.style, { position: "fixed", left: "0", bottom: "0", width: "1px", height: "1px", opacity: "0.01", pointerEvents: "none", zIndex: "-1" });
  document.body.appendChild(v);
  fallback = v;
  return v;
}

/**
 * Call from a tap handler before a session starts (Safari only lets a video
 * play after a user gesture); the hook then keeps it going.
 */
export function primeKeepAwake() {
  if (typeof document === "undefined") return;
  const v = fallbackVideo();
  v.play()
    .then(() => {
      // Keep it ready (paused) until a session needs it.
      if (!activeCount) v.pause();
    })
    .catch(() => {});
}

let activeCount = 0;

export function useKeepAwake(active: boolean): "lock" | "video" | "off" {
  const [how, setHow] = useState<"lock" | "video" | "off">("off");
  useEffect(() => {
    if (!active) return;
    activeCount++;
    let lock: Sentinel | null = null;
    let alive = true;
    const nav = navigator as WakeNav;
    const startVideo = () => {
      const v = fallbackVideo();
      v.play()
        .then(() => alive && setHow("video"))
        .catch(() => alive && setHow("off"));
    };
    const acquire = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      if (lock && !lock.released) return;
      if (nav.wakeLock) {
        try {
          lock = await nav.wakeLock.request("screen");
          if (!alive) {
            lock.release().catch(() => {});
            return;
          }
          setHow("lock");
          // The lock does the job: the fallback video can rest (battery).
          fallback?.pause();
          lock.addEventListener("release", () => {
            if (alive && document.visibilityState === "visible") void acquire();
          });
          return;
        } catch {
          /* refused (Low Power Mode, not allowed here): fall back */
        }
      }
      startVideo();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    // A watchdog: browsers sometimes drop the lock without an event (iOS when the camera restarts).
    const id = window.setInterval(() => {
      if (lock?.released || (!lock && fallback?.paused)) void acquire();
    }, 10_000);
    return () => {
      alive = false;
      activeCount = Math.max(0, activeCount - 1);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.clearInterval(id);
      lock?.release().catch(() => {});
      if (!activeCount) fallback?.pause();
      setHow("off");
    };
  }, [active]);
  return how;
}
