import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminToastBridge } from "@/components/admin/AdminToastBridge";
import adminStyles from "@/components/admin/admin.module.css";
import { btn, btnDanger, btnSecondary, card, formatNz, pill } from "@/components/admin/ui";
import { ARENA_SANDBOX, adminResolve, loadWorld, type ChallengeRow, type World } from "@/lib/arena-db";
import { LADDER, LEAGUES, rankName } from "@/lib/ranks";

export const dynamic = "force-dynamic";

async function resolve(id: number, outcome: "posting" | "accepting" | "void" | "as_entered", formData: FormData) {
  "use server";
  await adminResolve(id, outcome, String(formData.get("reason") ?? ""));
  revalidatePath("/admin/challenges");
  const label = outcome === "void" ? "Voided: no points for anyone." : outcome === "as_entered" ? "Confirmed as entered." : "Winner set. Points updated.";
  redirect(`/admin/challenges?toast=${encodeURIComponent(label)}`);
}

const STATUS_STYLE: Record<string, [string, string]> = {
  completed: ["#e6f4ea", "#1e6b34"],
  disputed: ["#fdecea", "#a12a2a"],
  live: ["#fff4e5", "#8a4b00"],
  awaiting: ["#fff4e5", "#8a4b00"],
  accepted: ["#e8f0fe", "#1a4fa0"],
  open: ["#eef", "#334"],
  void: ["#eee", "#555"],
};

function names(world: World, ids: [number, number] | null): string {
  if (!ids) return "—";
  return ids.map((id) => world.players.get(id)?.name ?? `#${id}`).join(" & ");
}

function score(c: ChallengeRow): string {
  if (c.retiredBy) return `${c.retiredBy === "posting" ? "Posting" : "Accepting"} pair retired`;
  if (c.scorePosting === null || c.scoreAccepting === null) return "—";
  return `${c.scorePosting}–${c.scoreAccepting}`;
}

