import path from "node:path";
import type { NextConfig } from "next";

const REPO_ROOT = path.join(import.meta.dirname, "../..");
const production = process.env.VERCEL_ENV === "production";

// The site loads nothing from other origins except Sanity's image CDN, Vercel
// Web Analytics (cookieless) and, when keys are set, Cloudflare Turnstile.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.sanity.io",
  "font-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com https://va.vercel-scripts.com",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  outputFileTracingRoot: REPO_ROOT,
  turbopack: { root: REPO_ROOT },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Previews and branch deployments are never indexed, whatever the Studio says.
          ...(production ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
