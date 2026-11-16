import { getCurrentPlayer } from "@/lib/player-auth";
import { defaultDisplayName } from "@/lib/player-db";
import { getRecaptchaSiteKey, getSmsUsage } from "@/lib/sms";
import { AppCard, DetailsCard, PhoneCard, PrivacyCard, WelcomeCard } from "@/components/profile/AccountSections";
import { MessagesPanel } from "@/components/profile/MessagesPanel";
import { listThreadsForPlayer } from "@/lib/messages-db";
import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";

export default async function AccountPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const [sms, siteKey, threads] = await Promise.all([
    getSmsUsage().catch(() => null),
    getRecaptchaSiteKey().catch(() => null),
    listThreadsForPlayer(player.id),
  ]);
  const customDisplayName = player.displayName !== defaultDisplayName(player.firstName, player.lastName, player.email);

  return (
    <>
      <h1 className={styles.pageTitle}>
        <PT k="tab_account" />
      </h1>
      <div className={styles.split}>
        <div className={styles.stack}>
          {!player.welcomeCardDismissed && <WelcomeCard firstName={player.firstName} />}
          <MessagesPanel initialThreads={threads} />
          <AppCard />
        </div>
        <div className={styles.stack}>
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
          <PrivacyCard leaderboardVisible={player.leaderboardVisible} />
        </div>
      </div>
    </>
  );
}
