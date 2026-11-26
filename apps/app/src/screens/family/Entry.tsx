// The way into Family from My profile: one row per club that has Juniors on.
// Renders nothing for a club without it, so nobody else sees a change.
import { Link } from "@tanstack/react-router";
import { Icon } from "../../components/Icon.tsx";
import { useCurrentClub, useEnterClub } from "../../hooks.tsx";
import { useFamilyOn } from "./data.ts";
import { useFamilyT } from "./words.ts";

export function FamilyEntry() {
  const { current } = useCurrentClub();
  const on = useFamilyOn();
  const enter = useEnterClub();
  const ft = useFamilyT();
  if (!on || !current) return null;
  return (
    <Link to="/family" className="card row" onClick={enter} data-entry="family">
      <span className="row-text">
        <strong>{ft("family_entry")}</strong>
        <span className="muted small">{ft("family_entry_sub", { club: current.name })}</span>
      </span>
      <Icon name="chevronRight" size={20} />
    </Link>
  );
}
