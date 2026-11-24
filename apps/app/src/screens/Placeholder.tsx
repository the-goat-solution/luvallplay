// A tab whose real screen hasn't moved into the app yet (Phase 4 moves them
// one at a time). Says so plainly.
import { useCurrentClub, useT } from "../hooks.tsx";
import type { AppKey } from "@luvallplay/i18n/app";

export function Placeholder({ title }: { title: AppKey }) {
  const { config } = useCurrentClub();
  const t = useT(config);
  return (
    <section className="screen stack" data-screen={title}>
      <h1>{t(title)}</h1>
      <div className="card stack">
        <h2>{t("coming_title")}</h2>
        <p className="muted">{t("coming_body")}</p>
      </div>
    </section>
  );
}
