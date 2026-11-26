// Find a club (build plan §8 item 1): who appears (club opt-in, module on,
// active, this region), the filters (sport, day, level, price, casual), near
// a point or by city/postcode, order and paging. Synthetic clubs only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIMIT,
  DEFAULT_RADIUS_KM,
  boundingBox,
  distanceKm,
  isVisible,
  parseSearch,
  placeKey,
  postcodeKey,
  searchListings,
  type ClubListing,
  type SearchQuery,
} from "../lib/directory/search.ts";

const AUCKLAND = { latitude: -36.8485, longitude: 174.7633 };
const WELLINGTON = { latitude: -41.2866, longitude: 174.7756 };
const HANOI = { latitude: 21.0278, longitude: 105.8342 };

let nextId = 100;
const club = (name: string, over: Partial<ClubListing> = {}): ClubListing => {
  const clubId = over.clubId ?? nextId++;
  return {
    clubId,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    listed: true,
    moduleOn: true,
    status: "active",
    region: "sydney",
    country: "NZ",
    currency: "NZD",
    sports: ["badminton"],
    venue: "Community hall",
    city: "Auckland",
    postcode: "1010",
    ...AUCKLAND,
    days: ["fri"],
    levels: ["beginner", "intermediate"],
    casualFriendly: true,
    priceFromMinor: 1000,
    ...over,
  };
};

const near = (over: Partial<SearchQuery> = {}): SearchQuery => ({ region: "sydney", near: { ...AUCKLAND, radiusKm: 25 }, limit: 20, offset: 0, ...over });
const names = (r: { clubs: { name: string }[] }) => r.clubs.map((c) => c.name);

test("distance: Auckland to Wellington is about 493 km; zero to itself; symmetric", () => {
  const d = distanceKm(AUCKLAND, WELLINGTON);
  assert.ok(d > 490 && d < 496, String(d));
  assert.equal(distanceKm(AUCKLAND, AUCKLAND), 0);
  assert.equal(distanceKm(WELLINGTON, AUCKLAND), d);
  // Across the date line: 179.9°E to 179.9°W on the equator is 0.2° of longitude, not 359.8°.
  const across = distanceKm({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 });
  assert.ok(across > 22 && across < 22.5, String(across));
});

test("the bounding box contains every point within the radius, anywhere on earth", () => {
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 4000; i++) {
    const center = { latitude: random() * 178 - 89, longitude: random() * 360 - 180 };
    const radiusKm = 1 + random() * 199;
    const box = boundingBox(center, radiusKm);
    const point = { latitude: center.latitude + (random() - 0.5) * 6, longitude: center.longitude + (random() - 0.5) * 12 };
    if (Math.abs(point.latitude) > 90) continue;
    const lng = ((((point.longitude + 180) % 360) + 360) % 360) - 180;
    if (distanceKm(center, { latitude: point.latitude, longitude: lng }) <= radiusKm) {
      assert.ok(point.latitude >= box.minLat && point.latitude <= box.maxLat, `lat ${JSON.stringify({ center, radiusKm, point })}`);
      assert.ok(box.wraps || (lng >= box.minLng && lng <= box.maxLng), `lng ${JSON.stringify({ center, radiusKm, point, box })}`);
    }
  }
  assert.equal(boundingBox({ latitude: 89.9, longitude: 10 }, 50).wraps, true);
  assert.equal(boundingBox({ latitude: -17, longitude: 179.95 }, 50).wraps, true);
  const box = boundingBox(AUCKLAND, 25);
  assert.equal(box.wraps, false);
  assert.ok(box.maxLng - box.minLng > 2 * (box.maxLat - box.minLat) * 0.6);
});

test("a club appears only when it is listed, the module is on, it is active and in this region", () => {
  const ok = club("Shown");
  assert.equal(isVisible(ok, "sydney"), true);
  const hidden = [
    club("Not listed", { listed: false }),
    club("Module off", { moduleOn: false }),
    club("In setup", { status: "setup" }),
    club("Suspended", { status: "suspended" }),
    club("Closed", { status: "closed" }),
    club("Other region", { region: "hanoi" }),
  ];
  for (const h of hidden) assert.equal(isVisible(h, "sydney"), false, h.name);
  assert.deepEqual(names(searchListings([ok, ...hidden], near())), ["Shown"]);
  assert.deepEqual(names(searchListings([ok, ...hidden], { region: "sydney", place: { country: "NZ" }, limit: 20, offset: 0 })), ["Shown"]);
});

