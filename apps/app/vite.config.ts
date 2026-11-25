import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The API hosts the built app may talk to (CSP connect-src). Images may come
// from any https host (a club's logo on its own site, profile photos in
// Blob storage): an image can't read the page or send the session token,
// which only ever goes to connect-src.
// VITE_API_BASE is the home API host ("" = the app's own origin);
// VITE_API_HOSTS adds more (space or comma separated), for example other
// regions' hosts. Keep this list short: it is the app's whole network reach.
const DEFAULT_API_HOSTS = ["https://api.luvallplay.com"];

// Stripe, the card provider (its published CSP requirements): the script, its
// card-field frames, and its API. Nothing else of Stripe's runs until a
// payment step loads it.
const STRIPE = { script: "https://js.stripe.com", frame: "https://js.stripe.com https://hooks.stripe.com", connect: "https://api.stripe.com" };

function apiHosts(env: Record<string, string>): string[] {
  const listed = (env.VITE_API_HOSTS ?? "").split(/[\s,]+/).filter(Boolean);
  const all = [env.VITE_API_BASE, ...listed, ...DEFAULT_API_HOSTS].filter((h): h is string => !!h && /^https?:\/\/[^\s/'";]+$/.test(h));
  return [...new Set(all)];
}

/** A strict Content-Security-Policy in the built page (no inline scripts or styles). Not applied in dev: HMR needs both. */
function csp(env: Record<string, string>): Plugin {
  return {
    name: "luvallplay-csp",
    apply: "build",
    transformIndexHtml(html) {
      const hosts = apiHosts(env).join(" ");
      const policy = [
        "default-src 'self'",
        // Stripe's card form (Payment Element), loaded only on a payment step.
        `script-src 'self' ${STRIPE.script}`,
        "style-src 'self'",
        `img-src 'self' data: https: ${hosts}`,
        "font-src 'self'",
        `connect-src 'self' ${hosts} ${STRIPE.connect}`,
        `frame-src ${STRIPE.frame}`,
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; ");
      return html.replace("<!--csp-->", `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), csp(env)],
    build: { target: "es2022", sourcemap: false },
    server: { port: 5173, strictPort: true, proxy: { "/api": "http://localhost:3000" } },
    preview: { port: 4173, strictPort: true },
  };
});
