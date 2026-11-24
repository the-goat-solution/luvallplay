/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** The home API host, e.g. https://api.luvallplay.com. Empty: this page's own origin. */
  readonly VITE_API_BASE?: string;
  /** More API hosts the app may talk to (other regions), space or comma separated. */
  readonly VITE_API_HOSTS?: string;
}
