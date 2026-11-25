// Product rules on top of a club's own module switches, applied where the
// club's config arrives (hooks.tsx), so every tab, screen and card follows.
//
// - Vision (AI match tracking) is trained on badminton: it is offered only to
//   clubs that play badminton, whatever the club switched on. A club's own
//   name for it stays ("Wolf Vision" at Three Wolves).

/** Modules that need a sport, and the sports they work for. */
const NEEDS_SPORT: Record<string, readonly string[]> = { vision: ["badminton"] };

/** The club's modules as the app offers them. */
export function offeredModules(modules: readonly string[], sports: readonly string[]): string[] {
  const plays = new Set(sports.map((s) => s.trim().toLowerCase()));
  return modules.filter((m) => !NEEDS_SPORT[m] || NEEDS_SPORT[m].some((s) => plays.has(s)));
}

/** A club config with the product rules applied (the rest untouched). */
export function withProductRules<C extends { modules: string[]; club: { sports: string[] } }>(config: C): C {
  const modules = offeredModules(config.modules, config.club.sports);
  return modules.length === config.modules.length ? config : { ...config, modules };
}