test("near a point: only clubs with a pin inside the radius, nearest first", () => {
  const clubs = [
    club("Far north", { latitude: -36.65, longitude: 174.75 }), // ~22 km
    club("Next door", { latitude: -36.85, longitude: 174.77 }),
    club("Across town", { latitude: -36.9, longitude: 174.8 }),
    club("Wellington", { ...WELLINGTON, city: "Wellington" }),
    club("No pin yet", { latitude: null, longitude: null }),
  ];
  const r = searchListings(clubs, near());
  assert.deepEqual(names(r), ["Next door", "Across town", "Far north"]);
  assert.equal(r.total, 3);
  assert.ok(r.clubs[0].distanceKm! < 1 && r.clubs[2].distanceKm! > 20);
  assert.equal(r.clubs[0].distanceKm, Math.round(r.clubs[0].distanceKm! * 10) / 10);
  assert.deepEqual(names(searchListings(clubs, near({ near: { ...AUCKLAND, radiusKm: 5 } }))), ["Next door"]);
  assert.deepEqual(names(searchListings(clubs, near({ near: { ...AUCKLAND, radiusKm: 200 } }))).includes("Wellington"), false);
});

test("filters: sport, day, level, casual-friendly", () => {
  const clubs = [
    club("Friday badminton"),
    club("Weekend pickleball", { sports: ["pickleball"], days: ["sat", "sun"], levels: ["beginner"], casualFriendly: false }),
    club("Both sports", { sports: ["badminton", "pickleball"], days: ["mon", "sat"], levels: ["advanced"] }),
  ];
  assert.deepEqual(names(searchListings(clubs, near({ sport: "pickleball" }))).sort(), ["Both sports", "Weekend pickleball"]);
  assert.deepEqual(names(searchListings(clubs, near({ days: ["sat"] }))).sort(), ["Both sports", "Weekend pickleball"]);
  assert.deepEqual(names(searchListings(clubs, near({ days: ["fri", "sun"] }))).sort(), ["Friday badminton", "Weekend pickleball"]);
  assert.deepEqual(names(searchListings(clubs, near({ level: "advanced" }))), ["Both sports"]);
  assert.deepEqual(names(searchListings(clubs, near({ casualFriendly: true }))).sort(), ["Both sports", "Friday badminton"]);
  assert.deepEqual(names(searchListings(clubs, near({ sport: "badminton", days: ["mon"], level: "advanced", casualFriendly: true }))), ["Both sports"]);
  assert.deepEqual(names(searchListings(clubs, near({ sport: "futsal" }))), []);
});

test("price: free means free; a maximum only compares the same currency; no price given is left out", () => {
  const clubs = [
    club("Free play", { priceFromMinor: 0 }),
    club("Ten dollars", { priceFromMinor: 1000 }),
    club("Twenty dollars", { priceFromMinor: 2000 }),
    club("No price", { priceFromMinor: null }),
    club("Aussie", { currency: "AUD", country: "AU", priceFromMinor: 500 }),
    club("Free in Sydney", { currency: "AUD", country: "AU", priceFromMinor: 0 }),
  ];
  assert.deepEqual(names(searchListings(clubs, near({ free: true }))).sort(), ["Free in Sydney", "Free play"]);
  assert.deepEqual(names(searchListings(clubs, near({ maxPriceMinor: 1500, currency: "NZD" }))).sort(), ["Free in Sydney", "Free play", "Ten dollars"]);
  assert.deepEqual(names(searchListings(clubs, near({ maxPriceMinor: 1000, currency: "AUD" }))).sort(), ["Aussie", "Free in Sydney", "Free play"]);
  assert.equal(searchListings(clubs, near()).total, 6);
  const cards = searchListings(clubs, near()).clubs;
  assert.deepEqual(cards.find((c) => c.name === "No price")!.price, null);
  assert.deepEqual(cards.find((c) => c.name === "Free play")!.price, { fromMinor: 0, currency: "NZD" });
});

