// The Luvallplay store apps (build plan §4): the players' app (apps/app)
// bundled into a native shell. One app for every club (decision A).
//
// `appId` is the store identity (Google Play's package name, later Apple's
// bundle id). It can never change once the app is published.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.luvallplay.app",
  appName: "Luvallplay",
  // The players' app, built for the shell by `pnpm --filter native web`.
  webDir: "www",
  android: {
    // Pages are served from https://localhost inside the app (the API allows
    // that origin); no plain-http content, no debugging of release builds.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
