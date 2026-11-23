"use client";

import { useEffect, useRef, useState } from "react";

type Reading = Record<string, string>;

function layoutFor(w: number, h: number): string {
  const landscape = w > h;
  if (landscape && h <= 500) return "Wide & short: trailing rail, 4-column stats";
  if (w >= 1024) return "Large: leading sidebar";
  if (w >= 600) return landscape ? "Tablet width, landscape: two panes + trailing rail" : "Tablet width, portrait: two panes + top tab bar";
  return "Phone: one column + bottom tab bar";
}

export function DeviceCheck() {
  const probe = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState<Reading>({});

  useEffect(() => {
    const read = () => {
      const cs = probe.current ? getComputedStyle(probe.current) : null;
      const vv = window.visualViewport;
      const segments = (window as Window & { viewport?: { segments?: DOMRect[] } }).viewport?.segments;
      const mq = (q: string) => (window.matchMedia(q).matches ? "yes" : "no");
      setReading({
        "Layout used": layoutFor(window.innerWidth, window.innerHeight),
        "Width × height (CSS px)": `${window.innerWidth} × ${window.innerHeight}`,
        "Visual viewport": vv ? `${Math.round(vv.width)} × ${Math.round(vv.height)} (scale ${vv.scale.toFixed(2)})` : "n/a",
        "Screen": `${screen.width} × ${screen.height}`,
        "Pixel ratio": String(window.devicePixelRatio),
        "Orientation": mq("(orientation: landscape)") === "yes" ? "landscape" : "portrait",
        "Safe area (top, right, bottom, left)": cs
          ? [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(", ")
          : "n/a",
        "Running as home-screen app": mq("(display-mode: standalone)") === "yes" || (navigator as Navigator & { standalone?: boolean }).standalone ? "yes" : "no",
        "Touch (coarse pointer)": mq("(pointer: coarse)"),
        "Hover available": mq("(hover: hover)"),
        "Fold reported (horizontal segments: 2)": mq("(horizontal-viewport-segments: 2)"),
        "Fold reported (vertical segments: 2)": mq("(vertical-viewport-segments: 2)"),
        "Viewport segments": segments ? segments.map((s) => `${Math.round(s.x)},${Math.round(s.y)} ${Math.round(s.width)}×${Math.round(s.height)}`).join(" | ") : "not reported",
        "Reduced motion": mq("(prefers-reduced-motion: reduce)"),
        "User agent": navigator.userAgent,
      });
    };
    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  return (
    <>
      <div
        ref={probe}
        aria-hidden="true"
        style={{
          position: "fixed",
          visibility: "hidden",
          paddingTop: "env(safe-area-inset-top)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
        }}
      />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {Object.entries(reading).map(([k, v]) => (
            <tr key={k} style={{ borderBottom: "1px solid #eee" }}>
              <th style={{ textAlign: "left", padding: "8px 8px 8px 0", verticalAlign: "top", width: "40%", fontWeight: 600 }}>{k}</th>
              <td style={{ padding: 8, wordBreak: "break-word" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
