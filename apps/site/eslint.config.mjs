import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "content/generated/**"] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Plain <img>: logos and illustrations are small SVGs, and Sanity images
      // come from its CDN already sized (lib/image.ts).
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
