// "Your match stats" email from Wolf Vision: sent after a free (non-Arena)
// session to the players who were added by email (not registered yet).
// Wolf Vision's own look, the "night court": deep navy, floodlight yellow,
// coral vs teal for the two pairs, bronze for the brand. Table layout with
// inline styles only, so it survives Gmail, Outlook and Apple Mail.
// Pure (no env or imports) so it can be unit-tested.

export type StatsEmailPlayer = { name: string; hits: number; distance: number; topSpeed: number; team: 0 | 1 };
export type StatsEmailInput = {
  siteUrl: string;
  recipientName: string;
  /** Index into players of the recipient (their row is highlighted). */
  recipientIndex: number;
  recordedBy: string;
  /** Club-local date and time, already formatted ("Fri 21 Nov 2026, 7:40 pm"). */
  playedAt: string;
  teams: [string, string];
  duration: number;
  rallies: number;
  longestRally: number;
  avgRallyShots: number;
  fastestShotKmh: number | null;
  players: StatsEmailPlayer[];
  /** During the free period, e.g. "28 February 2027". */
  freeUntil?: string | null;
};

const NIGHT = "#08131f";
const NIGHT_2 = "#0d2033";
const NIGHT_3 = "#14304a";
const FLOOD = "#ffd54a";
const TEAL = "#2fd4b5";
const BRONZE = "#e2ae60";
const STEEL = "#b4ccd9";
const CREAM = "#fcfbf2";
const PLAYER_COLORS = ["#ff6b57", "#ffb4a6", "#2fd4b5", "#a4f2e2"];
const SANS = "'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const statsEmailSubject = (recordedBy: string) => `Your match stats from Wolf Vision 🐺 (recorded by ${recordedBy})`;

