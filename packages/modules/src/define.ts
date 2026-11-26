// The module manifest (build plan §6.2, §6.2.1, §6.2.3). Every feature is
// either part of the always-on core or an optional module; the setup wizard,
// admin menu, app navigation, API, crons and emails will all read the same
// registry, so turning a module off hides everything it owns (its data is
// kept). The admin menu, its badges and the Today page's "Needs attention"
// list are generated from it (adminMenu, adminAttention: Track A step A1);
// tests keep it in step with the real routes, crons and webhook events.

export type ModuleScope = "club" | "global";
export type ModuleGroup = "core" | "run" | "money" | "engage" | "global";

/** A club's payment mode (tenants.payment_mode, §6.2.1). */
export const PAYMENT_MODES = ["free", "offline", "online"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/**
 * How a module relates to payments (§6.2.1):
 * - none: never involves money;
 * - optional: works on Free play, shows prices and checkout only when the club takes payments;
 * - required: only for clubs that take payments (hidden on Free play).
 */
export type Payments = "none" | "optional" | "required";

/** Platform-wide availability, set by platform admins (§6.2.3). */
export type Availability = "available" | "beta" | "hidden";

/** Admin menu groups, in menu order. "" is the ungrouped top of the menu (Home / Today). */
export const ADMIN_NAV_GROUPS = ["", "Play", "People", "Money", "Club"] as const;
export type AdminNavGroup = (typeof ADMIN_NAV_GROUPS)[number];

/** One page in the admin menu, declared by the module that owns it. */
export type AdminNavItem = {
  group: AdminNavGroup;
  href: string;
  /** Menu wording (English until the admin i18n step, A5, turns it into a label key). */
  label: string;
  /** Position inside its group, lowest first. Leave gaps (10, 20, …) so another module can slot in. */
  order: number;
  /** The attention key whose count shows beside the item (declared under `attention`). */
  badge?: string;
  /** Extra paths that count as this page (sub-pages, old URLs). */
  match?: string[];
  /** Only this exact path counts (the admin home, which every page is under). */
  exact?: boolean;
};

/** Something that needs an admin: a line under "Needs attention" on Today, and a menu badge. */
export type AdminAttention = {
  key: string;
  /** The page where it gets done (also decides who sees it). */
  href: string;
  /** Most urgent first, lowest number first. */
  urgency: number;
  /** Plain sentence for the Today page, e.g. "3 unread messages". */
  sentence: (n: number) => string;
  action: string;
};

/** Anything with a zod-style parse(); manifests declare their settings shape with zod later. */
export type SettingsSchema<T = unknown> = { parse(input: unknown): T };

export type ModuleManifest<Id extends string = string> = {
  id: Id;
  scope: ModuleScope;
  group: ModuleGroup;
  name: { en: string; vi: string };
  /** Part of the always-on core: can't be turned off, by anyone. */
  core?: boolean;
  /** Other modules that must be on (switched on with it in the wizard). */
  requires?: string[];
  /** Suggested alongside it. */
  recommends?: string[];
  payments: Payments;
  /** Payment modes the module needs, when narrower than `payments` implies (Card payments: online only). */
  paymentModes?: PaymentMode[];
  /** The plan the module belongs to (§6.5). Every module is on Free today. */
  plan: "free";
  /** Default platform-wide availability. */
  availability?: Availability;
  /** What counts as live activity (asks for confirmation before switching off), e.g. "challenges in progress". */
  liveActivity?: string;
  settings?: SettingsSchema;
  /** Where today's settings live (table or club_settings keys), until `settings` takes over. */
  settingsStoredIn?: string[];
  // Everything below is what the module OWNS: switched off, all of it is hidden or stopped.
  app?: { tabs?: string[]; meCards?: string[]; routes?: string[] };
  /** Admin menu pages, other admin pages the module owns, and what it puts on Today. */
  admin?: { nav?: AdminNavItem[]; pages?: string[]; attention?: AdminAttention[] };
  site?: { sections?: string[]; routes?: string[] };
  /** Public and app API routes. */
  api?: string[];
  /** Scheduled jobs; path is today's Vercel cron route. One cron fans out per enabled club later. */
  crons?: { id: string; schedule: string; path: string }[];
  /** Emails the module sends (by name). */
  emails?: string[];
  /** Webhook events the module emits to integrations. */
  webhooks?: string[];
};

export function defineModule<const Id extends string>(manifest: ModuleManifest<Id>): ModuleManifest<Id> {
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) throw new Error(`Module id "${manifest.id}" must be kebab-case.`);
  if (!manifest.name.en.trim() || !manifest.name.vi.trim()) throw new Error(`Module "${manifest.id}" needs an English and a Vietnamese name.`);
  return manifest;
}

