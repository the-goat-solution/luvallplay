// A screen or card whose data couldn't load: said out loud (role=alert),
// with "Try again". The same on every screen.
import { useCurrentClub, useT } from "../hooks.tsx";

export function LoadError({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) {
  const { config } = useCurrentClub();
  const t = useT(config);
  return (
    <div className={compact ? "notice notice-error load-error" : "card stack load-error"} role="alert" data-testid="load-error">
      <p>{t("me_retry_load")}</p>
      <div>
        <button type="button" className="button button-small" onClick={onRetry}>{t("retry")}</button>
      </div>
    </div>
  );
}
