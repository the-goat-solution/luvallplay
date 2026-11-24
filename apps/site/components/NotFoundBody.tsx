import { t } from "@/lib/messages";
import { href } from "@/lib/site";
import type { Lang } from "@/lib/types";

export function NotFoundBody({ lang }: { lang: Lang }) {
  const m = t(lang);
  return (
    <div className="wrap page">
      <div className="center">
        <h1 className="h-hero">{m.notFound.title}</h1>
        <p className="lead">{m.notFound.body}</p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href={href(lang, "/")}>{m.notFound.home}</a>
          <a className="btn btn-secondary btn-lg" href={href(lang, "/find-a-club")}>{m.nav.findClub}</a>
          <a className="btn btn-secondary btn-lg" href={href(lang, "/help")}>{m.nav.help}</a>
        </div>
      </div>
    </div>
  );
}