/** The payment modes a module can be on in. */
export function allowedPaymentModes(m: ModuleManifest): PaymentMode[] {
  if (m.paymentModes) return m.paymentModes;
  return m.payments === "required" ? ["offline", "online"] : [...PAYMENT_MODES];
}

/** Check a set of manifests: unique ids, known dependencies, no cycles, sound payment rules, one owner per page, cron and event. */
export function validateRegistry(modules: readonly ModuleManifest[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) problems.push(`duplicate module id ${m.id}`);
    ids.add(m.id);
  }
  const byId = new Map(modules.map((m) => [m.id, m]));
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
    if (m.core) {
      if (m.payments === "required") problems.push(`core module ${m.id} can't require payments (free-play clubs run on the core)`);
      if (m.requires?.some((d) => !byId.get(d)?.core)) problems.push(`core module ${m.id} requires a module that isn't core`);
    }
    if (m.paymentModes) {
      if (m.paymentModes.length === 0) problems.push(`${m.id} allows no payment mode`);
      if (m.payments === "required" && m.paymentModes.includes("free")) problems.push(`${m.id} requires payments but allows Free play`);
    }
    // A module can't be on in a payment mode where something it requires can't be.
    for (const d of m.requires ?? []) {
      const dep = byId.get(d);
      if (!dep) continue;
      const missing = allowedPaymentModes(m).filter((pm) => !allowedPaymentModes(dep).includes(pm));
      if (missing.length) problems.push(`${m.id} can be on in ${missing.join(", ")} but requires ${d}, which can't`);
    }
    for (const n of m.admin?.nav ?? []) {
      claim(`admin page ${n.href}`, m.id);
      claim(`admin menu position ${n.group || "(top)"} #${n.order}`, m.id);
      if (!ADMIN_NAV_GROUPS.includes(n.group)) problems.push(`${m.id}: unknown admin menu group "${n.group}"`);
      if (!n.label.trim()) problems.push(`${m.id}: ${n.href} has no menu label`);
      if (n.badge && !modules.some((x) => x.admin?.attention?.some((a) => a.key === n.badge))) {
        problems.push(`${m.id}: ${n.href} shows the badge "${n.badge}", which no module declares`);
      }
    }
    for (const a of m.admin?.attention ?? []) {
      claim(`attention ${a.key}`, m.id);
      claim(`attention urgency #${a.urgency}`, m.id);
    }
    for (const p of m.admin?.pages ?? []) claim(`admin page ${p}`, m.id);
    for (const c of m.crons ?? []) claim(`cron ${c.path}`, m.id);
    for (const w of m.webhooks ?? []) claim(`event ${w}`, m.id);
    for (const e of m.emails ?? []) claim(`email ${e}`, m.id);
    for (const a of m.api ?? []) claim(`api ${a}`, m.id);
  }
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

// ── The admin menu and Today, generated (§6.2.4 layer 1, Track A step A1) ───

export type AdminMenuItem = Omit<AdminNavItem, "group" | "order"> & {
  /** The module that declared the page; "platform" for the Luvallplay console pages. */
  module: string;
};
/** A group with an empty label shows its items without a heading. */
export type AdminMenuGroup = { label: AdminNavGroup; items: AdminMenuItem[] };

/**
 * The admin menu: every module's pages plus the platform console's, in group
 * and `order` order. Groups with nothing in them are left out. `allowed`
 * narrows it to what one person may open at one club (role, module switches).
 */
