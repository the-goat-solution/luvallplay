// Links in player emails (cutover gap B4, phase-4-cutover.md §3): to the
// players' app once its address is set (PLAYER_APP_URL), to the website's
// /profile pages as today until then. Unset, every email is unchanged.
import { playerAppUrl } from "./app-handover";
import { defaultTenantSlug } from "./tenant-members";

/**
 * The app's screen `appPath` when the app's address is set, else
 * `websiteUrl`. With `club`, the screen is opened in this deployment's club
 * (`?club=<slug>`, for a person in several clubs).
 */
export function playerLink(appPath: string, websiteUrl: string, opts: { club?: boolean } = {}): string {
  const app = playerAppUrl();
  if (!app) return websiteUrl;
  if (!opts.club) return `${app}${appPath}`;
  const sep = appPath.includes("?") ? "&" : "?";
  return `${app}${appPath}${sep}club=${encodeURIComponent(defaultTenantSlug())}`;
}

/** Whether player emails go to the app (and the app's sign-in email leaves out the website's one-tap button). */
export const linksToApp = (): boolean => playerAppUrl() !== null;
