// Which Luvallplay item became which external item (integration_mappings,
// build plan §12.1). It's what makes a job safe to run twice, and how an item
// changed at the provider after it synced is noticed: flagged, never
// overwritten.

export type Mapping = {
  tenantId: number;
  connector: string;
  /** The Luvallplay item, e.g. "payment" + "1234". */
  localType: string;
  localId: string;
  /** The provider's kind and id, e.g. "invoice" + a Xero InvoiceID. */
  externalType: string;
  externalId: string;
  /** A fingerprint of what we sent (see fingerprint()). */
  sentHash: string;
  /** The provider's own "last changed" stamp, as it was straight after our write. */
  externalVersion: string | null;
  /** Set when the item was found changed at the provider (§12.1). */
  flaggedAt: number | null;
  flagReason: string | null;
  createdAt: number;
  updatedAt: number;
};

export type MappingKey = Pick<Mapping, "tenantId" | "connector" | "localType" | "localId" | "externalType">;

export interface MappingStore {
  get(key: MappingKey): Promise<Mapping | null>;
  /** Inserts, or returns the existing row untouched: the first writer wins. */
  putIfAbsent(mapping: Omit<Mapping, "flaggedAt" | "flagReason" | "createdAt" | "updatedAt">, now: number): Promise<{ mapping: Mapping; created: boolean }>;
  /** After we deliberately re-sent an item (a resync): what was sent and the provider's new stamp. */
  recordSent(key: MappingKey, sent: { sentHash: string; externalVersion: string | null }, now: number): Promise<void>;
  flag(key: MappingKey, reason: string, now: number): Promise<void>;
  list(tenantId: number, connector: string, filter?: { flagged?: boolean }): Promise<Mapping[]>;
}

/**
 * A stable fingerprint of what's sent: the same for the same content
 * whatever order its keys are in. Not a secret and not for security (two
 * 32-bit FNV-1a passes, 16 hex characters); it only answers "is this what we
 * sent last time?".
 */
export function fingerprint(value: unknown): string {
  const text = canonical(value);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export type SyncDecision =
  /** Never sent: create it. */
  | { action: "create" }
  /** Sent, and what we'd send now is the same: nothing to do. */
  | { action: "skip"; mapping: Mapping }
  /** Sent, and ours has changed since: update it (if the connector allows updates). */
  | { action: "update"; mapping: Mapping }
  /** Changed at the provider since we sent it: flag it and leave it alone. */
  | { action: "flag"; mapping: Mapping; reason: string };

/**
 * What to do with an item, given its mapping and (when the connector read it)
 * the provider's current "last changed" stamp.
 */
export function decideSync(mapping: Mapping | null, sentHash: string, externalVersionNow?: string | null): SyncDecision {
  if (!mapping) return { action: "create" };
  if (mapping.flaggedAt !== null) return { action: "flag", mapping, reason: mapping.flagReason ?? "It was changed outside Luvallplay." };
  if (externalVersionNow != null && mapping.externalVersion != null && externalVersionNow !== mapping.externalVersion) {
    return { action: "flag", mapping, reason: "It was changed outside Luvallplay after it synced." };
  }
  return mapping.sentHash === sentHash ? { action: "skip", mapping } : { action: "update", mapping };
}
