import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import adminStyles from "@/components/admin/admin.module.css";
import { formatNz } from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, EmptyState, InfoDisclosure, Notice, PageHeader, Section, Tabs, kit, type BadgeTone } from "@/components/admin/kit";
import { ARENA_SANDBOX, adminResolve, loadWorld, type ChallengeRow, type World } from "@/lib/arena-db";
import { LADDER, LEAGUES, rankName } from "@/lib/ranks";

export const dynamic = "force-dynamic";

async function resolve(id: number, outcome: "posting" | "accepting" | "void" | "as_entered", tab: string, formData: FormData) {
  "use server";
  await adminResolve(id, outcome, String(formData.get("reason") ?? ""));
  revalidatePath("/admin/challenges");
  const label = outcome === "void" ? "Voided: no points for anyone." : outcome === "as_entered" ? "Confirmed as entered." : "Winner set. Points updated.";
  redirect(`/admin/challenges?${tab === "disputes" ? "" : `tab=${tab}&`}toast=${encodeURIComponent(label)}`);
}

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  completed: { label: "Result confirmed", tone: "good" },
  disputed: { label: "Disputed", tone: "bad" },
  live: { label: "Being played", tone: "warn" },
  awaiting: { label: "Score to confirm", tone: "warn" },
  accepted: { label: "Accepted, not played yet", tone: "default" },
  open: { label: "Open challenge", tone: "default" },
  void: { label: "Voided", tone: "default" },
};

function names(world: World, ids: [number, number] | null): string {
  if (!ids) return "—";
  return ids.map((id) => world.players.get(id)?.name ?? `#${id}`).join(" & ");
}

function score(world: World, c: ChallengeRow): string {
  if (c.retiredBy) return `${names(world, c.retiredBy === "posting" ? c.postingPlayers : c.acceptingPlayers)} retired`;
  if (c.scorePosting === null || c.scoreAccepting === null) return "—";
  return `${c.scorePosting}–${c.scoreAccepting}`;
}

type Tab = "disputes" | "results" | "ladder";

