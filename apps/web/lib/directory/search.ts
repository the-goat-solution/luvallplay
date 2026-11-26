// Find a club (build plan §8 item 1): the search rules, as pure code.
//
// This file decides which clubs a search shows and in what order. It has no
// database in it: the SQL that runs the same search (next step) is tested
// against `searchListings` here, club by club, so the two can't drift.
//
// What a player can filter on: sport, day, level, price and casual-friendly.
// Where: near a point (when they share their location or tap the map), or
// by city or postcode when they don't.
//
// A club appears only when ALL of these hold:
// - the club switched its listing on (opt-in, off by default);
// - the Find a club module is on for the club;
// - the club is active (not in setup, suspended or closed);
// - the club is in this deployment's region (§6.9).

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

/** A club's public listing: what the club chose to show in Find a club. */
export type ClubListing = {
  clubId: number;
  slug: string;
  name: string;
  /** The club switched its listing on. */
  listed: boolean;
  /** The Find a club module is on for this club. */
  moduleOn: boolean;
  /** tenants.status. */
  status: string;
  region: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** ISO 4217. */
  currency: string;
  sports: string[];
  venue: string | null;
  city: string | null;
  postcode: string | null;
  /** The venue's position. Null until the club places its pin: the club then shows in city and postcode searches only. */
  latitude: number | null;
  longitude: number | null;
  days: Weekday[];
  levels: Level[];
  /** Visitors can book a casual session without joining. */
  casualFriendly: boolean;
  /** The cheapest way to play once, in the club's currency (minor units). 0 = free; null = not given. */
  priceFromMinor: number | null;
};

export type SearchQuery = {
  region: string;
  sport?: string;
  days?: Weekday[];
  level?: Level;
  casualFriendly?: boolean;
  /** Free clubs only. */
  free?: boolean;
  /** At most this much to play once; only clubs priced in `currency` can be compared. */
  maxPriceMinor?: number;
  currency?: string;
  /** Near a point… */
  near?: { latitude: number; longitude: number; radiusKm: number };
  /** …or in a place, when location isn't shared. */
  place?: { country: string; city?: string; postcode?: string };
  limit: number;
  offset: number;
};

export const DEFAULT_RADIUS_KM = 25;
export const MAX_RADIUS_KM = 200;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export type SearchError =
  | "bad_sport"
  | "bad_day"
  | "bad_level"
  | "bad_price"
  | "bad_flag"
  | "bad_location"
  | "bad_radius"
  | "bad_country"
  | "bad_place"
  | "no_location"
  | "bad_page";

const SPORT = /^[a-z][a-z0-9-]{1,30}$/;

/** A place name or postcode as a comparison key: accents, case, spacing and punctuation ignored. */
export function placeKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Postcodes compare without any spacing ("SW1A 1AA" = "sw1a1aa"). */
export function postcodeKey(value: string | null | undefined): string {
  return placeKey(value).replace(/ /g, "");
}