export default async function ChallengesAdminPage() {
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <h1 className={adminStyles.title}>Challenges</h1>
        <AdminNav active="challenges" />
        <p>Database is not configured.</p>
      </div>
    );
  }
  const world = await loadWorld();
  const disputes = world.challenges.filter((c) => c.status === "disputed");
  const recent = [...world.challenges].filter((c) => !["open", "expired", "cancelled"].includes(c.status)).reverse().slice(0, 60);

  // Ladder dry run: where every player with points lands today.
  const counts = new Map<number, number>();
  const withPoints = [...world.ranks.entries()].filter(([, r]) => r.wpTotal > 0);
  for (const [, r] of withPoints) counts.set(r.earned, (counts.get(r.earned) ?? 0) + 1);
  const top = withPoints.sort((a, b) => b[1].wpTotal - a[1].wpTotal).slice(0, 25);

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Challenges</h1>
      <p className={adminStyles.subtitle}>
        Pair challenges in The Arena (<a href="/profile/arena">Profile → Arena</a>). Disputed scores wait here; you can also void any result. Ranks and points
        recalculate straight away.
      </p>
      <AdminNav active="challenges" />
      <AdminToastBridge />
      {ARENA_SANDBOX && (
        <p style={{ ...card, background: "#fff8e1", borderColor: "#f0d48a" }}>
          <strong>Preview sandbox.</strong> On this deployment the Arena uses its own <code>pv_</code> tables: test pairs and games never reach the real
          Arena. Play days and round robin results are the real ones (read only).
        </p>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Disputes ({disputes.length})</h2>
        {disputes.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>Nothing to sort out.</p>
        ) : (
          disputes.map((c) => (
            <div key={c.id} style={{ borderTop: "1px solid #eee", padding: "12px 0" }}>
              <div style={{ fontSize: 14 }}>
                <strong>{names(world, c.postingPlayers)}</strong> (posted) vs <strong>{names(world, c.acceptingPlayers)}</strong>
              </div>
              <div style={{ fontSize: 13, color: "#555", margin: "4px 0" }}>
                Entered: <strong>{score(c)}</strong> by {world.players.get(c.enteredBy ?? 0)?.name ?? "?"} · disputed by{" "}
                {world.players.get(c.disputedBy ?? 0)?.name ?? "?"} {c.playedOn ? `· played ${c.playedOn}` : ""}
              </div>
              {c.disputeNote && <div style={{ fontSize: 13, color: "#333", fontStyle: "italic" }}>“{c.disputeNote}”</div>}
              <form style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input name="reason" placeholder="Note (for a void)" style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
                {c.scorePosting !== null || c.retiredBy ? (
                  <button formAction={resolve.bind(null, c.id, "as_entered")} style={btn}>
                    Score is right
                  </button>
                ) : null}
                <button formAction={resolve.bind(null, c.id, "posting")} style={btnSecondary}>
                  Posting pair won
                </button>
                <button formAction={resolve.bind(null, c.id, "accepting")} style={btnSecondary}>
                  Accepting pair won
                </button>
                <button formAction={resolve.bind(null, c.id, "void")} style={btnDanger}>
                  Void
                </button>
              </form>
            </div>
          ))
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Recent challenges</h2>
        {recent.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>No challenges yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#666" }}>
                  <th style={{ padding: 6 }}>#</th>
                  <th style={{ padding: 6 }}>Posted</th>
                  <th style={{ padding: 6 }}>Pairs</th>
                  <th style={{ padding: 6 }}>Score</th>
                  <th style={{ padding: 6 }}>Status</th>
                  <th style={{ padding: 6 }} />
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => {
                  const [bg, fg] = STATUS_STYLE[c.status] ?? ["#eee", "#333"];
                  return (
                    <tr key={c.id} style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ padding: 6 }}>{c.id}</td>
                      <td style={{ padding: 6, whiteSpace: "nowrap" }}>{formatNz(c.postedAt, true)}</td>
                      <td style={{ padding: 6 }}>
                        {names(world, c.postingPlayers)} <span style={{ color: "#999" }}>vs</span> {names(world, c.acceptingPlayers)}
                      </td>
                      <td style={{ padding: 6 }}>{score(c)}{c.autoConfirmed ? " (auto)" : ""}</td>
                      <td style={{ padding: 6 }}>
                        <span style={pill(bg, fg)}>{c.status}</span>
                        {c.voidReason ? <div style={{ color: "#888", fontSize: 12 }}>{c.voidReason}</div> : null}
                      </td>
                      <td style={{ padding: 6 }}>
                        {c.status === "completed" && (
                          <form>
                            <input type="hidden" name="reason" value="Voided by an admin" />
                            <button formAction={resolve.bind(null, c.id, "void")} style={btnDanger}>
                              Void
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Ladder dry run</h2>
        <p style={{ fontSize: 13, color: "#555", marginTop: 0 }}>
          Where everyone with Wolf Points lands today ({withPoints.length} players): 1 WP per play day, 2 per round robin win, 2 per challenge win plus
          bonuses. Thresholds live in <code>lib/ranks.ts</code>; the aim at launch is regulars in the Racket league and nobody in Diamond.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 6, fontSize: 13 }}>
          {LADDER.map((r) => (
            <div key={r.index} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 8px", borderRadius: 6, background: counts.get(r.index) ? "#eef4f8" : "#fafafa" }}>
              <span>
                <span style={{ color: "#999" }}>{LEAGUES[r.league].en} · </span>
                {rankName(r, "en")} <span style={{ color: "#999" }}>({r.wp})</span>
              </span>
              <strong>{counts.get(r.index) ?? 0}</strong>
            </div>
          ))}
        </div>
        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Top 25 by Wolf Points</h3>
        <ol style={{ fontSize: 13, margin: 0, paddingLeft: 22 }}>
          {top.map(([id, r]) => (
            <li key={id}>
              {world.players.get(id)?.name}: <strong>{r.wpTotal} WP</strong> → {rankName(LADDER[r.earned], "en")}
              <span style={{ color: "#888" }}>
                {" "}
                (play days {r.wpPlayDays}, round robin {r.wpRoundRobin}, challenges {r.wpChallenges + r.wpBonuses})
                {r.seat ? ` · ${r.seat === "alpha" ? "Alpha Wolf" : "Silver Wolf"}` : ""}
                {r.tarnishing ? " · tarnishing" : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
