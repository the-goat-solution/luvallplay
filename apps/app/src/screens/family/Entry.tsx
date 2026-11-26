// The way into Family from My profile: one row per club that has Juniors on.
// Renders nothing for a club without it, so nobody else sees a change.
import { Link } from "@tanstack/react-router";
import { Icon } from "../../components/Icon.tsx";
import { format } from "@luvallplay/i18n/format";
import { juniorsEntry } from "@luvallplay/i18n/juniors-entry";
import { useCurrentClub, useEnterClub, useLang } from "../../hooks.tsx";

export function FamilyEntry() {
  // Only what the row needs is imported here: the Family screen's own code and words load when it opens.
  const { current, config } = useCurrentClub();
  const on = !!config && config.modules.includes("juniors");
  const enter = useEnterClub();
  const lang = useLang();
  const words = juniorsEntry[lang];
  if (!on || !current) return null;
  return (
    <Link to="/family" className="card row" onClick={enter} data-entry="family">
      <span className="row-text">
        <strong>{words.family_entry}</strong>
        <span className="muted small">{format(words.family_entry_sub, { club: current.name }, lang)}</span>
      </span>
      <Icon name="chevronRight" size={20} />
    </Link>
  );
}
