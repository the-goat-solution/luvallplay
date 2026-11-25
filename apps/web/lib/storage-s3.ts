// The S3-compatible storage provider (build plan §6.9: in a region that isn't
// on Vercel, "S3-compatible storage at the provider, behind one storage
// interface"; Track V).
//
// Off unless STORAGE_DRIVER=s3. Vercel Blob stays the default (lib/storage.ts),
// so nothing changes for a region on Vercel.
//
// It speaks the S3 protocol directly (two requests: PUT and DELETE an object,
// signed with AWS Signature Version 4), so it works with any S3-compatible
// store a Vietnamese cloud offers, and adds no dependency. The signing is
// checked against AWS's published example, and the provider passes the shared
// storage contract against a real S3-compatible server in CI
// (tests/storage-s3.test.ts).
//
// Settings (all required unless noted):
//   S3_ENDPOINT            https://s3.example.vn   (http only outside production)
//   S3_BUCKET              the bucket for public files
//   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
//   S3_REGION              optional, default "us-east-1" (what most compatible stores expect)
//   S3_PUBLIC_URL          optional: where the public reads the files (a CDN or
//                          the bucket's public address). Default: endpoint/bucket.
//   S3_OBJECT_ACL          optional, e.g. "public-read", for stores that make
//                          objects public per object rather than by bucket policy.
//
// The bucket must allow public reads of its objects (bucket policy or the ACL
// above): these are the same public files Vercel Blob serves today (photos,
// avatars, shop pictures). Private files (finance receipts) don't use this.
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ObjectStorage, PutOptions, StoredObject } from "./storage";

export type S3Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** No trailing slash. */
  publicUrl: string;
  objectAcl?: string;
};

type Env = Record<string, string | undefined>;

/** The settings from the environment, or null when any required one is missing or unusable. */
export function s3ConfigFromEnv(env: Env = process.env): S3Config | null {
  const get = (k: string) => env[k]?.trim() || "";
  const endpoint = get("S3_ENDPOINT").replace(/\/+$/, "");
  const bucket = get("S3_BUCKET");
  const accessKeyId = get("S3_ACCESS_KEY_ID");
  const secretAccessKey = get("S3_SECRET_ACCESS_KEY");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  // Files never travel unencrypted in production.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && env.VERCEL_ENV !== "production" && env.NODE_ENV !== "production")) return null;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  const publicUrl = (get("S3_PUBLIC_URL") || `${endpoint}/${bucket}`).replace(/\/+$/, "");
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: get("S3_REGION") || "us-east-1", publicUrl, objectAcl: get("S3_OBJECT_ACL") || undefined };
}

// ── AWS Signature Version 4 ─────────────────────────────────────────────────

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as the signature requires: everything but A-Z a-z 0-9 - _ . ~ */
const encodeSegment = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const encodeKey = (key: string) => key.split("/").map(encodeSegment).join("/");

export type SignInput = {
  method: string;
  /** Full URL; the path must already be encoded with encodeKey. */
  url: string;
  /** Extra headers to send and sign (lower-case names). host, x-amz-date and x-amz-content-sha256 are added. */
  headers?: Record<string, string>;
  /** SHA-256 of the body, hex. */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now: Date;
};

/** The headers of a signed S3 request, Authorization included. */
export function signS3Request(input: SignInput): Record<string, string> {
  const url = new URL(input.url);
  const amzDate = input.now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: url.host, "x-amz-content-sha256": input.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
    .sort()
    .join("&");
  const canonicalRequest = [input.method, url.pathname, query, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  // Host is signed but not sent: fetch sets it from the URL.
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

// ── The provider ────────────────────────────────────────────────────────────

/** Keeps a path safe as an object key: no leading slash, no "..", no empty parts. */
function cleanKey(pathname: string): string {
  const parts = pathname.split("/").filter((p) => p && p !== "." && p !== "..");
  if (parts.length === 0) throw new Error("A stored file needs a name.");
  return parts.join("/");
}

function withSuffix(key: string): string {
  const suffix = randomBytes(12).toString("base64url");
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  return dot > slash + 1 ? `${key.slice(0, dot)}-${suffix}${key.slice(dot)}` : `${key}-${suffix}`;
}

export type S3Storage = ObjectStorage & {
  /** Reads an object back by its pathname (for the setup check and tests). Null when it isn't there. */
  read(pathname: string): Promise<{ body: Buffer; contentType: string | null } | null>;
};

type Options = { config?: () => S3Config | null; fetch?: typeof fetch; now?: () => Date };

export function s3Storage(options: Options = {}): S3Storage {
  const config = options.config ?? (() => s3ConfigFromEnv());
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  const request = async (c: S3Config, method: string, key: string, body?: Buffer, headers: Record<string, string> = {}) => {
    // Path-style addressing (endpoint/bucket/key): what MinIO and most compatible stores expect.
    const url = `${c.endpoint}/${c.bucket}/${encodeKey(key)}`;
    const payloadHash = sha256Hex(body ?? "");
    const signed = signS3Request({ method, url, headers, payloadHash, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: c.region, now: now() });
    return doFetch(url, { method, headers: signed, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
  };

  const fail = async (what: string, res: Response) => {
    // The store's message can name the bucket or key, never a secret; keep it short for the log.
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    return new Error(`File storage ${what} failed (${res.status}). ${detail}`.trim());
  };

  const owns = (url: string) => {
    const c = config();
    return c !== null && url.startsWith(`${c.publicUrl}/`) && url.length > c.publicUrl.length + 1;
  };
  const keyOf = (c: S3Config, url: string) => {
    const path = url.slice(c.publicUrl.length + 1).split(/[?#]/)[0];
    return cleanKey(path.split("/").map(decodeURIComponent).join("/"));
  };

  return {
    name: "s3",
    configured: () => config() !== null,
    async put(pathname: string, body: Buffer, opts: PutOptions): Promise<StoredObject> {
      const c = config();
      if (!c) throw new Error("File storage isn't set up yet (the S3 settings are missing).");
      const clean = cleanKey(pathname);
      const key = (opts.uniqueName ?? true) ? withSuffix(clean) : clean;
      const headers: Record<string, string> = { "content-type": opts.contentType };
      if (c.objectAcl) headers["x-amz-acl"] = c.objectAcl;
      const res = await request(c, "PUT", key, body, headers);
      if (!res.ok) throw await fail("upload", res);
      return { url: `${c.publicUrl}/${encodeKey(key)}`, pathname: key };
    },
    owns,
    async delete(urls: string[]): Promise<void> {
      const c = config();
      if (!c) return;
      for (const url of urls.filter(owns)) {
        const res = await request(c, "DELETE", keyOf(c, url));
        // Deleting what is already gone is fine.
        if (!res.ok && res.status !== 404) throw await fail("delete", res);
      }
    },
    async read(pathname: string) {
      const c = config();
      if (!c) throw new Error("File storage isn't set up yet (the S3 settings are missing).");
      const res = await request(c, "GET", cleanKey(pathname));
      if (res.status === 404) return null;
      if (!res.ok) throw await fail("read", res);
      return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
    },
  };
}
