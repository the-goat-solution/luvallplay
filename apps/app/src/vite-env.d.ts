/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** The home API host, e.g. https://api.luvallplay.com. Empty: this page's own origin. */
  readonly VITE_API_BASE?: string;
  /** More API hosts the app may talk to (other regions), space or comma separated. */
  readonly VITE_API_HOSTS?: string;
  /** The app's App Store page (https://apps.apple.com/...). Set once the iOS app is live: it turns on "Get the app" on iPhones and iPads. */
  readonly VITE_APP_STORE_URL?: string;
  /** The app's Google Play page (https://play.google.com/store/apps/details?id=...). Set once the Android app is live. */
  readonly VITE_PLAY_STORE_URL?: string;
}