test("without location: by city or postcode, accents and case ignored, postcode matches first, then by name", () => {
  const clubs = [
    club("Zebra Smashers", { city: "Auckland", postcode: "1010" }),
    club("alpha shuttlers", { city: "auckland", postcode: "0620" }),
    club("Ōtara Club", { city: "AUCKLAND", postcode: "2023" }),
    club("Capital Badminton", { city: "Wellington", postcode: "6011" }),
    club("Hà Nội Lông Vũ", { city: "Hà Nội", country: "VN", currency: "VND", postcode: "100000" }),
  ];
  const place = (p: SearchQuery["place"]): SearchQuery => ({ region: "sydney", place: p, limit: 20, offset: 0 });
  assert.deepEqual(names(searchListings(clubs, place({ country: "NZ", city: "auckland" }))), ["alpha shuttlers", "Ōtara Club", "Zebra Smashers"]);
  assert.deepEqual(names(searchListings(clubs, place({ country: "NZ", postcode: "6011" }))), ["Capital Badminton"]);
  assert.deepEqual(names(searchListings(clubs, place({ country: "NZ", city: "auckland", postcode: "2023" }))), ["Ōtara Club", "alpha shuttlers", "Zebra Smashers"]);
  assert.deepEqual(names(searchListings(clubs, place({ country: "VN", city: placeKey("HA NOI") }))), ["Hà Nội Lông Vũ"]);
  assert.equal(searchListings(clubs, place({ country: "NZ" })).total, 4);
  assert.deepEqual(names(searchListings(clubs, place({ country: "NZ", city: "hamilton" }))), []);
  assert.equal(searchListings(clubs, place({ country: "NZ", city: "auckland" })).clubs[0].distanceKm, null);
  // No location at all in the query: nothing, not everything.
  assert.equal(searchListings(clubs, { region: "sydney", limit: 20, offset: 0 }).total, 0);
});

test("paging is stable: ties break by club id, pages don't overlap or skip", () => {
  const clubs = Array.from({ length: 45 }, (_, i) => club(`Same spot ${String(i).padStart(2, "0")}`, { clubId: 1000 + ((i * 7) % 45) }));
  const all = searchListings(clubs, near({ limit: 50 }));
  assert.equal(all.total, 45);
  assert.deepEqual(all.clubs.map((c) => c.clubId), Array.from({ length: 45 }, (_, i) => 1000 + i));
  const paged = [0, 20, 40].flatMap((offset) => searchListings(clubs, near({ limit: 20, offset })).clubs.map((c) => c.clubId));
  assert.deepEqual(paged, all.clubs.map((c) => c.clubId));
  assert.equal(searchListings(clubs, near({ offset: 60 })).clubs.length, 0);
});

test("a card carries only what the club chose to show, in a fixed order", () => {
  const [c] = searchListings([club("Tidy", { days: ["sun", "mon"], levels: ["advanced", "beginner"] })], near()).clubs;
  assert.deepEqual(Object.keys(c).sort(), ["casualFriendly", "city", "clubId", "country", "days", "distanceKm", "latitude", "levels", "longitude", "name", "price", "slug", "sports", "venue"]);
  assert.deepEqual(c.days, ["mon", "sun"]);
  assert.deepEqual(c.levels, ["beginner", "advanced"]);
});

