// Picks the database before anything connects: the DATABASE_URL_VAR switch
// (production runs on SYD_POSTGRES_URL) and the preview guard. Import it
// first, for its side effect, in any bundle that doesn't run
// instrumentation.ts.
//
// Why: Node-runtime middleware is its own bundle and Next.js never calls
// instrumentation.ts register() there. Without this import the admin check
// in middleware.ts read the old POSTGRES_URL database, couldn't find the
// player's session, and sent owners round in a loop between /admin and
// /login (and a preview's middleware would have read production).
import { applyDatabaseSwitch, guardPreviewDatabase } from "./db-switch";

applyDatabaseSwitch();
guardPreviewDatabase();
