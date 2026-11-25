import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@luvallplay/ui/tokens.css";
import "./styles/app.css";
import { storage, store } from "./app.ts";
import { watchInstall } from "./lib/install.ts";
import { clearOffline, restoreCache, saveCache } from "./lib/offline.ts";
import { startQueue } from "./lib/queue.ts";
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
watchInstall();

// The app shell from this device when there's no connection (public/sw.js). Built pages only.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