test("reading a search from the URL: strict, with defaults", () => {
  const parse = (p: Record<string, string>) => parseSearch(p, "sydney");
  assert.deepEqual(parse({ lat: "-36.85", lng: "174.76" }), {
    ok: true,
    query: { region: "sydney", near: { latitude: -36.85, longitude: 174.76, radiusKm: DEFAULT_RADIUS_KM }, limit: DEFAULT_LIMIT, offset: 0 },
  });
  assert.deepEqual(
    parse({ sport: "badminton", day: "sat,fri", level: "beginner", casual: "1", free: "1", max_price: "1500", currency: "NZD", country: "NZ", city: " Whangārei ", postcode: "01 10", limit: "5", offset: "10" }),
    {
      ok: true,
      query: {
        region: "sydney",
        sport: "badminton",
        days: ["fri", "sat"],
        level: "beginner",
        casualFriendly: true,
        free: true,
        maxPriceMinor: 1500,
        currency: "NZD",
        place: { country: "NZ", city: "whangarei", postcode: "0110" },
        limit: 5,
        offset: 10,
      },
    },
  );
  const error = (p: Record<string, string>) => {
    const r = parse(p);
    return r.ok ? null : r.error;
  };
  const at = { lat: "-36.85", lng: "174.76" };
  assert.equal(error({}), "no_location");
  assert.equal(error({ sport: "badminton" }), "no_location");
  assert.equal(error({ lat: "-36.85" }), "bad_location");
  assert.equal(error({ lat: "91", lng: "0" }), "bad_location");
  assert.equal(error({ lat: "abc", lng: "0" }), "bad_location");
  assert.equal(error({ ...at, radius_km: "0" }), "bad_radius");
  assert.equal(error({ ...at, radius_km: "201" }), "bad_radius");
  assert.equal(error({ ...at, sport: "Bad Minton" }), "bad_sport");
  assert.equal(error({ ...at, sport: "x'; DROP TABLE tenants;--" }), "bad_sport");
  assert.equal(error({ ...at, day: "friday" }), "bad_day");
  assert.equal(error({ ...at, level: "pro" }), "bad_level");
  assert.equal(error({ ...at, casual: "yes" }), "bad_flag");
  assert.equal(error({ ...at, free: "true" }), "bad_flag");
  assert.equal(error({ ...at, max_price: "15.5", currency: "NZD" }), "bad_price");
  assert.equal(error({ ...at, max_price: "-1", currency: "NZD" }), "bad_price");
  assert.equal(error({ ...at, max_price: "1500" }), "bad_price");
  assert.equal(error({ ...at, max_price: "1500", currency: "nzd" }), "bad_price");
  assert.equal(error({ country: "nz" }), "bad_country");
  assert.equal(error({ country: "NZ", city: "!!!" }), "bad_place");
  assert.equal(error({ country: "NZ", city: "a".repeat(81) }), "bad_place");
  assert.equal(error({ ...at, limit: "0" }), "bad_page");
  assert.equal(error({ ...at, limit: "51" }), "bad_page");
  assert.equal(error({ ...at, offset: "-1" }), "bad_page");
  assert.equal(error({ ...at, offset: "1.5" }), "bad_page");
});

test("place and postcode keys", () => {
  assert.equal(placeKey("Hồ Chí Minh"), "ho chi minh");
  assert.equal(placeKey("St. John's"), "st john s");
  assert.equal(postcodeKey("SW1A 1AA"), "sw1a1aa");
  assert.equal(postcodeKey(" 1010 "), "1010");
  assert.equal(postcodeKey(null), "");
});

test("a big synthetic region: every result is inside the radius and nothing inside is missed", () => {
  let seed = 99;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const clubs = Array.from({ length: 2000 }, (_, i) =>
    club(`Club ${i}`, { latitude: -47 + random() * 13, longitude: 166 + random() * 13, sports: [random() < 0.5 ? "badminton" : "pickleball"], listed: random() < 0.9 }),
  );
  const q = near({ near: { ...WELLINGTON, radiusKm: 120 }, sport: "badminton", limit: 50 });
  const r = searchListings(clubs, q);
  const expected = clubs.filter((c) => c.listed && c.sports.includes("badminton") && distanceKm(WELLINGTON, { latitude: c.latitude!, longitude: c.longitude! }) <= 120);
  assert.equal(r.total, expected.length);
  assert.ok(r.total > 10);
  for (let i = 1; i < r.clubs.length; i++) assert.ok(r.clubs[i].distanceKm! >= r.clubs[i - 1].distanceKm!);
  // Hanoi is nowhere near.
  assert.equal(searchListings(clubs, near({ near: { ...HANOI, radiusKm: 200 } })).total, 0);
});