export function adminMenu(
  modules: readonly ModuleManifest[],
  platformPages: readonly AdminNavItem[] = [],
  allowed: (item: AdminMenuItem) => boolean = () => true,
): AdminMenuGroup[] {
  const all = [
    ...modules.flatMap((m) => (m.admin?.nav ?? []).map((n) => ({ nav: n, module: m.id as string }))),
    ...platformPages.map((n) => ({ nav: n, module: "platform" })),
  ];
  return ADMIN_NAV_GROUPS.map((label) => ({
    label,
    items: all
      .filter((x) => x.nav.group === label)
      .sort((a, b) => a.nav.order - b.nav.order)
      .map(({ nav: { group: _group, order: _order, ...item }, module }) => ({ ...item, module }))
      .filter(allowed),
  })).filter((g) => g.items.length > 0);
}

/** Everything that can need an admin's attention, most urgent first, with the module that declared it. */
export function adminAttention(modules: readonly ModuleManifest[]): (AdminAttention & { module: string })[] {
  return modules
    .flatMap((m) => (m.admin?.attention ?? []).map((a) => ({ ...a, module: m.id as string })))
    .sort((a, b) => a.urgency - b.urgency);
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

// ── Switching modules on and off (§6.2.3) ────────────────────────────────────
// The rules every switch follows, as pure functions; the Settings → Modules
// screen and the platform console call these later. Who may switch (owners,
// platform admins, locks) is decided by the caller; live-activity confirmation
// needs the club's data, so it's the caller's too (see `liveActivity`).

/** A club's switch for one module. `locked` is set by a platform admin; owners can't change it. */
export type ClubModuleState = { on: boolean; locked?: { reason: string } };

export type SwitchContext = {
  paymentMode: PaymentMode;
  /** Ids of the modules switched on for the club. */
  enabled: readonly string[];
  /** Who is switching: club owners can't change a locked module; platform admins can. */
  actor: "owner" | "platform-admin";
  locked?: readonly string[];
  /** Platform-wide availability overrides; beta modules need the club to be in the beta. */
  availability?: Readonly<Record<string, Availability>>;
  inBeta?: readonly string[];
};

export type SwitchResult = { ok: true } | { ok: false; reason: string };

export function canTurnOn(modules: readonly ModuleManifest[], id: string, ctx: SwitchContext): SwitchResult {
  const m = modules.find((x) => x.id === id);
  if (!m) return { ok: false, reason: `There's no module "${id}".` };
  if (m.core) return { ok: false, reason: `${m.name.en} is part of the core and always on.` };
  if (ctx.locked?.includes(id) && ctx.actor !== "platform-admin") return { ok: false, reason: `${m.name.en} is locked by Luvallplay.` };
  const availability = ctx.availability?.[id] ?? m.availability ?? "available";
  if (availability === "hidden") return { ok: false, reason: `${m.name.en} isn't available right now.` };
  if (availability === "beta" && !ctx.inBeta?.includes(id)) return { ok: false, reason: `${m.name.en} is in beta and not open to this club yet.` };
  if (!allowedPaymentModes(m).includes(ctx.paymentMode)) {
    return { ok: false, reason: `${m.name.en} needs a payment mode other than ${ctx.paymentMode === "free" ? "Free play" : ctx.paymentMode}.` };
  }
  const off = (m.requires ?? []).filter((d) => !ctx.enabled.includes(d) && !modules.find((x) => x.id === d)?.core);
  if (off.length) {
    const names = off.map((d) => modules.find((x) => x.id === d)?.name.en ?? d);
    return { ok: false, reason: `${m.name.en} needs ${names.join(" and ")} turned on first.` };
  }
  return { ok: true };
}

export function canTurnOff(modules: readonly ModuleManifest[], id: string, ctx: SwitchContext): SwitchResult {
  const m = modules.find((x) => x.id === id);
  if (!m) return { ok: false, reason: `There's no module "${id}".` };
  if (m.core) return { ok: false, reason: `${m.name.en} is part of the core and can't be turned off.` };
  if (ctx.locked?.includes(id) && ctx.actor !== "platform-admin") return { ok: false, reason: `${m.name.en} is locked by Luvallplay.` };
  const dependents = modules.filter((x) => ctx.enabled.includes(x.id) && x.requires?.includes(id));
  if (dependents.length) {
    return { ok: false, reason: `${dependents.map((x) => x.name.en).join(" and ")} need${dependents.length === 1 ? "s" : ""} ${m.name.en}. Turn ${dependents.length === 1 ? "it" : "them"} off first.` };
  }
  return { ok: true };
}
