"use client";
// Light, dark or follow the device. The choice is kept in this browser only
// (localStorage "theme"); app/[lang]/layout.tsx applies it before first paint.
import { useSyncExternalStore } from "react";

const MODES = ["auto", "light", "dark"] as const;
type Mode = (typeof MODES)[number];
const listeners = new Set<() => void>();

function read(): Mode {
  const v = document.documentElement.dataset.theme;
  return v === "light" || v === "dark" ? v : "auto";
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function choose(mode: Mode) {
  if (mode === "auto") {
    delete document.documentElement.dataset.theme;
    try { localStorage.removeItem("theme"); } catch {}
  } else {
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem("theme", mode); } catch {}
  }
  listeners.forEach((fn) => fn());
}

export function ThemeSwitch({ label, names }: { label: string; names: [string, string, string] }) {
  const current = useSyncExternalStore(subscribe, read, () => "auto" as Mode);
  return (
    <div className="theme" role="group" aria-label={label}>
      {MODES.map((mode, i) => (
        <button key={mode} type="button" aria-pressed={current === mode} onClick={() => choose(mode)}>{names[i]}</button>
      ))}
    </div>
  );
}