export default async function ChallengesAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams;
  const tab: Tab = tabParam === "results" || tabParam === "ladder" ? tabParam : "disputes";
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title="Arena" />
        <EmptyState>Database is not configured.</EmptyState>
      </div>
    );
  }
  const world = await loadWorld();
  const disputes = world.challenges.filter((c) => c.status === "disputed");
  const recent = [...world.challenges].filter((c) => !["open", "expired", "cancelled"].includes(c.status)).reverse().slice(0, 60);

  // Where every player with points lands on the ladder today.
  const counts = new Map<number, number>();
  const withPoints = [...world.ranks.entries()].filter(([, r]) => r.wpTotal > 0);
  for (const [, r] of withPoints) counts.set(r.earned, (counts.get(r.earned) ?? 0) + 1);
  const top = withPoints.sort((a, b) => b[1].wpTotal - a[1].wpTotal).slice(0, 25);
  const tabHref = (t: Tab) => (t === "disputes" ? "/admin/challenges" : `/admin/challenges?tab=${t}`);

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="Arena"
        subtitle={
          <>
            Pairs challenge each other in the Arena (<a href="/profile/arena">Profile → Arena</a>). Settle disputed scores here, void a result if needed, and see
            the ladder. Points and ranks update straight away.
          </>
        }
      />
      {ARENA_SANDBOX && (
        <Notice>
          <strong>Preview sandbox.</strong> On this preview the Arena uses its own test tables: test pairs and games never reach the real Arena. Play days and
          round robin results are the real ones (read only).
        </Notice>
      )}

      <Tabs
        label="Arena"
        current={tab}
        items={[
          { key: "disputes", label: "Disputes", href: tabHref("disputes"), count: disputes.length },
          { key: "results", label: "Results", href: tabHref("results") },
          { key: "ladder", label: "Ladder", href: tabHref("ladder") },
        ]}
      />

      {tab === "disputes" &&
        (disputes.length === 0 ? (
          <EmptyState>No disputed scores. Nothing to settle.</EmptyState>
        ) : (
          disputes.map((c) => {
            const a = names(world, c.postingPlayers);
            const b = names(world, c.acceptingPlayers);
            const hasScore = c.scorePosting !== null || Boolean(c.retiredBy);
            return (
              <Section key={c.id} title={`${a} vs ${b}`}>
                <p style={{ margin: "0 0 4px", fontSize: 14 }}>
                  Score entered: <strong>{score(world, c)}</strong> by {world.players.get(c.enteredBy ?? 0)?.name ?? "someone"}
                  {c.playedOn ? `, played ${formatNz(c.playedOn)}` : ""}.
                </p>
                <p style={{ margin: "0 0 10px", fontSize: 14 }}>
                  Disputed by {world.players.get(c.disputedBy ?? 0)?.name ?? "someone"}
                  {c.disputeNote ? (
                    <>
                      : <em>“{c.disputeNote}”</em>
                    </>
                  ) : (
                    "."
                  )}
                </p>
                <div className={kit.rowActions}>
                  {hasScore && (
                    <form action={resolve.bind(null, c.id, "as_entered", "disputes")}>
                      <SubmitButton className={kit.btn} loadingText="Saving…" confirmMessage={`Keep ${score(world, c)} as the result?`}>
                        Keep the score as entered
                      </SubmitButton>
                    </form>
                  )}
                  <form action={resolve.bind(null, c.id, "posting", "disputes")}>
                    <SubmitButton className={kit.btnSecondary} loadingText="Saving…" confirmMessage={`Make ${a} the winners?`}>
                      {a} won
                    </SubmitButton>
                  </form>
                  <form action={resolve.bind(null, c.id, "accepting", "disputes")}>
                    <SubmitButton className={kit.btnSecondary} loadingText="Saving…" confirmMessage={`Make ${b} the winners?`}>
                      {b} won
                    </SubmitButton>
                  </form>
                </div>
                <form action={resolve.bind(null, c.id, "void", "disputes")} className={kit.toolbar} style={{ marginTop: 12, marginBottom: 0 }}>
                  <label className={kit.field} style={{ flex: "1 1 260px" }}>
                    Or void the match (no points for anyone): why?
                    <input name="reason" required placeholder="e.g. couldn't agree on the score" className={kit.input} />
                  </label>
                  <SubmitButton className={kit.btnDanger} loadingText="Voiding…" confirmMessage="Void this match? Nobody gets points for it.">
                    Void match
                  </SubmitButton>
                </form>
              </Section>
            );
          })
        ))}

      {tab === "results" &&
        (recent.length === 0 ? (
          <EmptyState>No challenges played yet.</EmptyState>
        ) : (
          <div className={kit.tableWrap}>
            <table className={kit.table}>
              <caption className={kit.srOnly}>Recent challenges</caption>
              <thead>
                <tr>
                  <th scope="col">Posted</th>
                  <th scope="col">Pairs</th>
                  <th scope="col">Score</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className={kit.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => {
                  const st = STATUS[c.status] ?? { label: c.status, tone: "default" as BadgeTone };
                  return (
                    <tr key={c.id}>
                      <td data-label="Posted" style={{ whiteSpace: "nowrap" }}>
                        {formatNz(c.postedAt, true)}
                      </td>
                      <td data-label="Pairs">
                        {names(world, c.postingPlayers)} <span className={kit.muted}>vs</span> {names(world, c.acceptingPlayers)}
                      </td>
                      <td data-label="Score">
                        {score(world, c)}
                        {c.autoConfirmed ? <span className={kit.sub}>confirmed automatically</span> : null}
                      </td>
                      <td data-label="Status">
                        <div>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {c.voidReason ? <span className={kit.sub}>{c.voidReason}</span> : null}
                        </div>
                      </td>
                      <td data-label="">
                        {c.status === "completed" && (
                          <form action={resolve.bind(null, c.id, "void", "results")}>
                            <input type="hidden" name="reason" value="Voided by an admin" />
                            <SubmitButton className={kit.btnDanger} loadingText="Voiding…" confirmMessage="Void this result? Both pairs lose the points it gave.">
                              Void
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "ladder" && (
        <>
          <InfoDisclosure summary="How Wolf Points and ranks work">
            <p>Players earn Wolf Points (WP): 1 per play day, 2 per round robin win, and 2 per challenge win plus bonuses. Their points set their rank.</p>
            <p>Seats go by Wolf Points in the last 90 days: the top player is the Alpha Wolf, the next three are Silver Wolves.</p>
            <p>The top ranks need regular play: without enough points in the last 60 days the rank &ldquo;tarnishes&rdquo; and slips one rank per 30 days (never below the start of its league). Points are never taken away, so playing again restores it.</p>
          </InfoDisclosure>
          <Section title={`Players per rank (${withPoints.length} with points)`}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 6, fontSize: 13 }}>
              {LADDER.map((r) => (
                <div
                  key={r.index}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 10px", borderRadius: 8, background: counts.get(r.index) ? "#eef4f8" : "#fafafa" }}
                >
                  <span>
                    <span className={kit.muted}>{LEAGUES[r.league].en} · </span>
                    {rankName(r, "en")} <span className={kit.muted}>({r.wp} WP)</span>
                  </span>
                  <strong>{counts.get(r.index) ?? 0}</strong>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Top 25 by Wolf Points">
            {top.length === 0 ? (
              <EmptyState>Nobody has Wolf Points yet.</EmptyState>
            ) : (
              <ol style={{ fontSize: 14, margin: 0, paddingLeft: 22, lineHeight: 1.7 }}>
                {top.map(([id, r]) => (
                  <li key={id}>
                    {world.players.get(id)?.name}: <strong>{r.wpTotal} WP</strong>, {rankName(LADDER[r.earned], "en")}
                    {r.seat ? ` · ${r.seat === "alpha" ? "Alpha Wolf" : "Silver Wolf"}` : ""}
                    {r.tarnishing ? " · tarnishing" : ""}
                    <span className={kit.sub}>
                      play days {r.wpPlayDays} · round robin {r.wpRoundRobin} · challenges {r.wpChallenges + r.wpBonuses}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
