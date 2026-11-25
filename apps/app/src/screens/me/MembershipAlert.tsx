// On Home, the one membership fact that needs doing something about: a
// payment that didn't go through, or a membership about to end that won't
// renew (within two weeks). Everything else about the membership is in My
// profile. With several clubs it carries its club's tag and opens that
// club's Membership page.
import { Link } from "@tanstack/react-router";
import { useEnterClub } from "../../hooks.tsx";
import { dayLabel } from "../../lib/format.ts";
import { ScopeTag } from "../../components/ClubTag.tsx";
import { Icon } from "../../components/Icon.tsx";
import { usePlace } from "./parts.tsx";
import type { Me } from "./data.ts";
import { needsAttention } from "../../lib/home.ts";

export function MembershipAlert({ m }: { m: Me["membership"] }) {
  const { t, locale } = usePlace();
  const enter = useEnterClub();
  const kind = needsAttention(m);
  if (!kind || !m) return null;
  return (
    <div className={`notice alert alert-${kind}`} role={kind === "past_due" ? "alert" : "status"}>
      <ScopeTag quiet />
      <p className="icon-line alert-text">
        <Icon name={kind === "past_due" ? "card" : "calendar"} size={20} />
        {kind === "past_due" ? t("alert_past_due") : t("alert_ending", { date: dayLabel(m.periodEnd, locale) })}
      </p>
      <div>
        <Link to="/membership" className={`button button-small ${kind === "past_due" ? "button-primary" : ""}`} onClick={enter}>
          {kind === "past_due" ? t("alert_past_due_cta") : t("alert_ending_cta")}
        </Link>
      </div>
    </div>
  );
}
