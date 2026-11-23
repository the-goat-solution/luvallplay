// Where usage is counted (Phase 3 step 9; lib/entitlements.ts → recordUsage).
// Each wrapper counts after the real work succeeded, and can't fail it.
import type { Resend } from "resend";
import type { PaymentProvider } from "@luvallplay/core/payments";
import { sql } from "./database.ts";
import { recordUsage } from "./entitlements.ts";

/** The email client, counting each email it sends. */
export function meteredResend(client: Resend): Resend {
  const emails = client.emails;
  const send = emails.send.bind(emails) as (...args: unknown[]) => Promise<{ error?: unknown }>;
  const metered = new Proxy(emails, {
    get(target, prop, receiver) {
      if (prop !== "send") return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        const result = await send(...args);
        if (!result?.error) await recordUsage(sql, "email.sent");
        return result;
      };
    },
  });
  return new Proxy(client, {
    get(target, prop, receiver) {
      return prop === "emails" ? metered : Reflect.get(target, prop, receiver);
    },
  });
}

/** A payment provider, counting each payment it starts. */
export function meteredPayments(provider: PaymentProvider): PaymentProvider {
  return {
    ...provider,
    capabilities: provider.capabilities,
    async createPayment(input) {
      const payment = await provider.createPayment(input);
      await recordUsage(sql, "payments.created");
      return payment;
    },
  };
}

export async function countUpload(bytes: number): Promise<void> {
  await recordUsage(sql, "storage.bytes_uploaded", bytes);
}

export async function countSms(): Promise<void> {
  await recordUsage(sql, "sms.sent");
}
