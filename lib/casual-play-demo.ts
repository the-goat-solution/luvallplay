import type { RosterEntry } from "./db";
import { addDays } from "./db";
import { getClubToday } from "./dates";

// Demo mode for /casual-play: `CASUAL_PLAY_DEMO=1 npm run dev` runs the
// court board with no database, using a made-up roster kept in memory (it
// resets when the dev server restarts). Never on in production.

export function isCasualPlayDemo(): boolean {
  return process.env.CASUAL_PLAY_DEMO === "1" && process.env.NODE_ENV !== "production";
}

/** Organiser password in demo mode when MINI_GAME_PASSWORD isn't set. */
export const DEMO_PASSWORD = "demo";

const DEMO_PLAYERS: [first: string, last: string][] = [
  ["Hòa", "Nguyễn"], ["Sơn", "Trần"], ["Huy", "Lê"], ["Quang", "Phạm"],
  ["Timba", "Vũ"], ["Hùng", "Đặng"], ["Khoa", "Bùi"], ["Tố Anh", "Đỗ"],
  ["Jason", "Ho"], ["Hiếu", "Ngô"], ["Ly", "Dương"], ["Uyên", "Lý"],
  ["Trang", "Phan"], ["Gia Minh", "Võ"], ["Tú", "Hồ"], ["Kelcee", "Smith"],
  ["Minh", "Trương"], ["Minh", "Đinh"],
];

export function demoRoster(): RosterEntry[] {
  return DEMO_PLAYERS.map(([first, last], i) => ({
    bookingId: i < 6 ? i + 1 : null,
    membershipId: i < 6 ? null : i + 1,
    name: `${first} ${last}`,
    firstName: first,
    email: `demo${i + 1}@example.com`,
    phone: null,
    type: i < 6 ? "casual" : "monthly",
    method: "card",
    fillIn: null,
  }));
}

/** Last Friday, the next Friday (or today, if it is one) and the one after. */
export function demoDates(): string[] {
  const today = getClubToday().dateKey;
  const [y, m, d] = today.split("-").map(Number);
  const toFriday = (5 - new Date(y, m - 1, d).getDay() + 7) % 7;
  const next = addDays(today, toFriday);
  return [addDays(next, -7), next, addDays(next, 7)];
}

export const DEMO_SESSION = { time: "7:00 pm – 10:00 pm", location: "Demo Stadium, Christchurch" };

type Stored = { state: unknown; version: number };

// On globalThis so the store survives Next's dev hot reloads.
const g = globalThis as typeof globalThis & {
  __casualPlayDemo?: { boards: Map<string, Stored>; profiles: Map<string, { tier: 1 | 2 | null; nickname: string | null }> };
};
export const demoStore = (g.__casualPlayDemo ??= { boards: new Map(), profiles: new Map() });

// Starting tiers so the demo opens on a sorted board; three left unsorted.
for (const [i] of DEMO_PLAYERS.entries()) {
  const email = `demo${i + 1}@example.com`;
  if (!demoStore.profiles.has(email) && i < 15) {
    demoStore.profiles.set(email, { tier: i < 7 ? 1 : 2, nickname: null });
  }
}
