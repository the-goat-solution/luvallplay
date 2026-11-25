import { appRoute, fail } from "@/lib/app-api";
import { deleteAccount } from "@/lib/app-account";

// Deleting the account (the person typed DELETE): the website's rules, from
// the same functions. Every session ends, this one included.
const route = appRoute(
  "account.delete",
  async ({ player }) => {
    const result = await deleteAccount(player);
    return result.ok ? { ok: true as const } : fail(result.status, result.code);
  },
  { badRequestCode: "confirm" },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
