// What a connector is (build plan §12.1): one external system a club can
// connect (Xero, MYOB, Shopify, Windcave, NZ direct debit). Each declares, in
// both languages, exactly what it reads and writes; the connect screen shows
// that statement before the club authorises anything (§12.8).

export type Localized = { en: string; vi: string };

/** How a club authorises the connector. */
export type ConnectorAuth =
  /** The club signs in at the provider and approves (Xero, MYOB, Shopify). */
  | { kind: "oauth2"; scopes: readonly string[]; refreshTokensRotate: boolean }
  /** The club pastes credentials from its own merchant account (Windcave). */
  | { kind: "api-key"; fields: readonly string[] }
  /** Nothing of its own: it rides on the club's payment provider (direct debit on Stripe). */
  | { kind: "none" };

export type DataStatement = {
  /** What Luvallplay reads from the provider. */
  reads: readonly Localized[];
  /** What Luvallplay writes to the provider. */
  writes: readonly Localized[];
  /** Promises: what it never does ("Never deletes anything in Xero"). */
  never: readonly Localized[];
};

export type ConnectorManifest<Id extends string = string> = {
  id: Id;
  /** The module (and so the entitlement) the connector belongs to: can(club, module). */
  module: string;
  name: Localized;
  /** The company behind it, for the data-processing terms (§12.1 "Privacy"). */
  provider: string;
  auth: ConnectorAuth;
  statement: DataStatement;
  /** Regions it may run in (§12.1: NZ and Australian connectors run in Sydney only). */
  regions: readonly string[];
  /** The provider's limits per connected club; the runner stays inside them. */
  limits: { perMinute: number; perDay?: number; concurrent?: number };
  /** The kinds of job the connector handles, e.g. "invoice.push". */
  jobKinds: readonly string[];
};

export function defineConnector<const Id extends string>(manifest: ConnectorManifest<Id>): ConnectorManifest<Id> {
  const problems = validateConnector(manifest);
  if (problems.length) throw new Error(`Connector "${manifest.id}": ${problems.join("; ")}`);
  return manifest;
}

const filled = (l: Localized) => Boolean(l.en.trim() && l.vi.trim());

export function validateConnector(m: ConnectorManifest): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(m.id)) problems.push("the id must be kebab-case");
  if (!filled(m.name)) problems.push("needs an English and a Vietnamese name");
  if (!m.provider.trim()) problems.push("needs the provider's name");
  // The statement is a promise to the club, so it can't be left empty or half-translated (§12.8).
  const s = m.statement;
  if (s.reads.length + s.writes.length === 0) problems.push("the statement must say what it reads or writes");
  if (s.never.length === 0) problems.push("the statement must say what it never does");
  for (const [part, lines] of Object.entries(s)) {
    if ((lines as readonly Localized[]).some((l) => !filled(l))) problems.push(`every "${part}" line needs English and Vietnamese`);
  }
  if (m.auth.kind === "oauth2" && m.auth.scopes.length === 0) problems.push("an OAuth connector must name its scopes");
  if (m.auth.kind === "api-key" && m.auth.fields.length === 0) problems.push("an API-key connector must name its fields");
  if (m.regions.length === 0) problems.push("must name the regions it runs in");
  if (!(m.limits.perMinute > 0)) problems.push("needs a per-minute limit");
  if (m.jobKinds.length === 0 && m.auth.kind !== "none") problems.push("must name the jobs it handles");
  if (new Set(m.jobKinds).size !== m.jobKinds.length) problems.push("a job kind is listed twice");
  return problems;
}

/** A set of connectors: unique ids, and one owner per job kind. */
export function validateConnectors(connectors: readonly ConnectorManifest[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of connectors) {
    if (ids.has(c.id)) problems.push(`duplicate connector ${c.id}`);
    ids.add(c.id);
    for (const p of validateConnector(c)) problems.push(`${c.id}: ${p}`);
  }
  return problems;
}
