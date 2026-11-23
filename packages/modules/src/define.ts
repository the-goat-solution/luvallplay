// The module manifest (build plan §6.2). Every feature is a module; the
// setup wizard, admin menu, app navigation, API and scheduled jobs will all
// read the same registry. Phase 2 only DESCRIBES what the club runs today:
// nothing reads the registry at runtime yet, and tests keep it in step with
// the real admin menu, crons and webhook events.

export type ModuleScope = "club" | "global";
export type ModuleGroup = "core" | "run" | "money" | "engage" | "global";

/** Anything with a zod-style parse(); manifests declare their settings shape with zod later. */
export type SettingsSchema<T = unknown> = { parse(input: unknown): T };

export type ModuleManifest<Id extends string = string> = {
  id: Id;
  scope: ModuleScope;
  group: ModuleGroup;
  name: { en: string; vi: string };
  /** Always on for every club; can't be turned off. */
  core?: boolean;
  /** Turned on automatically (wizard) when this module is. */
  requires?: string[];
  /** Suggested alongside it. */
  recommends?: string[];
  /** The plan the module belongs to (§6.5). Every module is on Free today. */
  plan: "free";
  settings?: SettingsSchema;
  /** Where today's settings live (table or club_settings keys), until `settings` takes over. */
  settingsStoredIn?: string[];
  app?: { tabs?: string[]; meCards?: string[]; routes?: string[] };
  admin?: { nav?: { group: string; href: string }[] };
  site?: { sections?: string[]; routes?: string[] };
  /** Scheduled jobs; path is today's Vercel cron route. */
  crons?: { id: string; schedule: string; path: string }[];
  /** Webhook events the module emits to integrations. */
  webhooks?: string[];
  /** Public API routes (Integrations). */
  api?: string[];
};

export function defineModule<const Id extends string>(manifest: ModuleManifest<Id>): ModuleManifest<Id> {
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) throw new Error(`Module id "${manifest.id}" must be kebab-case.`);
  if (!manifest.name.en.trim() || !manifest.name.vi.trim()) throw new Error(`Module "${manifest.id}" needs an English and a Vietnamese name.`);
  return manifest;
}

/** Check a set of manifests: unique ids, known dependencies, no cycles, one owner per admin page, cron and event. */
export function validateRegistry(modules: readonly ModuleManifest[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) problems.push(`duplicate module id ${m.id}`);
    ids.add(m.id);
  }
  const owners = new Map<string, string>();
  const claim = (what: string, by: string) => {
    const prev = owners.get(what);
    if (prev) problems.push(`${what} is claimed by both ${prev} and ${by}`);
    else owners.set(what, by);
  };
  for (const m of modules) {
    for (const dep of [...(m.requires ?? []), ...(m.recommends ?? [])]) {
      if (!ids.has(dep)) problems.push(`${m.id} refers to unknown module ${dep}`);
      if (dep === m.id) problems.push(`${m.id} refers to itself`);
    }
    if (m.core && m.requires?.some((d) => !modules.find((x) => x.id === d)?.core)) {
      problems.push(`core module ${m.id} requires a module that isn't core`);
    }
    for (const n of m.admin?.nav ?? []) claim(`admin page ${n.href}`, m.id);
    for (const c of m.crons ?? []) claim(`cron ${c.path}`, m.id);
    for (const w of m.webhooks ?? []) claim(`event ${w}`, m.id);
  }
  // requires must not loop (a module can't, through others, require itself)
  const byId = new Map(modules.map((m) => [m.id, m]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      problems.push(`requires loop: ${[...path, id].join(" → ")}`);
      return;
    }
    state.set(id, "visiting");
    for (const d of byId.get(id)?.requires ?? []) if (byId.has(d)) visit(d, [...path, id]);
    state.set(id, "done");
  };
  for (const m of modules) visit(m.id, []);
  return problems;
}

/** A module and everything it requires, transitively (what the wizard turns on). */
export function withRequirements(modules: readonly ModuleManifest[], id: string): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const out: string[] = [];
  const add = (x: string) => {
    if (out.includes(x)) return;
    out.push(x);
    for (const d of byId.get(x)?.requires ?? []) add(d);
  };
  add(id);
  return out;
}
