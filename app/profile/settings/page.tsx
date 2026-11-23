import { getCurrentPlayer } from "@/lib/player-auth";
import { defaultDisplayName } from "@/lib/player-db";
import { getRecaptchaSiteKey, getSmsUsage } from "@/lib/sms";
import { listApiTokens, listWebhookEndpoints } from "@/lib/webhooks";
import { getSiteUrl } from "@/lib/email-layout";
import { db } from "@/lib/admin-access";
import { getAccess, hasAdminAccess } from "@/lib/admin-roles";
import { AppCard, DetailsCard, PhoneCard, PrivacyCard } from "@/components/profile/AccountSections";
import { AvatarCard } from "@/components/profile/AvatarCard";
import { ConnectedApps } from "@/components/profile/player/ConnectedApps";
import { SettingsAdminCard } from "@/components/profile/me/SettingsAdminCard";
import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";
import m from "@/components/profile/me/me.module.css";

// Settings (⚙ on the Me page): details, phone, language, privacy
// (leaderboard opt-out), connected apps (moved from the Player tab), install
// guide (web only), export, delete account, sign out. Two columns on
// tablets and unfolded foldables.

export default async function SettingsPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const [sms, siteKey, tokens, webhooks, access] = await Promise.all([
    getSmsUsage().catch(() => null),
    getRecaptchaSiteKey().catch(() => null),
    hasDb ? listApiTokens(player.id).catch(() => []) : Promise.resolve([]),
    hasDb ? listWebhookEndpoints(player.id).catch(() => []) : Promise.resolve([]),
    hasDb ? getAccess(db, player.id, player.email).catch(() => null) : Promise.resolve(null),
  ]);
  const customDisplayName = player.displayName !== defaultDisplayName(player.firstName, player.lastName, player.email);
  const initials = `${player.firstName.trim()[0] ?? player.email[0] ?? "?"}${player.lastName.trim()[0] ?? ""}`.toUpperCase();

  return (
    <>
      <h1 className={styles.pageTitle}>
        <PT k="settings_title" />
      </h1>
      <div className={m.settingsGrid}>
        <div className={styles.stack}>
          {access && hasAdminAccess(access) && <SettingsAdminCard />}
          <AvatarCard url={player.avatarUrl} initials={initials} />
          <DetailsCard
            player={{
              email: player.email,
              firstName: player.firstName,
              lastName: player.lastName,
              displayName: player.displayName,
              customDisplayName,
              phone: player.phone,
              phoneVerified: player.phoneVerified,
              lang: player.lang,
              leaderboardVisible: player.leaderboardVisible,
            }}
          />
          <PhoneCard
            phone={player.phone}
            verified={player.phoneVerified}
            smsAvailable={Boolean(sms?.available)}
            smsConfigured={Boolean(sms?.configured && sms.switchedOn && sms.limit > 0)}
            recaptchaSiteKey={siteKey}
          />
        </div>
        <div className={styles.stack}>
          <PrivacyCard leaderboardVisible={player.leaderboardVisible} />
          <ConnectedApps tokens={tokens} webhooks={webhooks} siteUrl={getSiteUrl()} />
          <AppCard />
        </div>
      </div>
    </>
  );
}
