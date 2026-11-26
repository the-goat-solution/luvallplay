// The players' app's text in both languages (apps/app loads one at a time,
// from ./app-en.ts and ./app-vi.ts; add keys there).
import { en } from "./app-en.ts";
import { vi } from "./app-vi.ts";

export type { AppKey } from "./app-en.ts";
export const app = { en, vi };
