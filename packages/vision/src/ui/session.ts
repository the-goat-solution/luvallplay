// Long-match safety for Wolf Vision (a doubles game runs 15–30 minutes):
//   • ChunkRecorder: the overlay recording goes to IndexedDB in 2-second
//     chunks at a moderate bitrate, instead of piling up in memory (30 min at
//     8 Mbps was ~1.8 GB of RAM: Safari kills the page long before that).
//   • Autosave: the running totals are written to localStorage every 30 s, so
//     a crash, a locked phone or a closed tab can resume the match.
//   • FrameStats + Throttle: what the camera really delivers, what we manage
//     to analyse, and an automatic slow-down of the person detector when the
//     phone falls behind (heat, an older phone, a busy main thread).
import type { CourtTap } from "../match-analyzer";
import type { LensPreset } from "../engine/lens";

// ── Recording ─────────────────────────────────────────────────────────────

const DB = "wolf-vision";
const STORE = "rec";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(r ? (r.result as T) : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Recording limits: ~2.5 Mbps keeps a 30-minute match around 560 MB on disk. */
export const REC_BITRATE = 2_500_000;
export const REC_MAX_MINUTES = 40;

export class ChunkRecorder {
  private rec: MediaRecorder | null = null;
  private db: IDBDatabase | null = null;
  private memory: Blob[] = [];
  private bytes = 0;
  private started = 0;
  private stopTimer = 0;
  private pending: Promise<unknown> = Promise.resolve();
  readonly mime: string;
  /** Why the recording stopped early, if it did. */
  stoppedFor: "limit" | "storage" | null = null;

  constructor(mime: string) {
    this.mime = mime;
  }

  get active(): boolean {
    return this.rec?.state === "recording";
  }

  get megabytes(): number {
    return this.bytes / 1e6;
  }

  get seconds(): number {
    return this.started ? (performance.now() - this.started) / 1000 : 0;
  }

  async start(stream: MediaStream, onStop: (blob: Blob) => void) {
    try {
      this.db = await openDb();
      await tx(this.db, "readwrite", (s) => s.clear());
    } catch {
      this.db = null; // private mode or blocked: fall back to memory (short recordings only)
    }
    const rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: REC_BITRATE });
    rec.ondataavailable = (ev) => {
      if (!ev.data.size) return;
      this.bytes += ev.data.size;
      if (!this.db) {
        this.memory.push(ev.data);
        // Without disk storage, stop before memory becomes a danger (~300 MB).
        if (this.bytes > 300e6) this.stop("storage");
        return;
      }
      const db = this.db;
      this.pending = this.pending.then(() => tx(db, "readwrite", (s) => s.add(ev.data)).catch(() => this.stop("storage")));
    };
    rec.onstop = async () => {
      clearTimeout(this.stopTimer);
      await this.pending;
      let blob: Blob;
      if (this.db) {
        const parts = ((await tx<Blob[]>(this.db, "readonly", (s) => s.getAll() as IDBRequest<Blob[]>).catch(() => [])) ?? []) as Blob[];
        blob = new Blob(parts, { type: this.mime.split(";")[0] });
      } else {
        blob = new Blob(this.memory, { type: this.mime.split(";")[0] });
        this.memory = [];
      }
      onStop(blob);
    };
    rec.start(2000);
    this.rec = rec;
    this.started = performance.now();
    this.stopTimer = window.setTimeout(() => this.stop("limit"), REC_MAX_MINUTES * 60_000);
  }

  stop(reason: "limit" | "storage" | null = null) {
    if (reason) this.stoppedFor = reason;
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
  }

  /** Frees the stored chunks (after the download was offered). */
  async clear() {
    if (this.db) await tx(this.db, "readwrite", (s) => s.clear()).catch(() => {});
  }
}

// ── Autosave and resume ───────────────────────────────────────────────────

export const AUTOSAVE_KEY = "wolf-vision-autosave";
export const AUTOSAVE_EVERY_MS = 30_000;
/** A saved match older than this is not offered for resuming. */
const AUTOSAVE_MAX_AGE_MS = 6 * 3_600_000;

export type CarriedTotals = {
  duration: number;
  rallies: number;
  longestRally: number;
  /** Shots in all rallies (for the average). */
  shots: number;
  fastestShotKmh: number | null;
  players: { hits: number; distance: number; topSpeed: number }[];
  breakdown: { accepted: number; inferred: number; predicted: number };
  estimated: number;
  plusMinus: number;
};

/** A player on court: a registered wolf, someone added by email, or a placeholder ("Wolf 3"). */
export type Wolf = { name: string; avatarUrl?: string | null; playerId?: number; email?: string; placeholder?: boolean };

export type Autosave = {
  v: 1;
  savedAt: number;
  challengeId: number | null;
  mode: "camera" | "video";
  lens: LensPreset;
  taps: CourtTap[];
  order: number[];
  sound: boolean;
  /** Totals so far, including earlier resumed parts. */
  totals: CarriedTotals;
  /** Uploads: where playback had reached (seconds). */
  videoTime?: number;
  videoName?: string;
  /** Who was on court (sessions that aren't an Arena challenge). */
  people?: Wolf[];
};

export function saveAutosave(a: Autosave) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(a));
  } catch {
    /* storage blocked or full: nothing else to do */
  }
}

