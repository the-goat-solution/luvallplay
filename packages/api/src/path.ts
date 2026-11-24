/** `/clubs/{club}/config` + {club: "x"} → `/clubs/x/config`. */
export function fillPath(path: string, params: Record<string, string | number> | undefined): string {
  return path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(String(value));
  });
}
