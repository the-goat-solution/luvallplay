// A club's mark wherever the screen holds more than one club: its crest, or
// its initials on its own colour, and its name. With one club there is
// nothing to tell apart, so ScopeTag shows nothing.
import { useCallback } from "react";
import { useCurrentClub, useMode, useMultiClub, useScopeClub, type Club, type ClubConfig } from "../hooks.tsx";
import { initials } from "../lib/home.ts";

/** The club's colour on the element, as a custom property (the page's policy allows no inline styles). */
function useClubColour(config: ClubConfig | null) {
  const mode = useMode();
  const colour = config?.theme[mode].primary ?? null;
  const onColour = config?.theme[mode]["on-primary"] ?? null;
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      if (colour) el.style.setProperty("--club", colour);
      else el.style.removeProperty("--club");
      if (onColour) el.style.setProperty("--on-club", onColour);
      else el.style.removeProperty("--on-club");
    },
    [colour, onColour],
  );
}

/** The round mark: the crest on a light disc, or initials on the club's colour. */
export function ClubBadge({ club, config, size = "small" }: { club: Club; config: ClubConfig | null; size?: "small" | "head" }) {
  const ref = useClubColour(config);
  const logo = config?.theme.logoUrl;
  return (
    <span className={`club-badge club-badge-${size}${logo ? " club-badge-logo" : ""}`} ref={ref} aria-hidden="true">
      {logo ? <img src={logo} alt="" width={40} height={40} /> : initials(club.name)}
    </span>
  );
}

/** The mark and the name, as a label on a card or a row. */
export function ClubTag({ club, config, quiet = false }: { club: Club; config: ClubConfig | null; quiet?: boolean }) {
  return (
    <span className={`club-tag${quiet ? " club-tag-quiet" : ""}`}>
      <ClubBadge club={club} config={config} />
      <span className="club-tag-name">{club.name}</span>
    </span>
  );
}

/** The tag of the club this part of the screen belongs to, when the person has more than one. */
export function ScopeTag({ quiet = false }: { quiet?: boolean }) {
  const multi = useMultiClub();
  const scope = useScopeClub();
  const { config } = useCurrentClub();
  if (!multi || !scope) return null;
  return <ClubTag club={scope} config={config} quiet={quiet} />;
}
