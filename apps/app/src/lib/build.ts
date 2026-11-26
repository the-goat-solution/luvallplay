// This build's id (the commit on Vercel, else the build's time), set by
// vite.config.ts. What the app saves on the device carries it, so a newer
// build never reads what an older one saved in another shape.
declare const __APP_BUILD__: string | undefined;

export const BUILD_ID: string = typeof __APP_BUILD__ === "string" && __APP_BUILD__ ? __APP_BUILD__ : "dev";
