// A drawn, stripped-down version of the admin "Today" page Three Wolves
// Badminton Club uses (apps/web/app/admin/(console)/page.tsx). It's an
// illustration with sample numbers, labelled as one, in both languages.
import { Icon } from "./icons";
import { t } from "@/lib/messages";
import type { Lang } from "@/lib/types";

export function AdminMock({ lang }: { lang: Lang }) {
  const a = t(lang).admin;
  const groups: [string, [string, string?][]][] = [
    ["", [[a.nav.today]]],
    [a.groups.play, [[a.nav.playDays], [a.nav.schedule], [a.nav.arena]]],
    [a.groups.people, [[a.nav.members], [a.nav.inbox, "2"]]],
    [a.groups.money, [[a.nav.ledger], [a.nav.shop, "1"]]],
  ];
  return (
    <figure className="admin-mock">
      <div className="am-window" role="img" aria-label={a.caption}>
        <div className="am-bar" aria-hidden="true">
          <span className="am-dots"><i /><i /><i /></span>
          <span className="am-url">threewolvesbadminton.org/admin</span>
        </div>
        <div className="am-body" aria-hidden="true">
          <aside className="am-side">
            <span className="am-club"><img src="/clubs/three-wolves.png" alt="" width={28} height={24} />Three Wolves</span>
            {groups.map(([label, items], gi) => (
              <div key={gi} className="am-group">
                {label ? <span className="am-glabel">{label}</span> : null}
                {items.map(([name, badge], i) => (
                  <span key={name} className={`am-item${gi === 0 && i === 0 ? " on" : ""}`}>
                    {name}
                    {badge ? <b className="am-badge">{badge}</b> : null}
                  </span>
                ))}
              </div>
            ))}
          </aside>
          <div className="am-main">
            <div className="am-head">
              <b>{a.title}</b>
              <span>{a.subtitle}</span>
            </div>
            <div className="am-sec">
              <span className="am-stitle">{a.next}</span>
              <div className="am-next">
                <div>
                  <b>{a.when}</b>
                  <span>{a.day}</span>
                </div>
                <div className="am-state">
                  <span className="am-pill">{a.full}</span>
                  <span>{a.fullNote}</span>
                </div>
              </div>
              <div className="am-tiles">
                {a.tiles.map(([label, value, hint], i) => (
                  <div key={label} className={i === 2 ? "warn" : undefined}>
                    <span>{label}</span>
                    <b>{value}</b>
                    <small>{hint}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="am-sec">
              <span className="am-stitle">{a.attention}</span>
              <ul className="am-todo">
                {a.todo.map(([n, text, action]) => (
                  <li key={text}><i>{n}</i><span>{text}</span><em>{action}<Icon name="arrow" size={14} strokeWidth={2.2} /></em></li>
                ))}
              </ul>
            </div>
            <div className="am-quick">{a.quick.map((q) => <span key={q}>{q}</span>)}</div>
          </div>
        </div>
      </div>
      <figcaption className="phone-cap">{a.caption}</figcaption>
    </figure>
  );
}
