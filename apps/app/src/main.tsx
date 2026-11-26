import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
// Luvallplay's own fonts (bundled; only the weights the app uses). A club's
// fonts come from its own website (lib/club-fonts.ts).
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@luvallplay/ui/tokens.css";
import "@luvallplay/ui/system.css";
import "./styles/app.css";
import { storage, store } from "./app.ts";
import { watchInstall } from "./lib/install.ts";
import { clearOffline, restoreCache, saveCache } from "./lib/offline.ts";
import { startQueue } from "./lib/queue.ts";
import { isNative } from "./lib/native/platform.ts";
import { loadLang, pickLang } from "./lib/messages.ts";
import { resolveMode } from "./lib/theme.ts";
import { router } from "./router.tsx";

// The right light or dark before the first paint.
document.documentElement.setAttribute("data-theme", resolveMode(store.get().theme, window.matchMedia("(prefers-color-scheme: dark)").matches));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A refused token or a missing club won't get better by asking again.
      retry: (count, err) => ![401, 403, 404].includes((err as { status?: number }).status ?? 0) && count < 2,
      refetchOnWindowFocus: false,
      // Kept a day (not five minutes), so the saved screens stay saved while unused.
      gcTime: 24 * 3600_000,
    },
  },
});

// In the store app the token comes from the phone's secret store: wait for
// it, so the first screen is the right one (Home, not sign-in). At once in a browser.
await store.ready();

// What was on screen last time opens at once, also offline (lib/offline.ts).
restoreCache(queryClient, storage, store.get().token);
saveCache(queryClient, storage, () => store.get().token);
store.subscribe(() => {
  if (!store.get().token) {
    clearOffline(storage);
    queryClient.clear();
  }
});
startQueue(queryClient);
// The store app is installed already and carries its own files: no "Install
// the app" and no service worker there (it would only keep a second copy,
// and stores reject apps that offer to install themselves).
if (!isNative()) watchInstall();

// The app shell from this device when there's no connection (public/sw.js). Built pages only.
if (import.meta.env.PROD && "serviceWorker" in navigator && !isNative()) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// The text of the language the first screen will be in, before it draws
// (English is built in). Without a connection or in time: English for now,
// and the screens draw again when it arrives.
await Promise.race([loadLang(pickLang(store.get().lang, null, navigator.language)).catch(() => {}), new Promise((done) => setTimeout(done, 3000))]);

// The store app only: links that open the app land on their screen, and the
// Android back button closes sheets before it goes back (lib/native/shell.ts).
if (isNative()) {
  void import("./lib/native/shell.ts").then((m) => m.startShell({ go: (path) => router.history.push(path), back: () => router.history.back() }));
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
