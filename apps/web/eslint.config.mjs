import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  // Build output and vendored files copied in at build time (MediaPipe's
  // WebAssembly glue): not our code.
  { ignores: [".next/**", "public/mediapipe/**", "node_modules/**", "docs/screenshots/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
  {
    // New in eslint-config-next 16 (react-hooks v7, written for the React
    // Compiler). They flag patterns in existing screens that work today
    // (setState in an effect, reading refs during render). Warnings for now;
    // fixing them is listed in build plan §3.3 and is needed before turning
    // on the React Compiler.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
    },
  },
];

export default eslintConfig;