export function renderStatsEmail(input: StatsEmailInput): { subject: string; html: string; text: string } {
  const site = input.siteUrl.replace(/\/$/, "");
  const first = input.recipientName.trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Kia ora ${esc(first)},` : "Kia ora,";
  const logoUrl = esc(`${site}/uploads/three-wolves-logo-white-mini.png`);
  const joinUrl = esc(`${site}/login`);
  const me = input.players[input.recipientIndex];
  const fastest = input.fastestShotKmh != null ? `${input.fastestShotKmh} km/h` : "–";
  const subject = statsEmailSubject(input.recordedBy);
  const preheader = me
    ? `${me.hits} hits, ${me.distance.toFixed(0)} m covered, top speed ${me.topSpeed.toFixed(1)} m/s. Here's the whole match.`
    : "Here's the whole match.";

  const kpi = (value: string, label: string) => `
    <td width="33%" valign="top" style="padding:6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NIGHT};border:1px solid rgba(255,255,255,0.08);border-radius:12px">
        <tr><td style="padding:14px 12px">
          <div style="font-family:${SANS};font-size:22px;font-weight:900;font-style:italic;color:${FLOOD};line-height:1.1">${esc(value)}</div>
          <div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${STEEL};padding-top:6px">${esc(label)}</div>
        </td></tr>
      </table>
    </td>`;

  const row = (p: StatsEmailPlayer, i: number) => {
    const mine = i === input.recipientIndex;
    const bg = mine ? "rgba(255,213,74,0.12)" : "transparent";
    const cell = `padding:11px 10px;border-top:1px solid rgba(255,255,255,0.07);font-family:${SANS};font-size:14px;color:${CREAM};background:${bg}`;
    return `
      <tr>
        <td style="${cell}">
          <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${PLAYER_COLORS[i] ?? STEEL};margin-right:8px;vertical-align:middle"></span><span style="font-weight:${mine ? 800 : 600};vertical-align:middle">${esc(p.name)}${mine ? ` <span style="color:${FLOOD};font-size:11px;font-weight:800;letter-spacing:1px">YOU</span>` : ""}</span>
        </td>
        <td align="right" style="${cell};font-weight:800">${p.hits}</td>
        <td align="right" style="${cell}">${p.distance.toFixed(1)} m</td>
        <td align="right" style="${cell}">${p.topSpeed.toFixed(1)} m/s</td>
      </tr>`;
  };
  const th = `padding:8px 10px;font-family:${SANS};font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${BRONZE}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${NIGHT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NIGHT}">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${NIGHT_2};border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden">
      <tr><td style="padding:22px 26px;background:${NIGHT};border-bottom:3px solid ${FLOOD}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle"><img src="${logoUrl}" width="44" alt="Three Wolves" style="display:block;border:0;height:auto"></td>
          <td valign="middle" align="right" style="font-family:${SANS};font-size:20px;font-weight:800;letter-spacing:3px;color:${BRONZE};text-transform:uppercase">Wolf Vision <span style="display:inline-block;vertical-align:middle;background:${BRONZE};color:${NIGHT};font-size:9px;letter-spacing:1.5px;padding:3px 6px;border-radius:5px">BETA</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 26px 6px">
        <div style="font-family:${SANS};font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${TEAL}">✦ AI match stats</div>
        <h1 style="margin:8px 0 14px;font-family:${SANS};font-size:26px;line-height:1.2;font-weight:900;font-style:italic;text-transform:uppercase;color:${CREAM}">Your match, by the numbers</h1>
        <p style="margin:0 0 10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${STEEL}">${greeting}</p>
        <p style="margin:0 0 6px;font-family:${SANS};font-size:15px;line-height:1.6;color:${STEEL}"><b style="color:${CREAM}">${esc(input.recordedBy)}</b> filmed your doubles game with Wolf Vision, the Three Wolves AI tracker. It followed all four players and counted every hit. Here's how it went.</p>
        <p style="margin:0;font-family:${SANS};font-size:13px;color:${STEEL};opacity:0.85">${esc(input.playedAt)}</p>
      </td></tr>
      <tr><td style="padding:18px 20px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:14px;overflow:hidden">
          <tr>
            <td width="46%" style="padding:14px;background:#3b2230;background:linear-gradient(105deg,rgba(255,107,87,0.35),rgba(255,107,87,0.08));font-family:${SANS};font-size:13px;font-weight:900;font-style:italic;letter-spacing:1px;text-transform:uppercase;color:${CREAM}">${esc(input.teams[0])}</td>
            <td width="8%" align="center" style="background:${NIGHT_3};font-family:${SANS};font-size:16px;font-weight:900;color:${FLOOD}">VS</td>
            <td width="46%" align="right" style="padding:14px;background:#123a3a;background:linear-gradient(255deg,rgba(47,212,181,0.35),rgba(47,212,181,0.08));font-family:${SANS};font-size:13px;font-weight:900;font-style:italic;letter-spacing:1px;text-transform:uppercase;color:${CREAM}">${esc(input.teams[1])}</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:10px 20px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>${kpi(clock(input.duration), "Duration")}${kpi(String(input.rallies), "Rallies")}${kpi(String(input.longestRally), "Longest rally")}</tr>
          <tr>${kpi(String(input.avgRallyShots), "Avg shots / rally")}${kpi(fastest, "Fastest shot")}${kpi(me ? String(me.hits) : "–", "Your hits")}</tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 26px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr><td style="${th}">Player</td><td align="right" style="${th}">Hits</td><td align="right" style="${th}">Distance</td><td align="right" style="${th}">Top speed</td></tr>
          ${input.players.map(row).join("")}
        </table>
        <p style="margin:12px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${STEEL};opacity:0.8">Hits come from the shuttle's path, racket swings and the sound of each impact. Distance and speed are measured on court from the video. Numbers from AI tracking can be a little off.</p>
      </td></tr>
      <tr><td style="padding:22px 26px 30px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NIGHT_3};border:1px solid rgba(255,213,74,0.35);border-radius:14px">
          <tr><td style="padding:20px">
            <div style="font-family:${SANS};font-size:16px;font-weight:900;font-style:italic;text-transform:uppercase;color:${CREAM}">Track your own matches</div>
            <p style="margin:8px 0 16px;font-family:${SANS};font-size:14px;line-height:1.55;color:${STEEL}">Join Three Wolves to keep your stats, take on other pairs in the Arena and film your games with Wolf Vision.${input.freeUntil ? ` It's free to try until ${esc(input.freeUntil)}.` : ""}</p>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${FLOOD}">
              <a href="${joinUrl}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:14px;font-weight:900;font-style:italic;letter-spacing:1px;text-transform:uppercase;color:${NIGHT};text-decoration:none">Join the pack →</a>
            </td></tr></table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 26px 22px;border-top:1px solid rgba(255,255,255,0.07);font-family:${SANS};font-size:11px;line-height:1.6;color:${STEEL};opacity:0.75">
        You got this email because ${esc(input.recordedBy)} added you to a Wolf Vision session at Three Wolves Badminton Club. The video stayed on their phone: only these numbers were sent. Questions? Email <a href="mailto:threewolvesbadminton@gmail.com" style="color:${BRONZE}">threewolvesbadminton@gmail.com</a>.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `${first ? `Kia ora ${first},` : "Kia ora,"}`,
    "",
    `${input.recordedBy} filmed your doubles game with Wolf Vision (${input.playedAt}).`,
    `${input.teams[0]} vs ${input.teams[1]}`,
    "",
    `Duration ${clock(input.duration)} · ${input.rallies} rallies · longest rally ${input.longestRally} · ${input.avgRallyShots} shots a rally · fastest shot ${fastest}`,
    "",
    ...input.players.map(
      (p, i) => `${p.name}${i === input.recipientIndex ? " (you)" : ""}: ${p.hits} hits, ${p.distance.toFixed(1)} m, top speed ${p.topSpeed.toFixed(1)} m/s`,
    ),
    "",
    `Track your own matches: ${site}/login`,
    "",
    "Three Wolves Badminton Club · threewolvesbadminton@gmail.com",
  ].join("\n");

  return { subject, html, text };
}
