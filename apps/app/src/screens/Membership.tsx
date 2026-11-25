// Membership (from Me's membership or join card): joining, or managing what
// you have, all in the app with Stripe for payments, as on the website.
import { Link } from "@tanstack/react-router";
import { useCurrentClub, useT } from "../hooks.tsx";
import { JoinPanel } from "./membership/JoinPanel.tsx";
import { ManageCard } from "./membership/ManageCard.tsx";
import { useMembership } from "./membership/data.ts";

export default function MembershipScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const state = useMembership();
  const s = state.data;
  const cardUpdated = new URLSearchParams(window.location.search).get("card") === "updated";
  return (
    <div className="screen" data-screen="membership" data-state={s ? "ready" : state.isError ? "error" : "loading"}>
      <Link to="/me" className="back">← {t("nav_me")}</Link>
      <h1>{t("me_membership")}</h1>
      {!s ? (
        state.isError ? (
          <p className="notice notice-error" role="alert">{t("me_retry_load")} <button type="button" className="button button-small" onClick={() => void state.refetch()}>↻</button></p>
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
