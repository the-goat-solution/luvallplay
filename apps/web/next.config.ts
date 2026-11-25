import path from "node:path";
import type { NextConfig } from "next";
import { applyDatabaseSwitch, guardPreviewDatabase } from "./lib/db-switch";
import { REDIRECTS } from "./lib/redirects";

// Pages built at deploy time read the same database as the running site.
applyDatabaseSwitch();
// Previews never touch the production database (lib/db-switch.ts).
guardPreviewDatabase();

// Player accounts add: Vercel Blob (player photos, shop images: shown from
// *.public.blob.vercel-storage.com, uploaded straight from the browser via
// vercel.com/api/blob) and Google reCAPTCHA (required by Google before it
// sends an SMS sign-in code; loaded only on pages that can send a text).
// Wolf Vision (/profile/wolf-vision) plays a video picked from the device
// (a blob: URL) and downloads its person-detection model from Google's
// MediaPipe model storage; the WebAssembly runtime is served from /mediapipe.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://challenges.cloudflare.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.sanity.io https://*.public.blob.vercel-storage.com",
  "font-src 'self'",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
  "media-src 'self' blob:",
  "connect-src 'self' https://storage.googleapis.com https://api.stripe.com https://*.sanity.io https://challenges.cloudflare.com https://vercel.com/api/blob https://*.blob.vercel-storage.com https://www.google.com/recaptcha/",
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

// Monorepo (Phase 2): the app is apps/web; workspace packages (packages/*)
// are TypeScript source, compiled by Next.
const REPO_ROOT = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@luvallplay/api", "@luvallplay/auth", "@luvallplay/core", "@luvallplay/db", "@luvallplay/i18n", "@luvallplay/modules", "@luvallplay/ui", "@luvallplay/vision"],
  outputFileTracingRoot: REPO_ROOT,
  turbopack: { root: REPO_ROOT },
  // End-to-end test builds only (E2E_BUILD=1): one shared copy of the
  // database driver, so lib/local-neon.ts can point it at a local Postgres.
  // Production builds are unchanged.
  ...(process.env.E2E_BUILD === "1" ? { serverExternalPackages: ["@neondatabase/serverless", "ws"] } : {}),
  experimental: {
    // Receipt photos on the admin Financials form go up through a Server
    // Action. The default 1 MB cap is too small for a PDF invoice; Vercel's
    // own request limit is 4.5 MB, and images are shrunk in the browser
    // first (components/admin/finance/EntryForm.tsx).
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.sanity.io" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  // Every URL that moved (lib/redirects.ts): Wolf Vision, Account and
  // Membership (now Me), and the public leaderboard (now in the Arena).
  async redirects() {
    return REDIRECTS;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // camera=(self): "Take photo" on the Player tab, and Wolf Vision (the Match
            // Analyzer) filming a game. microphone=(self): Wolf Vision listens for racket impacts.
            value: "camera=(self), microphone=(self), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      // The club's font files, readable by the players' app on its own
      // origin (a browser loads a font from another origin only with this).
      // Fonts only: the files are public on the site already.
      { source: "/fonts/:file(.*\\.(?:ttf|otf|woff2?))", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
      { source: "/uploads/:file(Montserrat-.*\\.ttf)", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
};

export default nextConfig;
