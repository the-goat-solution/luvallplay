import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  // Build output and vendored files copied in at build time (MediaPipe's
  // WebAssembly glue): not our code.
  { ignores: [".next/**", "public/mediapipe/**", "node_modules/**", "docs/screenshots/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // eslint-config-next 16's React Compiler rules (react-hooks v7) are
      // errors: every screen follows them (fixed in Phase 2), which is what
      // turning on the React Compiler needs.
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
      "react-hooks/purity": "error",
      "react-hooks/static-components": "error",
      // Plain <img> on purpose: player photos, shop images and gallery come
      // from Vercel Blob and the Sanity CDN already sized, previews are blob:
      // URLs, and logos are tiny. next/image would send every one through
      // Vercel Image Optimization, which the Hobby plan caps.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
