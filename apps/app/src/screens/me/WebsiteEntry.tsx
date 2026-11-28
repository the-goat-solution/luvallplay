// My profile: back to the club's own website (a gap the cutover listed: the
// website's profile has "Back to site"). One row per club that has a website;
// it opens outside the app (in the store app, the in-app browser: lib/native/open.ts).
import { useCurrentClub, useT } from "../../hooks.tsx";
import { Icon } from "../../components/Icon.tsx";
import { webHref } from "./parts.tsx";

export function WebsiteEntry() {
  const { current, config } = useCurrentClub();
  const t = useT(config);
  const href = webHref(config?.club.webUrl ?? null, "/");
  if (!href || !current) return null;
  return (
    <a className="card row link-out" href={href} target="_blank" rel="noopener noreferrer" data-entry="website">
      <span className="row-text">
        <strong>{t("profile_website", { club: current.name })}</strong>
        <span className="muted small">{t("profile_website_sub")}</span>
      </span>
      <Icon name="external" size={20} />
    </a>
  );
}
