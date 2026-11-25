// Membership (from Me's membership or join card): joining, or managing what
// you have, all in the app with Stripe for payments, as on the website.
import { Link } from "@tanstack/react-router";
import { useCurrentClub, useT } from "../hooks.tsx";
import { JoinPanel } from "./membership/JoinPanel.tsx";
import { ManageCard } from "./membership/ManageCard.tsx";
import { useMembership } from "./membership/data.ts";
import { LoadError } from "../components/LoadError.tsx";
import { Icon } from "../components/Icon.tsx";

export default function MembershipScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const state = useMembership();
  const s = state.data;
  const cardUpdated = new URLSearchParams(window.location.search).get("card") === "updated";
  return (
    <div className="screen" data-screen="membership" data-state={s ? "ready" : state.isError ? "error" : "loading"}>
      <Link to="/profile" className="back"><Icon name="chevronLeft" size={20} />{t("nav_profile")}</Link>
      <h1>{t("me_membership")}</h1>
      {!s ? (
        state.isError ? (
          <LoadError onRetry={() => void state.refetch()} />
        ) : (
          <div className="skeleton skeleton-tall" aria-busy="true" />
        )
      ) : s.membership ? (
        <ManageCard m={s.membership} state={s} cardUpdated={cardUpdated} />
      ) : (
        <JoinPanel state={s} />
      )}
    </div>
  );
}