export function loadAutosave(): Autosave | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Autosave;
    if (a.v !== 1 || Date.now() - a.savedAt > AUTOSAVE_MAX_AGE_MS) return null;
    return a;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}

type SummaryLike = {
  duration: number;
  rallies: number;
  longestRally: number;
  avgRallyShots: number;
  fastestShotKmh: number | null;
  players: { hits: number; distance: number; topSpeed: number }[];
  breakdown: { accepted: number; inferred: number; predicted: number };
  estimate: { estimated: number; plusMinus: number };
};

/** Totals of this part plus whatever was carried over from before a resume. */
export function addTotals(carried: CarriedTotals | null, s: SummaryLike): CarriedTotals {
  const shots = Math.round(s.avgRallyShots * s.rallies);
  const c = carried;
  const fast = [c?.fastestShotKmh, s.fastestShotKmh].filter((v): v is number => v != null);
  return {
    duration: (c?.duration ?? 0) + s.duration,
    rallies: (c?.rallies ?? 0) + s.rallies,
    longestRally: Math.max(c?.longestRally ?? 0, s.longestRally),
    shots: (c?.shots ?? 0) + shots,
    fastestShotKmh: fast.length ? Math.max(...fast) : null,
    players: s.players.map((p, i) => ({
      hits: (c?.players[i]?.hits ?? 0) + p.hits,
      distance: Math.round(((c?.players[i]?.distance ?? 0) + p.distance) * 10) / 10,
      topSpeed: Math.max(c?.players[i]?.topSpeed ?? 0, p.topSpeed),
    })),
    breakdown: {
      accepted: (c?.breakdown.accepted ?? 0) + s.breakdown.accepted,
      inferred: (c?.breakdown.inferred ?? 0) + s.breakdown.inferred,
      predicted: (c?.breakdown.predicted ?? 0) + s.breakdown.predicted,
    },
    estimated: (c?.estimated ?? 0) + s.estimate.estimated,
    // Independent parts: errors add in quadrature.
    plusMinus: Math.round(Math.hypot(c?.plusMinus ?? 0, s.estimate.plusMinus)),
  };
}

/** A summary-shaped view of carried totals (for the summary screen and saving). */
export function totalsAsSummary<S extends SummaryLike>(t: CarriedTotals, base: S): S {
  return {
    ...base,
    duration: Math.round(t.duration * 10) / 10,
    rallies: t.rallies,
    longestRally: t.longestRally,
    avgRallyShots: t.rallies ? Math.round((t.shots / t.rallies) * 10) / 10 : 0,
    fastestShotKmh: t.fastestShotKmh,
    players: base.players.map((p, i) => ({ ...p, ...t.players[i] })),
    breakdown: t.breakdown,
    estimate: { ...base.estimate, estimated: t.estimated, plusMinus: t.plusMinus },
  };
}

// ── Frame rate and throttling ─────────────────────────────────────────────

/** Rates over the last ~2 s: frames the camera/video delivered, frames analysed, detector runs. */
export class FrameStats {
  private delivered: number[] = [];
  private analysed: number[] = [];
  private detected: number[] = [];
  /** Processing time per analysed frame (ms, smoothed). */
  workMs = 0;
  /** Frame rate the camera reports (track settings), if known. */
  cameraFps: number | null = null;

  private static push(list: number[], now: number) {
    list.push(now);
    while (list.length && now - list[0] > 2000) list.shift();
  }

  private static rate(list: number[], now: number) {
    const recent = list.filter((t) => now - t <= 2000);
    return recent.length / 2;
  }

  frameDelivered(now = performance.now()) {
    FrameStats.push(this.delivered, now);
  }

  frameAnalysed(ms: number, detectorRan: boolean, now = performance.now()) {
    FrameStats.push(this.analysed, now);
    if (detectorRan) FrameStats.push(this.detected, now);
    this.workMs = this.workMs ? this.workMs * 0.9 + ms * 0.1 : ms;
  }

  snapshot(now = performance.now()) {
    return {
      delivered: FrameStats.rate(this.delivered, now),
      analysed: FrameStats.rate(this.analysed, now),
      detector: FrameStats.rate(this.detected, now),
      workMs: this.workMs,
      cameraFps: this.cameraFps,
    };
  }
}

/**
 * Detector stride (run it on every Nth frame) from how much of the frame
 * budget the analysis uses. Motion analysis (shuttle, swings) keeps running on
 * every frame; only the person detector, the most expensive part, slows down.
 * Moves one step at a time and waits a few seconds between steps.
 */
export class Throttle {
  stride = 2;
  private lastChange = 0;
  static readonly MIN = 2;
  static readonly MAX = 8;

  update(workMs: number, frameMs: number, now = performance.now()): number {
    if (now - this.lastChange < 3000) return this.stride;
    const load = workMs / Math.max(8, frameMs);
    if (load > 0.8 && this.stride < Throttle.MAX) {
      this.stride++;
      this.lastChange = now;
    } else if (load < 0.45 && this.stride > Throttle.MIN) {
      this.stride--;
      this.lastChange = now;
    }
    return this.stride;
  }

  get throttled(): boolean {
    return this.stride > Throttle.MIN;
  }
}