function number(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads a search from URL query parameters, strictly: anything malformed is
 * an error (a 400), never a silently wider search.
 *
 * sport=badminton  day=fri,sat  level=beginner  casual=1  free=1
 * max_price=1500&currency=NZD  lat=-36.85&lng=174.76&radius_km=25
 * country=NZ&city=Auckland  country=NZ&postcode=1010  limit=20&offset=0
 */
export function parseSearch(params: Record<string, string | undefined>, region: string): { ok: true; query: SearchQuery } | { ok: false; error: SearchError } {
  const fail = (error: SearchError) => ({ ok: false as const, error });
  const has = (k: string) => params[k] !== undefined && params[k] !== "";
  const query: SearchQuery = { region, limit: DEFAULT_LIMIT, offset: 0 };

  if (has("sport")) {
    if (!SPORT.test(params.sport!)) return fail("bad_sport");
    query.sport = params.sport;
  }
  if (has("day")) {
    const days = params.day!.split(",");
    if (days.length > 7 || !days.every((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d))) return fail("bad_day");
    query.days = WEEKDAYS.filter((d) => days.includes(d));
  }
  if (has("level")) {
    if (!(LEVELS as readonly string[]).includes(params.level!)) return fail("bad_level");
    query.level = params.level as Level;
  }
  for (const flag of ["casual", "free"] as const) {
    if (!has(flag)) continue;
    if (params[flag] !== "1") return fail("bad_flag");
    if (flag === "casual") query.casualFriendly = true;
    else query.free = true;
  }
  if (has("max_price")) {
    const max = number(params.max_price);
    if (max === null || !Number.isInteger(max) || max < 0 || max > 100_000_000) return fail("bad_price");
    if (!/^[A-Z]{3}$/.test(params.currency ?? "")) return fail("bad_price");
    query.maxPriceMinor = max;
    query.currency = params.currency;
  }

  if (has("lat") || has("lng")) {
    const latitude = number(params.lat);
    const longitude = number(params.lng);
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return fail("bad_location");
    let radiusKm = DEFAULT_RADIUS_KM;
    if (has("radius_km")) {
      const r = number(params.radius_km);
      if (r === null || r <= 0 || r > MAX_RADIUS_KM) return fail("bad_radius");
      radiusKm = r;
    }
    query.near = { latitude, longitude, radiusKm };
  } else if (has("country")) {
    if (!/^[A-Z]{2}$/.test(params.country!)) return fail("bad_country");
    const city = placeKey(params.city);
    const postcode = postcodeKey(params.postcode);
    if ((has("city") && !city) || (has("postcode") && !postcode) || city.length > 80 || postcode.length > 12) return fail("bad_place");
    query.place = { country: params.country!, ...(city ? { city } : {}), ...(postcode ? { postcode } : {}) };
  } else {
    // A search is always somewhere: the whole region at once isn't offered.
    return fail("no_location");
  }

  if (has("limit")) {
    const limit = number(params.limit);
    if (limit === null || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return fail("bad_page");
    query.limit = limit;
  }
  if (has("offset")) {
    const offset = number(params.offset);
    if (offset === null || !Number.isInteger(offset) || offset < 0 || offset > 10_000) return fail("bad_page");
    query.offset = offset;
  }
  return { ok: true, query };
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km (haversine). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A latitude/longitude box that contains every point within `radiusKm`: the
 * cheap first cut an index can answer, before the exact distance. When the
 * circle reaches a pole or wraps the date line the box widens to all
 * longitudes (`wraps`), which is always safe.
 */
export function boundingBox(center: { latitude: number; longitude: number }, radiusKm: number): { minLat: number; maxLat: number; minLng: number; maxLng: number; wraps: boolean } {
  const dLat = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const minLat = Math.max(-90, center.latitude - dLat);
  const maxLat = Math.min(90, center.latitude + dLat);
  const all = { minLat, maxLat, minLng: -180, maxLng: 180, wraps: true };
  if (minLat <= -90 || maxLat >= 90) return all;
  const dLng = (Math.asin(Math.min(1, Math.sin(radiusKm / EARTH_RADIUS_KM) / Math.cos(rad(center.latitude)))) * 180) / Math.PI;
  const minLng = center.longitude - dLng;
  const maxLng = center.longitude + dLng;
  if (minLng < -180 || maxLng > 180) return all;
  return { minLat, maxLat, minLng, maxLng, wraps: false };
}

/** Whether a club may appear in Find a club at all (see the top of this file). */
export function isVisible(l: ClubListing, region: string): boolean {
  return l.listed && l.moduleOn && l.status === "active" && l.region === region;
}

function matchesFilters(l: ClubListing, q: SearchQuery): boolean {
  if (q.sport && !l.sports.includes(q.sport)) return false;
  if (q.days?.length && !q.days.some((d) => l.days.includes(d))) return false;
  if (q.level && !l.levels.includes(q.level)) return false;
  if (q.casualFriendly && !l.casualFriendly) return false;
  if (q.free && l.priceFromMinor !== 0) return false;
  if (q.maxPriceMinor !== undefined) {
    // A club that gave no price, or prices in another currency, can't be compared: it's left out. Free is free in any currency.
    if (l.priceFromMinor === null) return false;
    if (l.priceFromMinor !== 0 && (l.currency !== q.currency || l.priceFromMinor > q.maxPriceMinor)) return false;
  }
  return true;
}

/** What Find a club shows for one club. Nothing here is private: the club chose every field. */
export type ClubCard = {
  clubId: number;
  slug: string;
  name: string;
  sports: string[];
  venue: string | null;
  city: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  /** From the searched point, to 0.1 km; null in a city or postcode search. */
  distanceKm: number | null;
  days: Weekday[];
  levels: Level[];
  casualFriendly: boolean;
  price: { fromMinor: number; currency: string } | null;
};

function card(l: ClubListing, km: number | null): ClubCard {
  return {
    clubId: l.clubId,
    slug: l.slug,
    name: l.name,
    sports: [...l.sports],
    venue: l.venue,
    city: l.city,
    country: l.country,
    latitude: l.latitude,
    longitude: l.longitude,
    distanceKm: km === null ? null : Math.round(km * 10) / 10,
    days: WEEKDAYS.filter((d) => l.days.includes(d)),
    levels: LEVELS.filter((v) => l.levels.includes(v)),
    casualFriendly: l.casualFriendly,
    price: l.priceFromMinor === null ? null : { fromMinor: l.priceFromMinor, currency: l.currency },
  };
}

/**
 * The search itself. Near a point: clubs with a pin within the radius,
 * nearest first. In a place: clubs in that country matching the postcode or
 * the city (either, when both are given; the whole country when neither),
 * postcode matches first, then by name. Ties always break by club id, so
 * paging is stable.
 */
export function searchListings(listings: readonly ClubListing[], q: SearchQuery): { total: number; clubs: ClubCard[] } {
  const visible = listings.filter((l) => isVisible(l, q.region) && matchesFilters(l, q));
  let rows: { l: ClubListing; km: number | null; group: number }[];
  if (q.near) {
    const near = q.near;
    rows = visible
      .filter((l) => l.latitude !== null && l.longitude !== null)
      .map((l) => ({ l, km: distanceKm(near, { latitude: l.latitude!, longitude: l.longitude! }), group: 0 }))
      .filter((r) => r.km <= near.radiusKm)
      .sort((a, b) => a.km - b.km || a.l.clubId - b.l.clubId);
  } else if (q.place) {
    const place = q.place;
    rows = visible
      .filter((l) => l.country === place.country)
      .map((l) => {
        const postcode = Boolean(place.postcode) && postcodeKey(l.postcode) === place.postcode;
        const city = Boolean(place.city) && placeKey(l.city) === place.city;
        return { l, km: null, group: postcode ? 0 : city ? 1 : place.postcode || place.city ? -1 : 2 };
      })
      .filter((r) => r.group >= 0)
      .sort((a, b) => a.group - b.group || placeKey(a.l.name).localeCompare(placeKey(b.l.name), "en") || a.l.clubId - b.l.clubId);
  } else {
    rows = [];
  }
  return { total: rows.length, clubs: rows.slice(q.offset, q.offset + q.limit).map((r) => card(r.l, r.km)) };
}
