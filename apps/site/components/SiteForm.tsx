// One plain HTML form for every request. It posts to /api/forms/submit and
// works without JavaScript. Nothing is pre-ticked.
import { t } from "@/lib/messages";
import { REQUIRED, type Kind } from "@/lib/forms-shared";
import { href } from "@/lib/site";
import type { Content, Lang } from "@/lib/types";

export function SiteForm({ kind, lang, content }: { kind: Kind; lang: Lang; content: Content }) {
  const f = t(lang).form;
  const req = (name: string) => (REQUIRED[kind] as string[]).includes(name);
  const text = (name: string, label: string, opts: { type?: string; autoComplete?: string; required?: boolean; maxLength?: number } = {}) => (
    <label className="field">
      <span>{label}</span>
      <input name={name} type={opts.type ?? "text"} autoComplete={opts.autoComplete} required={opts.required ?? req(name)} maxLength={opts.maxLength ?? 160} />
    </label>
  );
  const sport = (
    <label className="field">
      <span>{f.sport}</span>
      <select name="sport" defaultValue="">
        <option value="">–</option>
        {content.sports.map((s) => <option key={s.key} value={s.key}>{s.name[lang]}</option>)}
        <option value="other">{f.sportOther}</option>
      </select>
    </label>
  );
  const consent = kind === "contact" || kind === "walkthrough" || kind === "invite" ? f.consentReply : f.consentUpdates;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return (
    <form className="card form" method="post" action="/api/forms/submit">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="locale" value={lang} />
      <div className="hp" aria-hidden="true">
        <label>{f.honeypot}<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {kind === "waitlist" ? (
        <fieldset className="radios">
          <legend>{f.role}</legend>
          <div>
            <label className="pick"><input type="radio" name="role" value="organiser" required />{f.organiser}</label>
            <label className="pick"><input type="radio" name="role" value="player" required />{f.player}</label>
          </div>
        </fieldset>
      ) : null}
      <div className="field-row">
        {kind === "app" ? null : text("name", f.name, { autoComplete: "name", maxLength: 120 })}
        {text("email", f.email, { type: "email", autoComplete: "email", required: true, maxLength: 254 })}
      </div>
      {kind === "waitlist" || kind === "walkthrough" || kind === "invite" ? (
        <>
          <div className="field-row">
            {text("club", req("club") ? f.club : f.clubOptional, { autoComplete: "organization" })}
            {sport}
          </div>
          {text("city", f.city, { autoComplete: "address-level2", maxLength: 120 })}
        </>
      ) : null}
      {kind === "invite" ? (
        <>
          {text("organiserEmail", f.organiserEmail, { type: "email", required: false, maxLength: 254 })}
          <label className="check"><input type="checkbox" name="mentionMe" value="yes" /><span>{f.mentionMe}</span></label>
        </>
      ) : null}
      {kind === "contact" || kind === "walkthrough" ? (
        <label className="field">
          <span>{kind === "contact" ? f.message : f.messageOptional}</span>
          <textarea name="message" required={req("message")} maxLength={4000} />
        </label>
      ) : null}
      <label className="check"><input type="checkbox" name="consent" value="yes" required /><span>{consent}</span></label>
      {siteKey ? (
        <>
          <div className="cf-turnstile" data-sitekey={siteKey} data-language={lang} />
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
        </>
      ) : null}
      <button className="btn btn-primary btn-lg" type="submit">{f.submit[kind]}</button>
      <p className="form-foot"><a href={href(lang, "/privacy")}>{f.privacyLink}</a></p>
    </form>
  );
}
