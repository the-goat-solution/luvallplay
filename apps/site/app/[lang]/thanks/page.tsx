import type { Metadata } from "next";
import { render } from "@/components/Pages";
import { getContent } from "@/lib/content";
import { t } from "@/lib/messages";
import { href } from "@/lib/site";
import type { Lang } from "@/lib/types";

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<{ status?: string; t?: string }> };

export const metadata: Metadata = { title: "Luvallplay", robots: { index: false, follow: false } };

// The page after a form is sent, and where the links in our emails land.
// "confirm" and "remove" show one button: only pressing it changes anything.
export default async function Thanks({ params, searchParams }: Props) {
  const lang = (await params).lang as Lang;
  const { status = "pending", t: token = "" } = await searchParams;
  const content = await getContent();
  const m = t(lang);
  const th = m.thanks;
  const copy: Record<string, [string, string]> = {
    pending: [th.pendingTitle, th.pendingBody],
    "pending-preview": [th.pendingTitle, `${th.pendingBody} ${th.previewNote}`],
    confirmed: [th.confirmedTitle, th.confirmedBody],
    removed: [th.removedTitle, th.removedBody],
    invalid: [th.invalidTitle, th.invalidBody],
    rate: [th.rateTitle, th.rateBody],
    error: [th.errorTitle, th.errorBody],
    confirm: [m.email.confirmButton, m.email.confirmIntro],
    remove: [m.email.remove, th.removedBody],
  };
  const [title, body] = copy[status] ?? copy.error;
  const action = status === "confirm" || status === "remove" ? status : null;
  return render(lang, "/thanks", content, (
    <div className="wrap page">
      <div className="center">
        <h1 className="h-page">{title}</h1>
        {action === "remove" ? null : <p className="lead" role="status">{body}</p>}
        {action ? (
          <form method="post" action={`/api/forms/${action}`}>
            <input type="hidden" name="t" value={token} />
            <input type="hidden" name="locale" value={lang} />
            <button className={`btn btn-lg ${action === "confirm" ? "btn-primary" : "btn-secondary"}`} type="submit">{title}</button>
          </form>
        ) : (
          <a className="btn btn-primary btn-lg" href={href(lang, "/")}>{th.back}</a>
        )}
      </div>
    </div>
  ));
}
