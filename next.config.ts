import type { NextConfig } from "next";
import { applyDatabaseSwitch } from "./lib/db-switch";

// Pages built at deploy time read the same database as the running site.
applyDatabaseSwitch();

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

const nextConfig: NextConfig = {
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
  // Wolf Vision lives in the profile app now; the old standalone page sends people there
  // (query kept, so old Arena links and payment returns still land on the right match).
  async redirects() {
    return [
      { source: "/match-analyzer/label", destination: "/profile/wolf-vision/label", permanent: true },
      { source: "/match-analyzer", destination: "/profile/wolf-vision", permanent: true },
    ];
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
    ];
  },
};

export default nextConfig;
