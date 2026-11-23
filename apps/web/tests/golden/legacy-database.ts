// The OLD database client, for the golden master tests only: exactly what
// the app imported before Phase 2 (@vercel/postgres), plus the DATE parser
// lib/db.ts used to set. tests/golden/hook.mjs swaps it in for
// lib/database.ts in the "legacy" copy of the app's modules.
import { sql, db, types } from "@vercel/postgres";

types.setTypeParser(1082, (val: string) => val);

export { sql, db, types };
export const schema = {};
export function orm(): never {
  throw new Error("The legacy client has no ORM.");
}
