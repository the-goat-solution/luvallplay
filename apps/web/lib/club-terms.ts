// The club's own names in translated text (Phase 3 step 4; build plan §6.3).
//
// The dictionaries in @luvallplay/i18n say {pointsName} and {visionName}.
// Importing this file sets the built-in club's names, so every translated
// string has them wherever it is produced (pages, API routes, emails). The
// root layout and ClubProvider then set the names from the club's settings.
//
// One club per deployment (until step 11 gives each request its club), so
// one set of names per server process is correct today.
import { setTerms, type Terms } from "@luvallplay/i18n";
import { CLUB_TERMS } from "./constants.ts";

setTerms(CLUB_TERMS);

/** Use the club's names from its settings. */
export function applyClubTerms(terms: Terms): void {
  setTerms(terms);
}
