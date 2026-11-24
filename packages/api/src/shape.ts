// A zod schema as plain data, for the contract snapshot (test plan §3.7:
// "Removing or renaming a field fails CI unless the API version is bumped").
// Only what a client can observe is kept: field names, types, optional or
// not, nullable or not, enum values. Limits (max lengths and so on) are left
// out: tightening one is a behaviour change, not a shape change.
import type { z } from "zod";

export type Shape =
  | { t: "string" | "number" | "boolean" | "unknown" }
  | { t: "literal"; value: unknown }
  | { t: "enum"; values: string[] }
  | { t: "array"; of: Shape }
  | { t: "record"; of: Shape }
  | { t: "object"; fields: Record<string, Shape & { optional?: true; nullable?: true }> };
type Flagged = Shape & { optional?: true; nullable?: true };

type Def = { typeName: string; [k: string]: unknown };

export function shapeOf(schema: z.ZodTypeAny): Flagged {
  const def = (schema as unknown as { _def: Def })._def;
  switch (def.typeName) {
    case "ZodString": return { t: "string" };
    case "ZodNumber": return { t: "number" };
    case "ZodBoolean": return { t: "boolean" };
    case "ZodLiteral": return { t: "literal", value: def.value };
    case "ZodEnum": return { t: "enum", values: [...(def.values as string[])] };
    case "ZodArray": return { t: "array", of: strip(shapeOf(def.type as z.ZodTypeAny)) };
    case "ZodRecord": return { t: "record", of: strip(shapeOf(def.valueType as z.ZodTypeAny)) };
    case "ZodOptional": return { ...shapeOf(def.innerType as z.ZodTypeAny), optional: true };
    case "ZodNullable": return { ...shapeOf(def.innerType as z.ZodTypeAny), nullable: true };
    case "ZodDefault": return { ...shapeOf(def.innerType as z.ZodTypeAny), optional: true };
    case "ZodEffects": return shapeOf(def.schema as z.ZodTypeAny);
    case "ZodObject": {
      const fields: Record<string, Flagged> = {};
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      for (const key of Object.keys(shape).sort()) fields[key] = shapeOf(shape[key]);
      return { t: "object", fields };
    }
    default: return { t: "unknown" };
  }
}
const strip = (s: Flagged): Shape => {
  const { optional: _o, nullable: _n, ...rest } = s;
  return rest as Shape;
};

/**
 * What would break a client that was built against `before`, now talking to
 * `after`. `direction` says who produces the value:
 * - "response": the server sends it. Breaking: a field gone, its type
 *   changed, a required field now optional or nullable, an enum given a new
 *   value the old client doesn't know.
 * - "request": the client sends it. Breaking: a field the old client sends
 *   is gone or changed type, a new required field, an optional field made
 *   required, an enum value no longer accepted.
 */
export function breakingChanges(before: Flagged | undefined, after: Flagged | undefined, direction: "request" | "response", path = ""): string[] {
  const at = path || "(root)";
  if (!before) return [];
  if (!after) return [`${at}: removed`];
  if (before.t !== after.t) return [`${at}: type ${before.t} → ${after.t}`];
  const out: string[] = [];
  if (direction === "response") {
    if (!before.optional && after.optional) out.push(`${at}: was always present, now optional`);
    if (!before.nullable && after.nullable) out.push(`${at}: can now be null`);
  } else {
    if (before.optional && !after.optional) out.push(`${at}: was optional, now required`);
    if (before.nullable && !after.nullable) out.push(`${at}: null no longer accepted`);
  }
  if (before.t === "literal" && after.t === "literal" && before.value !== after.value) out.push(`${at}: literal ${String(before.value)} → ${String(after.value)}`);
  if (before.t === "enum" && after.t === "enum") {
    const [was, now] = [new Set(before.values), new Set(after.values)];
    if (direction === "response") for (const v of now) if (!was.has(v)) out.push(`${at}: new value "${v}" old clients don't know`);
    if (direction === "request") for (const v of was) if (!now.has(v)) out.push(`${at}: value "${v}" no longer accepted`);
  }
  if ((before.t === "array" && after.t === "array") || (before.t === "record" && after.t === "record")) {
    out.push(...breakingChanges(before.of, after.of, direction, `${path}[]`));
  }
  if (before.t === "object" && after.t === "object") {
    for (const key of Object.keys(before.fields)) {
      if (!(key in after.fields)) {
        // A request field the server stopped reading is harmless only if it was optional; be strict.
        out.push(`${path}.${key}: removed`);
      } else {
        out.push(...breakingChanges(before.fields[key], after.fields[key], direction, `${path}.${key}`));
      }
    }
    if (direction === "request") {
      for (const key of Object.keys(after.fields)) {
        if (!(key in before.fields) && !after.fields[key].optional) out.push(`${path}.${key}: new required field`);
      }
    }
  }
  return out;
}
