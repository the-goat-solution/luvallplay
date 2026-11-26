// The `family.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const familyEndpoints = defineEndpoints("family", {
  // A guardian's family (module juniors): the children they manage in this
  // club. Only ever the caller's own children. With Juniors off the whole
  // group answers 404 module_off. Refusals: 400 name_required,
  // name_invalid, birth_year, consent_required; 409 duplicate, too_many;
  // 404 not_found (not this guardian's child, or not in this club).
  "family.list": {
    method: "GET", path: "/clubs/{club}/family", auth: "session", scope: "club", module: "juniors",
    params: S.clubParams, response: S.familyResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "family.add": {
    method: "POST", path: "/clubs/{club}/family", auth: "session", scope: "club", module: "juniors",
    params: S.clubParams, body: S.familyAddRequest, response: S.familyChildResponse,
    rateLimit: { limit: 10, windowMs: 10 * MIN },
  },
  "family.update": {
    method: "PATCH", path: "/clubs/{club}/family/{id}", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, body: S.familyUpdateRequest, response: S.familyChildResponse,
    rateLimit: { limit: 20, windowMs: 10 * MIN },
  },
  "family.consent": {
    method: "PUT", path: "/clubs/{club}/family/{id}/consent", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, body: S.familyConsentRequest, response: S.familyChildResponse,
    rateLimit: { limit: 30, windowMs: 10 * MIN },
  },
  // A child's emergency contacts and medical note, for their guardian only.
  // Refusals: 400 too_many_contacts, name_required, name_too_long,
  // phone_invalid, relationship_too_long, notes_too_long; 404 not_found;
  // 503 notes_unavailable (no encryption key on this deployment).
  "family.care": {
    method: "GET", path: "/clubs/{club}/family/{id}/care", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, response: S.familyCareResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "family.careContacts": {
    method: "PUT", path: "/clubs/{club}/family/{id}/care/contacts", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, body: S.familyContactsRequest, response: S.familyCareResponse,
    rateLimit: { limit: 20, windowMs: 10 * MIN },
  },
  "family.careNotes": {
    method: "PUT", path: "/clubs/{club}/family/{id}/care/medical-notes", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, body: S.familyNotesRequest, response: S.familyCareResponse,
    rateLimit: { limit: 20, windowMs: 10 * MIN },
  },
  // The club's forms and waivers for a child, and signing one (the guardian
  // types their own name). Refusals: 400 name_required, name_too_long;
  // 404 not_found; 409 not_current (the form has newer wording: show it).
  "family.forms": {
    method: "GET", path: "/clubs/{club}/family/{id}/forms", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, response: S.familyFormsResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "family.signForm": {
    method: "POST", path: "/clubs/{club}/family/{id}/forms/{formId}/sign", auth: "session", scope: "club", module: "juniors",
    params: S.familyFormParams, body: S.familySignRequest, response: S.familyFormResponse,
    rateLimit: { limit: 20, windowMs: 10 * MIN },
  },
  // Booking a place for a child. The place is shared with adults' casual
  // bookings. Refusals: 409 not_bookable (outside the booking window),
  // day_paused, locked, full, payment_needed (the club charges and paying
  // isn't offered here yet); 404 not_found.
  "family.bookings": {
    method: "GET", path: "/clubs/{club}/family/bookings", auth: "session", scope: "club", module: "juniors",
    params: S.clubParams, response: S.familyBookingsResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "family.book": {
    method: "POST", path: "/clubs/{club}/family/{id}/bookings", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, body: S.familyBookRequest, response: S.familyBookingResponse,
    rateLimit: { limit: 20, windowMs: 10 * MIN },
  },
  "family.cancelBooking": {
    method: "POST", path: "/clubs/{club}/family/bookings/{id}/cancel", auth: "session", scope: "club", module: "juniors",
    params: S.familyBookingParams, body: S.emptyRequest, response: S.familyBookingResponse,
    rateLimit: { limit: 20, windowMs: 10 * MIN },
  },
});
