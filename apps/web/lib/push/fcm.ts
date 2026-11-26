// The push sender: Firebase Cloud Messaging (HTTP v1), plugged into the
// message channels (lib/messages) as the "push" channel's sender.
//
// - The service account comes from ONE environment setting,
//   FCM_SERVICE_ACCOUNT: the JSON file Firebase gives ("Generate new private
//   key"), pasted as it is, or its base64. It is a secret of the deployment.
//   It is never logged, and neither is a device's address.
// - With the setting missing or malformed there is no sender: the push
//   channel is "unavailable" and nothing is sent anywhere.
// - A notification carries the club's name, a short line, and a path inside
//   the app (data.path, opened by apps/app/src/lib/native/push.ts).
// - An address Firebase says is gone (the app was removed, the address was
//   replaced) is reported to `onGone`, so the device row can be deleted.
import { JWT } from "google-auth-library";

// The shapes lib/messages/channels/push.ts asks of a sender, written out here
// so nothing outside lib/messages imports from it (its own rule).
export type PushNotification = { tokens: readonly string[]; title: string; body: string; path?: string };
export type PushSendResult = { ok: true; providerId?: string } | { ok: false; reason: string };
export type PushSender = (notification: PushNotification) => Promise<PushSendResult>;

type Env = Record<string, string | undefined>;
export type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };

/** What one send to one address came to. "gone": Firebase no longer knows the address. */
export type FcmOutcome = "sent" | "gone" | "failed";
/** Sends one message; the only part that touches the network (replaced in tests). */
export type FcmTransport = (projectId: string, message: Record<string, unknown>) => Promise<{ status: number; errorCode?: string }>;

/** Reads FCM_SERVICE_ACCOUNT. Null when it is missing or isn't a service account: never a half-configured sender. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  for (const candidate of [text, Buffer.from(text, "base64").toString("utf8")]) {
    try {
      const j = JSON.parse(candidate) as Record<string, unknown>;
      const projectId = j.project_id;
      const clientEmail = j.client_email;
      const privateKey = typeof j.private_key === "string" ? j.private_key.replace(/\\n/g, "\n") : null;
      if (j.type === "service_account" && typeof projectId === "string" && /^[a-z0-9-]{4,40}$/.test(projectId) && typeof clientEmail === "string" && clientEmail.includes("@") && privateKey?.includes("PRIVATE KEY")) {
        return { projectId, clientEmail, privateKey };
      }
    } catch {
      // Not JSON this way: try the next reading.
    }
  }
  return null;
}

/** Whether this deployment can send push notifications at all. */
export function fcmConfigured(env: Env = process.env): boolean {
  return parseServiceAccount(env.FCM_SERVICE_ACCOUNT) !== null;
}

/** The message Firebase is given for one address. Only strings in `data`; the path only when it is a path inside the app. */
export function fcmMessage(notification: Pick<PushNotification, "title" | "body" | "path">, token: string): Record<string, unknown> {
  const path = notification.path && notification.path.startsWith("/") && !notification.path.startsWith("//") ? notification.path : null;
  return {
    token,
    notification: { title: notification.title, body: notification.body },
    ...(path ? { data: { path } } : {}),
    android: { priority: "high" },
  };
}

function outcomeOf(result: { status: number; errorCode?: string }): FcmOutcome {
  if (result.status >= 200 && result.status < 300) return "sent";
  // The address is no longer registered, or was never one of this project's.
  if (result.status === 404 || result.errorCode === "UNREGISTERED" || (result.status === 403 && result.errorCode === "SENDER_ID_MISMATCH")) return "gone";
  return "failed";
}

function googleTransport(account: ServiceAccount): FcmTransport {
  const client = new JWT({ email: account.clientEmail, key: account.privateKey, scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
  return async (projectId, message) => {
    try {
      const res = await client.request({ url: `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, method: "POST", data: { message }, timeout: 10_000 });
      return { status: res.status };
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { error?: { details?: { errorCode?: string }[]; status?: string } } } }).response;
      const errorCode = response?.data?.error?.details?.find((d) => d.errorCode)?.errorCode ?? response?.data?.error?.status;
      return { status: response?.status ?? 0, errorCode };
    }
  };
}

export type FcmOptions = {
  /** Replaces the network (tests). */
  transport?: FcmTransport;
  /** Told which addresses Firebase says are gone, so their rows can be deleted. Its failure never fails the send. */
  onGone?: (tokens: string[]) => Promise<void> | void;
};

/**
 * The sender for lib/messages, or null when FCM_SERVICE_ACCOUNT isn't set.
 * One notification goes to each of the person's devices; it counts as sent
 * when at least one device took it.
 */
export function fcmPushSender(env: Env = process.env, options: FcmOptions = {}): PushSender | null {
  const account = parseServiceAccount(env.FCM_SERVICE_ACCOUNT);
  if (!account) return null;
  let transport = options.transport ?? null;
  return async (notification) => {
    transport ??= googleTransport(account);
    const send = transport;
    const outcomes = await Promise.all(
      notification.tokens.map(async (token): Promise<FcmOutcome> => {
        try {
          return outcomeOf(await send(account.projectId, fcmMessage(notification, token)));
        } catch {
          return "failed";
        }
      }),
    );
    const gone = notification.tokens.filter((_, i) => outcomes[i] === "gone");
    if (gone.length && options.onGone) {
      try {
        await options.onGone(gone);
      } catch {
        // Cleaning up is best effort; the rows go at the next send.
      }
    }
    const sent = outcomes.filter((o) => o === "sent").length;
    if (sent > 0) return { ok: true, providerId: `fcm:${sent}/${outcomes.length}` };
    return { ok: false, reason: outcomes.length === 0 ? "no_device" : gone.length === outcomes.length ? "device_gone" : "fcm_failed" };
  };
}
