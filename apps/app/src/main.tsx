import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@luvallplay/ui/tokens.css";
import "./styles/app.css";
import { store } from "./app.ts";
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
    },
  },
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
