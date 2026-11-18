"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { useLanguage } from "@/context/LanguageContext";
import { COURT, formatClock, landmarkId, type CourtTap, type Pt } from "@/lib/match-analyzer";
import { MatchEngine } from "@/lib/ma/engine";
import { LENS_PRIOR, courtToImage, fitCamera, type CourtCamera, type LensPreset } from "@/lib/ma/lens";
import { CAMERA_VIEWS, MatchSim, type CameraView, type SimOptions } from "@/lib/ma/sim";
import { scoreHits } from "@/lib/ma/simrun";
import type { MatchSetup, SavedMatchStats } from "@/lib/match-stats-db";
import { StripeCardForm } from "@/components/profile/LazyStripeCardForm";
import { CORNERS, CourtPicker, describePoint, type CourtView } from "./CourtPicker";
import { isPhone, listCameras, openCamera, pickCamera, type CameraChoice } from "./camera";
import { loadPersonDetector } from "./detector";
import { PLAYER_COLORS, drawOverlay, type OverlayPlayer, type OverlaySlot } from "./overlay";
import { MicListener, Pipeline, onsetsFromFile, type FrameSource } from "./pipeline";
import { primeKeepAwake, useKeepAwake } from "./useKeepAwake";
import { COPY } from "./copy";
import s from "./analyzer.module.css";

type Mode = "camera" | "video" | "demo";
type Step = "start" | "setup" | "calibrate" | "players" | "track" | "summary";
type Summary = ReturnType<MatchEngine["finish"]>;
type DemoOpts = Required<Pick<SimOptions, "light" | "noise" | "shake" | "sameShirts" | "sameShorts" | "crowdNoise">> & { lens: LensPreset; view: CameraView };

/** The signed-in player looking at the page (null when signed out). */
export type AnalyzerViewer = {
  id: number;
  name: string;
  firstName: string;
  avatarUrl: string | null;
  /** May use Wolf Vision from their profile (outside the Arena). */
  ownAccess: boolean;
  /** What a session costs them, in cents (0 = free). */
  prices: { live: number; upload: number };
};

type Session = { id: number; mode: "live" | "upload" };
type Pay = { mode: "live" | "upload"; sessionId: number; clientSecret: string; amount: number; then: () => void };
type Deliver = { kind: "idle" | "sending" } | { kind: "done"; delivered: number; refunded: boolean } | { kind: "error"; code: string };

const MAX_CANVAS = 1920;
const COURT_KEY = "tw-match-analyzer-court-v4";
const HEARTBEAT_MS = 15_000;
/** Where each slot's player is shown before the game (court metres): near-left, near-right, far-left, far-right. */
const SLOT_SPOTS: Pt[] = [
  { x: 1.6, y: 3.2 },
  { x: 4.5, y: 3.2 },
  { x: 1.6, y: 10.2 },
  { x: 4.5, y: 10.2 },
];
/** Extra points asked for after the four corners (0.5× lens): net post feet, then the two "T"s. */
const EXTRA_POINTS: Pt[] = [
  { x: 0, y: COURT.net },
  { x: COURT.width, y: COURT.net },
  { x: COURT.width / 2, y: COURT.net - COURT.shortService },
  { x: COURT.width / 2, y: COURT.net + COURT.shortService },
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
}

const money = (cents: number) => `NZ$${(cents / 100).toFixed(2)}`;

async function api<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "server");
  return data;
}

function ViewIcon({ view }: { view: CourtView }) {
  // A tiny court with the phone where it stands.
  const court = <rect x="9" y="6" width="14" height="22" rx="1" fill="#14532d" stroke="#f8fafc" strokeWidth="1" />;
  const net = <line x1="9" y1="17" x2="23" y2="17" stroke="#f8fafc" strokeWidth="1" />;
  const phone = view === "baseline" ? [16, 32] : view === "side" ? [3, 17] : [4, 31];
  return (
    <svg viewBox="0 0 32 36" width="40" height="44" aria-hidden="true">
      {court}
      {net}
      <rect x={phone[0] - 2} y={phone[1] - 3} width="4" height="6" rx="1" fill="#ffd54a" />
    </svg>
  );
}

export function MatchAnalyzer({
  challengeId,
  personal,
  viewer,
  sandbox,
  demo,
}: {
  challengeId: number | null;
  personal: boolean;
  viewer: AnalyzerViewer | null;
  sandbox: boolean;
  demo: boolean;
}) {
  const { lang, setLang } = useLanguage();
  const c = COPY[lang];
  const own = personal && !!viewer?.ownAccess;
  const kind: "arena" | "personal" | null = challengeId ? "arena" : own ? "personal" : null;

  // ── Challenge ─────────────────────────────────────────────────────────
  const [setup, setSetup] = useState<MatchSetup | null>(null);
  const [existing, setExisting] = useState<SavedMatchStats | null>(null);
  const [setupError, setSetupError] = useState<"signed_out" | "not_found" | "failed" | null>(null);
  const [names, setNames] = useState<string[]>(() =>
    own && viewer ? [viewer.firstName || viewer.name, COPY.en.partner, COPY.en.opponent(1), COPY.en.opponent(2)] : [1, 2, 3, 4].map((n) => COPY.en.player(n)),
  );
  const [teams, setTeams] = useState<[string, string]>(own ? [COPY.en.myTeam, COPY.en.theirTeam] : [COPY.en.teamA, COPY.en.teamB]);
  useEffect(() => {
    if (!own) return;
    // Defaults in the reader's language (names they typed are kept).
    setNames((n) => [n[0], n[1] === COPY.en.partner || n[1] === COPY.vi.partner ? c.partner : n[1], ...[2, 3].map((k) => (n[k] === COPY.en.opponent(k - 1) || n[k] === COPY.vi.opponent(k - 1) ? c.opponent(k - 1) : n[k]))]);
    setTeams([c.myTeam, c.theirTeam]);
  }, [own, c]);
  const [avatars, setAvatars] = useState<(string | null)[]>(() => [own ? viewer?.avatarUrl ?? null : null, null, null, null]);
  useEffect(() => {
    if (!challengeId) return;
    if (!viewer) return setSetupError("signed_out");
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/arena/match-stats?challenge=${challengeId}`, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 401) return setSetupError("signed_out");
        if (res.status === 404) return setSetupError("not_found");
        if (!res.ok) return setSetupError("failed");
        const data = (await res.json()) as { setup: MatchSetup; stats: SavedMatchStats | null };
        setSetup(data.setup);
        setExisting(data.stats);
        const people = data.setup.teams.flatMap((t) => t.players);
        setNames(people.map((p) => p.name));
        setAvatars(people.map((p) => p.avatarUrl ?? null));
        setTeams([data.setup.teams[0].name, data.setup.teams[1].name]);
      } catch {
        if (alive) setSetupError("failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [challengeId, viewer]);

  // Profile pictures for the overlay (cross-origin-safe so recording still works).
  const faces = useMemo(
    () =>
      avatars.map((url) => {
        if (!url || typeof Image === "undefined") return null;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        return img;
      }),
    [avatars],
  );

  // ── Session state ─────────────────────────────────────────────────────
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhone()), []);
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>("start");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lens, setLens] = useState<LensPreset>("wide");
  const [view, setView] = useState<CourtView>("baseline");
  const [cameras, setCameras] = useState<CameraChoice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  /** order[slot] = player index (0,1 posting pair; 2,3 accepting pair). Slots: half 0 left/right, half 1 left/right (court coordinates). */
  const [order, setOrder] = useState<number[]>([0, 1, 2, 3]);
  const [slotSel, setSlotSel] = useState<number | null>(null);
  const [sound, setSound] = useState(true);
  const [taps, setTaps] = useState<CourtTap[]>([]);
  const [target, setTarget] = useState<Pt | null>(CORNERS.baseline[0]);
  const [showPicker, setShowPicker] = useState(true);
  const [lastCourt, setLastCourt] = useState<{ taps: CourtTap[]; w: number; h: number; lens: LensPreset; view: CourtView } | null>(null);
  const [detectorState, setDetectorState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [paused, setPaused] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [picker, setPicker] = useState<Pt | null>(null);
  const [recording, setRecording] = useState(false);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [deliver, setDeliver] = useState<Deliver>({ kind: "idle" });
  const [tick, setTick] = useState(0);
  const [demoOpts, setDemoOpts] = useState<DemoOpts>({ light: 1, noise: 2, shake: 0, sameShirts: true, sameShorts: false, crowdNoise: 0.3, lens: "wide", view: "baseline" });
  /** Remounts the <video> element for every new video or session (a reused element can stay black on iOS). */
  const [videoKey, setVideoKey] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [pay, setPay] = useState<Pay | null>(null);
  const [payError, setPayError] = useState(false);
  const [crashed, setCrashed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileObj = useRef<File | null>(null);
  const pendingFile = useRef<File | null>(null);
  const urlRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const pipeRef = useRef<Pipeline | null>(null);
  const srcRef = useRef<FrameSource | null>(null);
  const micRef = useRef<MicListener | null>(null);
  const simRef = useRef<MatchSim | null>(null);
  const simCanvas = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const clock0 = useRef(0);
  const dragging = useRef<number | null>(null);
  const loupe = useRef<Pt | null>(null);
  const calTarget = useRef<Pt | null>(CORNERS.baseline[0]);
  const pausedRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const crashedRef = useRef(false);
  pausedRef.current = paused;
  sessionRef.current = session;

  useEffect(() => {
    const img = new Image();
    img.src = "/uploads/three-wolves-logo-white-mini.png";
    img.onload = () => (logoRef.current = img);
    try {
      setLastCourt(JSON.parse(localStorage.getItem(COURT_KEY) ?? "null"));
    } catch {
      /* storage blocked */
    }
  }, []);

  const awake = useKeepAwake((mode === "camera" && step !== "start" && step !== "summary") || (mode === "video" && step === "track"));

  const pickTarget = (p: Pt | null) => {
    calTarget.current = p;
    setTarget(p);
  };

  /** The next court point to ask for: the four corners, then (0.5× lens) net posts and Ts. */
  const nextTarget = useCallback(
    (placed: CourtTap[]): Pt | null => {
      const used = new Set(placed.map((q) => landmarkId(q.court)));
      const corner = CORNERS[view].find((p) => !used.has(landmarkId(p)));
      if (corner) return corner;
      if (lens !== "ultrawide" || placed.length >= 6) return null;
      return EXTRA_POINTS.find((p) => !used.has(landmarkId(p))) ?? null;
    },
    [view, lens],
  );

  const dims = useCallback((): { w: number; h: number } | null => {
    if (mode === "demo" && simRef.current) return { w: simRef.current.W, h: simRef.current.H };
    const v = videoRef.current;
    return v?.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
  }, [mode]);

  void tick;
  const videoW = dims()?.w ?? 0;
  const videoH = dims()?.h ?? 0;
  const cam: CourtCamera | null = useMemo(
    () => (videoW ? fitCamera(taps, videoW, videoH, LENS_PRIOR[lens]) : null),
    [taps, lens, videoW, videoH],
  );
  const needPoints = lens === "ultrawide" ? 6 : 4;

  const ensureDetector = useCallback(async () => {
    if (detectorRef.current) return detectorRef.current;
    setDetectorState("loading");
    try {
      detectorRef.current = await loadPersonDetector();
      setDetectorState("ready");
      return detectorRef.current;
    } catch (err) {
      console.error("[wolf-vision] detector", err);
      setDetectorState("failed");
      return null;
    }
  }, []);

  const slotNames = order.map((p) => names[p]);
  const slotColors = order.map((p) => PLAYER_COLORS[p]);
  const slotFaces = order.map((p) => faces[p]);

  const stopEverything = () => {
    micRef.current?.stop();
    micRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  // ── Sessions, payment, technical failures ─────────────────────────────
  const sessionMode = (m: Mode | null): "live" | "upload" => (m === "camera" ? "live" : "upload");
  const priceOf = (m: "live" | "upload") => (kind && viewer ? viewer.prices[m] : 0);

  /** Opens (and, when it costs something, pays for) a session. Resolves false if the player backs out. */
  const openSession = useCallback(
    async (m: "live" | "upload"): Promise<boolean> => {
      if (!kind || !viewer) return true; // sandbox / test: nothing is stored
      if (sessionRef.current && sessionRef.current.mode === m) return true;
      try {
        const r = await api<{ sessionId: number; status: "active" | "awaiting_payment"; priceCents: number; clientSecret?: string }>("/api/wolf-vision", {
          action: "start",
          kind,
          mode: m,
          challengeId,
        });
        if (r.status === "active") {
          setSession({ id: r.sessionId, mode: m });
          return true;
        }
        return await new Promise<boolean>((resolve) => {
          setPayError(false);
          setPay({
            mode: m,
            sessionId: r.sessionId,
            clientSecret: r.clientSecret!,
            amount: r.priceCents,
            then: () => resolve(true),
          });
          cancelPay.current = () => resolve(false);
        });
      } catch (err) {
        setError(c.loadFailed);
        console.error("[wolf-vision] start", err);
        return false;
      }
    },
    [kind, viewer, challengeId, c.loadFailed],
  );
  const cancelPay = useRef<() => void>(() => {});

  const paid = async () => {
    if (!pay) return;
    try {
      await api("/api/wolf-vision", { action: "confirm", sessionId: pay.sessionId });
      setSession({ id: pay.sessionId, mode: pay.mode });
      const then = pay.then;
      setPay(null);
      then();
    } catch {
      setPayError(true);
    }
  };

  const reportFailure = useCallback((reason: "camera_failed" | "model_failed" | "engine_crashed" | "video_unreadable", detail?: string) => {
    const ses = sessionRef.current;
    if (!ses) return;
    api<{ refunded: boolean }>("/api/wolf-vision", { action: "fail", sessionId: ses.id, reason, detail })
      .then((r) => {
        if (r.refunded) setNotice(c.refunded);
      })
      .catch(() => {});
    setSession(null);
  }, [c.refunded]);

  // ── Starting ──────────────────────────────────────────────────────────
  const chooseCamera = async () => {
    primeKeepAwake();
    setError(null);
    if (priceOf("live") > 0 && !(await openSession("live"))) return;
    setMode("camera");
    setStep("setup");
    try {
      const list = await listCameras();
      setCameras(list);
      setDeviceId(pickCamera(list, lens)?.deviceId ?? list[0]?.deviceId ?? "");
    } catch {
      setError(c.cameraFailed);
    }
  };

  const chooseVideo = async (file: File) => {
    setError(null);
    if (priceOf("upload") > 0 && !(await openSession("upload"))) return;
    setMode("video");
    fileObj.current = file;
    pendingFile.current = file;
    setVideoReady(false);
    setVideoKey((k) => k + 1);
    setStep("setup");
  };

  // A fresh <video> for each file: attach it once the element is mounted.
  useEffect(() => {
    const file = pendingFile.current;
    const v = videoRef.current;
    if (!file || !v) return;
    pendingFile.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(file);
    v.muted = true;
    v.playsInline = true;
    let primed = false;
    const ready = () => {
      if (v.readyState >= 2) {
        setVideoReady(true);
        setTick((x) => x + 1);
      }
    };
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      setTick((x) => x + 1);
    };
    v.onseeked = () => {
      ready();
      // Some browsers (iOS) only decode a picture once the video has played: a muted play/pause shows the frame.
      if (v.readyState < 2 && !primed) {
        primed = true;
        v.play()
          .then(() => {
            v.pause();
            ready();
          })
          .catch(() => {});
      }
    };
    v.onloadeddata = ready;
    v.onerror = () => {
      setError(c.videoUnreadable);
      reportFailure("video_unreadable", v.error?.message);
    };
    v.src = urlRef.current;
    v.load();
  }, [videoKey, c.videoUnreadable, reportFailure]);

  const startDemo = (opts: DemoOpts = demoOpts) => {
    stopEverything();
    setError(null);
    setMode("demo");
    const sim = new MatchSim({ w: 960, h: 540, seed: Math.floor(Math.random() * 1e6), ...opts });
    simRef.current = sim;
    const cv = document.createElement("canvas");
    cv.width = sim.W;
    cv.height = sim.H;
    simCanvas.current = cv;
    // Calibrated the way an assistant would: six taps, each a little off.
    const t6 = sim.taps(6);
    setTaps(t6);
    setLens(opts.lens);
    const camFit = fitCamera(t6, sim.W, sim.H, LENS_PRIOR[opts.lens])!;
    const engine = new MatchEngine({ cam: camFit, videoW: sim.W, videoH: sim.H, courtPoints: 6, lens: opts.lens, audioOn: true });
    pipeRef.current = new Pipeline(engine, sim.W, sim.H, null);
    srcRef.current = { kind: "sim", sim, canvas: cv };
    setOrder([0, 1, 2, 3]);
    setSummary(null);
    setStep("track");
  };

  useEffect(() => {
    if (demo && sandbox && !challengeId) startDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, sandbox]);

  const continueSetup = async () => {
    setError(null);
    if (mode === "camera") {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await openCamera(deviceId || null, lens);
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        v.muted = true;
        await v.play();
        setVideoReady(true);
      } catch (err) {
        reportFailure("camera_failed", (err as Error)?.name);
        return setError(c.cameraFailed);
      }
    }
    void ensureDetector();
    pickTarget(nextTarget([]));
    setTaps([]);
    setStep("calibrate");
    window.setTimeout(() => setTick((x) => x + 1), 300);
  };

  // ── Court ─────────────────────────────────────────────────────────────
  const toVideo = (ev: React.PointerEvent): { p: Pt; perPx: number } | null => {
    const canvas = canvasRef.current;
    const d = dims();
    if (!canvas || !d) return null;
    const rect = canvas.getBoundingClientRect();
    const ar = d.w / d.h;
    let w = rect.width, h = rect.height, ox = 0, oy = 0;
    if (w / h > ar) {
      w = h * ar;
      ox = (rect.width - w) / 2;
    } else {
      h = w / ar;
      oy = (rect.height - h) / 2;
    }
    const perPx = d.w / w;
    return { p: { x: (ev.clientX - rect.left - ox) * perPx, y: (ev.clientY - rect.top - oy) * perPx }, perPx };
  };

  const slotAt = (p: Pt, perPx: number): number | null => {
    if (!cam) return null;
    let best: number | null = null;
    let bestD = 70 * perPx;
    SLOT_SPOTS.forEach((spot, i) => {
      const q = courtToImage(cam, spot);
      // The marker's ring on the floor and its name tag above it.
      const d = Math.min(Math.hypot(q.x - p.x, q.y - p.y), Math.hypot(q.x - p.x, q.y - 90 * (videoH / 1080) - p.y));
      if (d < bestD) [bestD, best] = [d, i];
    });
    return best;
  };

  const tapSlot = (i: number) => {
    if (slotSel === null || slotSel === i) return setSlotSel(slotSel === i ? null : i);
    const a = slotSel, b = i;
    const sameHalf = (a < 2) === (b < 2);
    // Same half: the partners swap. Across the net: the two pairs swap ends.
    setOrder((o) => (sameHalf ? o.map((v, k) => (k === a ? o[b] : k === b ? o[a] : v)) : [o[2], o[3], o[0], o[1]]));
    setSlotSel(null);
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const at = toVideo(ev);
    if (!at) return;
    if (step === "calibrate") {
      ev.currentTarget.setPointerCapture(ev.pointerId);
      loupe.current = at.p;
      // Grab an existing point only when the finger is right on it while a new point is still asked for:
      // seen from high up, the next point (a net post) can sit a fingertip away from a placed corner.
      const grab = (calTarget.current ? 16 : 40) * at.perPx;
      let near = -1;
      let nearD = grab;
      taps.forEach((q, i) => {
        const d = Math.hypot(q.image.x - at.p.x, q.image.y - at.p.y);
        if (d < nearD) [nearD, near] = [d, i];
      });
      if (near >= 0) {
        dragging.current = near;
        return;
      }
      const court = calTarget.current;
      if (!court) return;
      const next = [...taps.filter((q) => landmarkId(q.court) !== landmarkId(court)), { image: at.p, court }];
      setTaps(next);
      dragging.current = next.length - 1;
      pickTarget(nextTarget(next));
      return;
    }
    if (step === "players") {
      const k = slotAt(at.p, at.perPx);
      if (k !== null) tapSlot(k);
      return;
    }
    if (step === "track" && fixOpen) setPicker(at.p);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (step !== "calibrate" || dragging.current === null) return;
    const at = toVideo(ev);
    if (!at) return;
    loupe.current = at.p;
    const k = dragging.current;
    setTaps((t) => t.map((q, i) => (i === k ? { ...q, image: at.p } : q)));
  };

  const endDrag = () => {
    dragging.current = null;
    loupe.current = null;
  };

  const useLastCourt = () => {
    const d = dims();
    if (!lastCourt || !d) return;
    const sx = d.w / lastCourt.w, sy = d.h / lastCourt.h;
    setTaps(lastCourt.taps.map((q) => ({ court: q.court, image: { x: q.image.x * sx, y: q.image.y * sy } })));
    setLens(lastCourt.lens);
    setView(lastCourt.view ?? "baseline");
    pickTarget(null);
  };

  // ── Arena: only challenges with a phone set up show tracking ──────────
  const heartbeat = useCallback(
    (hb: "start" | "beat" | "end") => {
      if (mode === "demo") return;
      const v = pipeRef.current?.engine.view();
      const q = Math.round((v?.quality.q ?? 0) * 100) / 100;
      if (setup) {
        fetch("/api/arena/match-stats", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId: setup.challengeId, kind: hb, rallies: v?.rally?.total ?? 0, hits: v ? v.estimate.seen + v.estimate.predicted : 0, quality: q }),
        }).catch(() => {});
      }
      const ses = sessionRef.current;
      if (ses && hb !== "end") api("/api/wolf-vision", { action: "beat", sessionId: ses.id, quality: q }).catch(() => {});
    },
    [setup, mode],
  );

  // ── Tracking ──────────────────────────────────────────────────────────
  const startTracking = async () => {
    const d = dims();
    if (!cam || !d) return;
    primeKeepAwake();
    try {
      const saved = { taps, w: d.w, h: d.h, lens, view };
      localStorage.setItem(COURT_KEY, JSON.stringify(saved));
      setLastCourt(saved);
    } catch {
      /* storage blocked */
    }
    if (!(await openSession(sessionMode(mode)))) return;
    const det = await ensureDetector();
    if (!det) {
      reportFailure("model_failed");
      return setError(c.modelFailed);
    }
    const engine = new MatchEngine({ cam, videoW: d.w, videoH: d.h, courtPoints: taps.length, lens, audioOn: sound });
    const pipe = new Pipeline(engine, d.w, d.h, det);
    pipe.realtime = mode === "camera";
    pipeRef.current = pipe;
    crashedRef.current = false;
    setCrashed(false);
    // Test environments only: lets the browser test harness read the engine.
    if (sandbox) (window as unknown as { __wolfVision?: Pipeline }).__wolfVision = pipe;
    const v = videoRef.current!;
    if (mode === "camera") {
      clock0.current = performance.now();
      const clock = () => (performance.now() - clock0.current) / 1000;
      srcRef.current = { kind: "video", video: v, clock };
      if (sound) {
        const mic = new MicListener();
        micRef.current = mic;
        void mic.start((o) => pipe.pushOnset(o), clock).then((ok) => engine.setAudio(ok));
      }
    } else {
      srcRef.current = { kind: "video", video: v, clock: () => v.currentTime };
      // A file with no (decodable) sound track: judge hits on the picture alone.
      const onsets = sound && fileObj.current ? await onsetsFromFile(fileObj.current) : null;
      if (onsets) pipe.setOfflineOnsets(onsets);
      engine.setAudio(!!onsets);
      v.currentTime = 0;
      v.playbackRate = 1;
      await v.play().catch(() => {});
    }
    setDeliver({ kind: "idle" });
    setStep("track");
    heartbeat("start");
  };

  /** Sends the final numbers: the Arena challenge (feed) and every registered player's own copy. */
  const sendStats = useCallback(
    async (sum: Summary) => {
      const ses = sessionRef.current;
      if (mode === "demo" || (!ses && !setup)) return;
      setDeliver({ kind: "sending" });
      try {
        if (setup) {
          const ids = setup.teams.flatMap((t) => t.players.map((p) => p.id));
          const bySlot = (playerIndex: number) => sum.players[order.indexOf(playerIndex)];
          await api<{ stats?: SavedMatchStats }>("/api/arena/match-stats", {
            challengeId: setup.challengeId,
            mode: mode === "camera" ? "live" : "upload",
            duration: sum.duration,
            rallies: sum.rallies,
            longestRally: sum.longestRally,
            avgRallyShots: sum.avgRallyShots,
            fastestShotKmh: sum.fastestShotKmh,
            players: ids.map((id, j) => ({ playerId: id, hits: bySlot(j).hits, distance: bySlot(j).distance, topSpeed: bySlot(j).topSpeed })),
            auto: {
              quality: sum.quality,
              accepted: sum.breakdown.accepted,
              inferred: sum.breakdown.inferred,
              predicted: sum.breakdown.predicted,
              estimated: sum.estimate.estimated,
              plusMinus: sum.estimate.plusMinus,
            },
          }).then((r) => setExisting(r.stats ?? null));
        }
        if (!ses) return setDeliver({ kind: "done", delivered: 0, refunded: false });
        const ids = setup ? setup.teams.flatMap((t) => t.players.map((p) => p.id)) : null;
        const tracked = pipeRef.current?.engine.identity.players.filter((p) => p.kf).length ?? 0;
        const r = await api<{ delivered: number; refunded: boolean }>("/api/wolf-vision", {
          action: "finish",
          sessionId: ses.id,
          duration: sum.duration,
          rallies: sum.rallies,
          longestRally: sum.longestRally,
          avgRallyShots: sum.avgRallyShots,
          fastestShotKmh: sum.fastestShotKmh,
          quality: sum.quality,
          trackedPlayers: tracked,
          teams,
          score: setup?.score ? { team0: setup.score.posting, team1: setup.score.accepting } : undefined,
          players: sum.players.map((p, slot) => ({
            name: names[order[slot]].slice(0, 80),
            team: order[slot] < 2 ? 0 : 1,
            playerId: ids ? ids[order[slot]] : order[slot] === 0 && viewer ? viewer.id : null,
            hits: p.hits,
            distance: Math.round(p.distance * 10) / 10,
            topSpeed: Math.min(15, Math.round(p.topSpeed * 10) / 10),
          })),
        });
        setDeliver({ kind: "done", delivered: r.delivered, refunded: r.refunded });
      } catch (err) {
        setDeliver({ kind: "error", code: (err as Error).message });
      }
    },
    [mode, setup, order, names, teams, viewer],
  );

  const finish = useCallback(() => {
    const e = pipeRef.current?.engine;
    if (!e) return;
    stopEverything();
    videoRef.current?.pause();
    const sum = e.finish();
    setSummary(sum);
    setStep("summary");
    heartbeat("end");
    void sendStats(sum);
  }, [heartbeat, sendStats]);

  // Drawing + processing loop.
  useEffect(() => {
    if (step !== "track" && step !== "calibrate" && step !== "players") return;
    let raf = 0;
    let lastVideoT = -1;
    let acc = 0;
    let lastNow = performance.now();
    let lastUi = 0;
    // Uploads: analysed frames per second of video, to slow playback on devices that can't keep up.
    let rateWall = performance.now();
    let rateVideo = -1;
    let rateSteps = 0;
    // Only newly presented video frames are analysed: the screen refreshes faster
    // than the camera (60–120 Hz vs 30 fps) and slowed uploads repeat frames, and a
    // repeated frame looks like "nothing moved" to the motion detectors.
    type VFCVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (h: number) => void;
    };
    const vfv = (srcRef.current?.kind === "video" ? srcRef.current.video : null) as VFCVideo | null;
    let vfSeq = 0;
    let vfMedia = 0;
    let vfDone = 0;
    let vfHandle = 0;
    const onFrame = (_n: number, meta: { mediaTime: number }) => {
      vfSeq++;
      vfMedia = meta.mediaTime;
      vfHandle = vfv!.requestVideoFrameCallback!(onFrame);
    };
    const hasVfc = !!vfv?.requestVideoFrameCallback;
    if (hasVfc && step === "track") vfHandle = vfv!.requestVideoFrameCallback!(onFrame);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const d = dims();
      if (!canvas || !d) return;
      const scale = Math.min(1, MAX_CANVAS / Math.max(d.w, d.h));
      const cw = Math.round(d.w * scale), ch = Math.round(d.h * scale);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext("2d")!;
      const pipe = pipeRef.current;
      const src = srcRef.current;
      const now = performance.now();
      if (step === "track" && pipe && src && !pausedRef.current && !crashedRef.current) {
        try {
          if (src.kind === "sim") {
            acc += Math.min(0.1, (now - lastNow) / 1000);
            let n = 0;
            while (acc >= 1 / 30 && n < 2) {
              pipe.step(src, 0);
              acc -= 1 / 30;
              n++;
            }
          } else {
            const v = src.video;
            const t = hasVfc && !v.srcObject ? vfMedia : src.clock();
            const fresh = hasVfc && v === vfv ? vfSeq !== vfDone : t !== lastVideoT;
            if (v.readyState >= 2 && fresh) {
              lastVideoT = t;
              vfDone = vfSeq;
              pipe.step(src, t);
              rateSteps++;
            }
            if (!v.srcObject) {
              // An upload is analysed at the same cadence on any device: when fewer
              // than ~24 frames per video second get through, play it slower.
              if (rateVideo < 0) rateVideo = t;
              if (now - rateWall > 1000 && t > rateVideo) {
                const perSec = rateSteps / (t - rateVideo);
                const want = perSec < 22 ? v.playbackRate * Math.max(0.5, perSec / 25) : perSec >= 24 ? v.playbackRate * 1.15 : v.playbackRate;
                const next = Math.min(1, Math.max(0.0625, want));
                if (Math.abs(next - v.playbackRate) > 0.01) v.playbackRate = next;
                rateWall = now;
                rateVideo = t;
                rateSteps = 0;
              }
              if (v.ended) finish();
            }
          }
        } catch (err) {
          // Keep what was tracked so far; the player can still end the game and get the stats.
          console.error("[wolf-vision] engine", err);
          crashedRef.current = true;
          setCrashed(true);
          videoRef.current?.pause();
          reportFailure("engine_crashed", String((err as Error)?.message ?? err).slice(0, 200));
        }
      }
      lastNow = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const v = videoRef.current;
      if (mode === "demo" && simCanvas.current) ctx.drawImage(simCanvas.current, 0, 0, cw, ch);
      else if (v && v.readyState >= 2) ctx.drawImage(v, 0, 0, cw, ch);
      else {
        ctx.fillStyle = "#08131f";
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const e = pipe?.engine;
      if (step === "calibrate" || step === "players" || !e) {
        drawOverlay(ctx, d.w, d.h, {
          cam,
          t: now / 1000,
          players: [],
          rally: null,
          teams,
          shuttle: [],
          hits: [],
          quality: null,
          estimate: null,
          waiting: 0,
          calibration: step === "calibrate" ? { taps: taps.map((q) => q.image), selected: dragging.current ?? undefined } : null,
          slots:
            step === "players" && cam
              ? SLOT_SPOTS.map(
                  (spot, i): OverlaySlot => ({ at: courtToImage(cam, spot), name: slotNames[i], color: slotColors[i], face: slotFaces[i], selected: slotSel === i }),
                )
              : null,
          show: { hud: false, cards: false, players: false, map: false, system: false },
        });
        // Magnifier while placing a court point: the finger hides exactly what matters.
        const lp = loupe.current;
        if (step === "calibrate" && lp) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const R = Math.round(Math.min(cw, ch) * 0.2);
          const zoom = 3;
          const px = lp.x * scale, py = lp.y * scale;
          // Top-left (the court diagram sits top-right), or bottom-left when the finger is up there.
          const lx = R + 12;
          const ly = px < cw / 2 && py < ch / 2 ? ch - R - 12 : R + 12;
          ctx.save();
          ctx.beginPath();
          ctx.arc(lx, ly, R, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(canvas, px - R / zoom, py - R / zoom, (2 * R) / zoom, (2 * R) / zoom, lx - R, ly - R, 2 * R, 2 * R);
          ctx.restore();
          ctx.save();
          ctx.strokeStyle = "#ffd54a";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(lx, ly, R, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(lx - R * 0.35, ly);
          ctx.lineTo(lx + R * 0.35, ly);
          ctx.moveTo(lx, ly - R * 0.35);
          ctx.lineTo(lx, ly + R * 0.35);
          ctx.stroke();
          ctx.restore();
        }
        return;
      }
      const view = e.view();
      const rs = e.rallyStats(view.t);
      const players: OverlayPlayer[] = view.players.map((p, i) => ({
        name: slotNames[i],
        color: slotColors[i],
        face: slotFaces[i],
        team: order[i] < 2 ? 0 : 1,
        pos: p.pos,
        box: p.box,
        conf: p.conf,
        tracked: p.tracked,
        hits: rs.hits[i],
        distance: rs.distance[i],
        topSpeed: rs.topSpeed[i],
        speed: p.speed,
      }));
      const nearIsPosting = order[0] < 2;
      drawOverlay(ctx, d.w, d.h, {
        cam: e.camera,
        t: view.t,
        players,
        rally: view.rally,
        teams: nearIsPosting ? teams : [teams[1], teams[0]],
        shuttle: view.shuttle,
        hits: view.hits,
        quality: view.quality,
        estimate: view.estimate,
        waiting: view.waiting,
        logo: logoRef.current,
        show: { hud: true, cards: true, players: true, map: true, system: true },
      });
      if (now - lastUi > 250) {
        lastUi = now;
        setTick((x) => x + 1);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (hasVfc) vfv!.cancelVideoFrameCallback?.(vfHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, cam, taps, order, teams, names, finish, slotSel, faces]);

  useEffect(() => {
    if (step !== "track" || mode === "demo") return;
    const id = window.setInterval(() => heartbeat("beat"), HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [step, mode, heartbeat]);

  useEffect(() => {
    if (step !== "track" || mode === "demo") return;
    const onLeave = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [step, mode]);

  useEffect(
    () => () => {
      stopEverything();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const togglePause = () => {
    const v = videoRef.current;
    if (mode === "video" && v) {
      if (paused) v.play().catch(() => {});
      else v.pause();
    }
    setPaused((p) => !p);
  };

  const toggleRecording = () => {
    if (recorderRef.current?.state === "recording") return recorderRef.current.stop();
    const canvas = canvasRef.current;
    const mime = pickMime();
    if (!canvas || !mime || !canvas.captureStream) return setError(c.unsupported);
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      setDownload({ url: URL.createObjectURL(blob), name: `wolf-vision-${stamp}.${mime.startsWith("video/mp4") ? "mp4" : "webm"}` });
      setRecording(false);
    };
    rec.start(1000);
    recorderRef.current = rec;
    setRecording(true);
  };

  const newSession = () => {
    stopEverything();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    // A brand-new <video> next time (see videoKey).
    setVideoKey((k) => k + 1);
    setVideoReady(false);
    pipeRef.current = null;
    srcRef.current = null;
    simRef.current = null;
    setSession(null);
    setMode(null);
    setStep("start");
    setTaps([]);
    pickTarget(CORNERS[view][0]);
    setSummary(null);
    setDownload(null);
    setFixOpen(false);
    setPaused(false);
    setCrashed(false);
    setDeliver({ kind: "idle" });
    setError(null);
  };

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2200);
  };

  // ── Test scenario: accuracy against the simulator's ground truth ──────
  const demoScore = (() => {
    if (mode !== "demo" || !simRef.current || !pipeRef.current) return null;
    const sim = simRef.current;
    const e = pipeRef.current.engine;
    const cut = sim.t - 0.6;
    const sc = scoreHits(sim.hits.filter((h) => h.t < cut), e.fusion.hits.filter((h) => h.t < cut));
    const f = pipeRef.current.lastSimFrame;
    let idOk = 0, idN = 0;
    if (f) {
      e.view(f.t).players.forEach((p, i) => {
        if (!p.pos) return;
        idN++;
        const d = f.truth.players.map((q) => Math.hypot(q.x - p.pos!.x, q.y - p.pos!.y));
        if (d.indexOf(Math.min(...d)) === i) idOk++;
      });
    }
    return { ...sc, identity: idN ? idOk / idN : null };
  })();

  const engineView = pipeRef.current?.engine.view();
  const elapsed = engineView?.elapsed ?? 0;
  const pointsDone = taps.length >= needPoints && !!cam;
  const banner =
    step === "calibrate"
      ? !videoReady
        ? c.videoLoading
        : target
          ? taps.length < 4
            ? c.calCorners(taps.length + 1, describePoint(target, lang, view))
            : c.calExtra(taps.length + 1, describePoint(target, lang, view))
          : cam
            ? c.calCheck
            : c.calMore
      : step === "players"
        ? null
        : step === "track"
          ? notice ?? (crashed ? c.engineCrashed : fixOpen ? c.fixHint : detectorState === "loading" ? c.model : null)
          : null;
  const signedOutArena = Boolean(challengeId) && !viewer;
  const blocked = (Boolean(challengeId) && !setup) || (!challengeId && !own && !sandbox);
  const stepNo = step === "setup" ? 1 : step === "calibrate" ? 2 : step === "players" ? 3 : 0;
  const deliveredNames = names.length ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : "";

  return (
    <div className={s.page}>
      <header className={s.top}>
        <h1>
          {c.title}
          <small>{own ? c.subOwn : c.sub}</small>
        </h1>
        {challengeId ? <a href="/profile/arena">{c.back}</a> : own ? <a href="/profile/player#wolf-vision">{c.backProfile}</a> : null}
        <button className={s.langBtn} onClick={() => setLang(lang === "en" ? "vi" : "en")} type="button">
          {lang === "en" ? "VI" : "EN"}
        </button>
      </header>

      <main className={s.body}>
        {error ? (
          <div className={s.error} role="alert">
            {error}
          </div>
        ) : null}

        {stepNo ? (
          <div className={s.stepper} aria-label={c.stepOf(stepNo, 3)}>
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= stepNo ? s.stepOn : undefined} />
            ))}
            <span>{c.stepOf(stepNo, 3)}</span>
            {mode === "camera" ? <span className={awake === "off" ? s.awakeOff : s.awakeOn}>{awake === "off" ? "⚠︎" : "☀︎"}</span> : null}
          </div>
        ) : null}

        {step === "start" ? (
          <>
            <section className={`${s.card} ${s.hero}`}>
              <p>{c.intro2}</p>
              <p className={s.muted}>{c.privacy2}</p>
              {setupError === "signed_out" || signedOutArena ? (
                <div className={s.notice}>
                  {c.signIn}{" "}
                  <a href={`/login?next=${encodeURIComponent(`/match-analyzer?challenge=${challengeId}`)}`} style={{ color: "inherit", fontWeight: 700 }}>
                    {c.signInBtn}
                  </a>
                </div>
              ) : setupError ? (
                <div className={s.error}>{setupError === "not_found" ? c.notFound : c.loadFailed}</div>
              ) : null}
              {!challengeId && !own && !sandbox ? <div className={s.notice}>{c.noAccess}</div> : null}
              {existing ? <div className={s.notice}>{c.savedBefore(existing.recordedBy.name)}</div> : null}
            </section>

            {setup ? (
              <section className={s.matchup}>
                {setup.teams.map((team, ti) => (
                  <div className={`${s.team} ${ti === 0 ? s.teamCoral : s.teamTeal}`} key={ti}>
                    <b>{team.name}</b>
                    {team.players.map((p, pi) => (
                      <span key={p.id}>
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt="" className={s.face} style={{ boxShadow: `0 0 0 2px ${PLAYER_COLORS[ti * 2 + pi]}` }} />
                        ) : (
                          <i className={s.dot} style={{ background: PLAYER_COLORS[ti * 2 + pi], color: PLAYER_COLORS[ti * 2 + pi] }} />
                        )}
                        {p.name}
                      </span>
                    ))}
                  </div>
                ))}
                <span className={s.vs}>{c.vs}</span>
              </section>
            ) : null}

            <div className={s.modes}>
              <button className={s.mode} type="button" onClick={chooseCamera} disabled={blocked || !phone} data-testid="mode-camera">
                <strong>📱 {c.cameraTitle}</strong>
                <small>{phone ? c.cameraSub : c.cameraOnlyPhone}</small>
                {priceOf("live") > 0 ? <em className={s.price}>{money(priceOf("live"))}</em> : null}
              </button>
              <button
                className={s.mode}
                type="button"
                onClick={() => {
                  primeKeepAwake();
                  fileRef.current?.click();
                }}
                disabled={blocked}
              >
                <strong>🎞️ {c.videoTitle}</strong>
                <small>{c.videoSub}</small>
                {priceOf("upload") > 0 ? <em className={s.price}>{money(priceOf("upload"))}</em> : null}
              </button>
              {sandbox ? (
                <button className={`${s.mode} ${s.modeDemo}`} type="button" onClick={() => startDemo()} data-testid="demo">
                  <strong>🧪 {c.demoTitle}</strong>
                  <small>{c.demoSub}</small>
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                hidden
                data-testid="video-file"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (f) void chooseVideo(f);
                }}
              />
            </div>
          </>
        ) : null}

        {step === "setup" ? (
          <section className={s.card}>
            <h2>{c.whereTitle}</h2>
            <div className={s.viewTiles} role="radiogroup" aria-label={c.whereTitle}>
              {(["baseline", "side", "corner"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} className={s.viewTile} onClick={() => setView(v)} data-testid={`view-${v}`}>
                  <ViewIcon view={v} />
                  <b>{v === "baseline" ? c.viewBaseline : v === "side" ? c.viewSide : c.viewCorner}</b>
                  <small>{v === "baseline" ? c.viewBaselineSub : v === "side" ? c.viewSideSub : c.viewCornerSub}</small>
                </button>
              ))}
            </div>
            <p className={s.hint}>{c.viewTip}</p>
            <div className={s.label}>{c.lens}</div>
            <div className={s.seg} role="group">
              {(["wide", "ultrawide"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lens === l}
                  onClick={() => {
                    setLens(l);
                    const pick = pickCamera(cameras, l);
                    if (pick) setDeviceId(pick.deviceId);
                  }}
                >
                  {l === "wide" ? c.lensWide : c.lensUltra}
                </button>
              ))}
            </div>
            <p className={s.hint}>{c.lensHint}</p>
            <details className={s.more}>
              <summary>{c.moreOptions}</summary>
              {mode === "camera" ? (
                <label className={s.field}>
                  {c.cameraPick}
                  <select value={deviceId} onChange={(ev) => setDeviceId(ev.target.value)}>
                    {cameras.map((cm) => (
                      <option key={cm.deviceId} value={cm.deviceId}>
                        {cm.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={s.check}>
                <input type="checkbox" checked={sound} onChange={(ev) => setSound(ev.target.checked)} />
                {mode === "camera" ? c.sound : c.soundVideo}
              </label>
              <p className={s.hint}>{c.soundHint}</p>
            </details>
            <div className={s.stickyBar}>
              <button className={s.btn} type="button" onClick={continueSetup} disabled={mode === "video" && !videoReady} data-testid="setup-continue">
                {mode === "video" && !videoReady ? c.videoLoading : c.continue}
              </button>
            </div>
          </section>
        ) : null}

        {/* The stage stays mounted so the video element keeps playing. */}
        <div className={s.stage} ref={stageRef} hidden={step === "start" || step === "setup" || step === "summary"}>
          <canvas
            ref={canvasRef}
            data-testid="stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <video key={videoKey} ref={videoRef} className={s.hiddenVideo} playsInline muted preload="auto" data-testid="video" />
          {banner ? <div className={s.banner}>{banner}</div> : null}
          {step === "calibrate" ? (
            showPicker ? (
              <div className={s.pickerOverlay}>
                <button type="button" className={s.pickerHide} onClick={() => setShowPicker(false)} aria-label={c.hideDiagram}>
                  ×
                </button>
                <CourtPicker taps={taps} target={target} onPick={pickTarget} compact view={view} />
              </div>
            ) : (
              <button type="button" className={s.pickerShow} onClick={() => setShowPicker(true)}>
                {c.showDiagram}
              </button>
            )
          ) : null}
          {recording ? (
            <div className={s.rec}>
              <i /> REC
            </div>
          ) : null}
        </div>

        {step === "calibrate" ? (
          <>
            {lastCourt && !taps.length ? (
              <button className={s.lastCourt} type="button" onClick={useLastCourt} data-testid="last-court">
                ↺ {c.lastCourtBig}
              </button>
            ) : null}
            <div className={s.toolbar}>
              <div className={s.row}>
                <button
                  className={s.btnGhost}
                  type="button"
                  disabled={!taps.length}
                  onClick={() => {
                    const last = taps[taps.length - 1];
                    setTaps((t) => t.slice(0, -1));
                    if (last) pickTarget(last.court);
                  }}
                >
                  {c.undo}
                </button>
                <button
                  className={s.btnGhost}
                  type="button"
                  onClick={() => {
                    setTaps([]);
                    pickTarget(nextTarget([]));
                  }}
                >
                  {c.reset}
                </button>
                {cam ? <span className={s.hint}>{c.calQuality((cam.rms * 1920) / Math.max(1, videoW), cam.lens.lambda)}</span> : null}
              </div>
              <button className={s.btn} type="button" disabled={!pointsDone} onClick={() => setStep("players")} data-testid="cal-next">
                {c.next} →
              </button>
            </div>
            <p className={s.hint} style={{ margin: "6px 2px" }}>
              {c.calDragHint}
            </p>
          </>
        ) : null}

        {step === "players" ? (
          <>
            <div className={s.toolbar}>
              <button className={s.btnGhost} type="button" onClick={() => setStep("calibrate")}>
                ← {c.calTitle}
              </button>
              <div className={s.row}>
                <button className={s.btnGhost} type="button" onClick={() => setOrder((o) => [o[2], o[3], o[0], o[1]])}>
                  ⇅ {c.swapEnds}
                </button>
                <button className={s.btn} type="button" disabled={!cam || detectorState === "loading"} onClick={startTracking} data-testid="start-tracking">
                  {detectorState === "loading" ? c.model : c.start}
                </button>
              </div>
            </div>
            <section className={s.card}>
              <h2>{c.playersTitle}</h2>
              <p className={s.hint}>{c.playersHint}</p>
              {own ? (
                <div className={s.names}>
                  {[0, 1, 2, 3].map((k) => (
                    <label key={k} className={s.field}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <i className={s.dot} style={{ background: PLAYER_COLORS[k], color: PLAYER_COLORS[k] }} />
                        {k < 2 ? teams[0] : teams[1]}
                        {k === 0 ? ` (${c.me})` : ""}
                      </span>
                      <input value={names[k]} maxLength={40} onChange={(ev) => setNames((n) => n.map((x, j) => (j === k ? ev.target.value : x)))} />
                    </label>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {step === "track" ? (
          <>
            <div className={s.toolbar}>
              <div className={s.statusPill}>
                <i />
                {c.tracking} · {formatClock(elapsed).slice(0, 5)}
                {mode !== "demo" ? <span className={awake === "off" ? s.awakeOff : s.awakeOn}>{awake === "off" ? "⚠︎" : "☀︎"}</span> : null}
              </div>
              <div className={s.row}>
                {mode !== "camera" ? (
                  <button className={s.btnGhost} type="button" onClick={togglePause}>
                    {paused ? `▶ ${c.resume}` : `⏸ ${c.pause}`}
                  </button>
                ) : null}
                <button className={recording ? s.btnDanger : s.btnGhost} type="button" onClick={toggleRecording}>
                  {recording ? `⏹ ${c.stopRec}` : `⏺ ${c.record}`}
                </button>
                <button className={s.btnGhost} type="button" aria-pressed={fixOpen} onClick={() => setFixOpen((x) => !x)}>
                  🛠 {c.fix}
                </button>
                <button className={s.btnGhost} type="button" onClick={toggleFullscreen}>
                  ⛶ {c.fullscreen}
                </button>
                <button className={s.btn} type="button" onClick={finish} data-testid="end-game">
                  {c.endGame}
                </button>
              </div>
            </div>
            {mode !== "demo" && awake === "off" ? <div className={s.notice}>{c.awakeOff}</div> : null}
            {fixOpen ? (
              <section className={s.card}>
                <div className={s.row}>
                  <button
                    className={s.btnGhost}
                    type="button"
                    onClick={() => {
                      const e = pipeRef.current?.engine;
                      const last = e?.fusion.hits[e.fusion.hits.length - 1];
                      if (e && last) e.removeHit(last.t);
                    }}
                  >
                    ↶ {c.removeLast}
                  </button>
                  <span className={s.hint}>{c.addHitFor}</span>
                  {slotNames.map((n, i) => (
                    <button
                      key={i}
                      type="button"
                      className={s.chip}
                      style={{ borderColor: slotColors[i] }}
                      onClick={() => {
                        const e = pipeRef.current?.engine;
                        if (e) e.addHit(e.view().t, i);
                      }}
                    >
                      {n.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {mode === "demo" ? (
              <section className={s.card}>
                <div className={s.demoGrid}>
                  <div>
                    <h2>{c.demoControls}</h2>
                    <label className={s.field}>
                      {c.whereTitle}
                      <select value={demoOpts.view} onChange={(ev) => setDemoOpts((o) => ({ ...o, view: ev.target.value as CameraView }))} data-testid="demo-view">
                        {CAMERA_VIEWS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(
                      [
                        ["light", c.light, 0.3, 1, 0.05],
                        ["shake", c.shake, 0, 4, 0.5],
                        ["noise", c.noise, 0, 10, 1],
                        ["crowdNoise", c.crowd, 0, 2, 0.1],
                      ] as const
                    ).map(([k, label, min, max, st]) => (
                      <label key={k} className={s.slider}>
                        <span>
                          {label} <b>{demoOpts[k]}</b>
                        </span>
                        <input type="range" min={min} max={max} step={st} value={demoOpts[k]} onChange={(ev) => setDemoOpts((o) => ({ ...o, [k]: Number(ev.target.value) }))} />
                      </label>
                    ))}
                    <div className={s.seg} role="group">
                      {(["wide", "ultrawide"] as const).map((l) => (
                        <button key={l} type="button" aria-pressed={demoOpts.lens === l} onClick={() => setDemoOpts((o) => ({ ...o, lens: l }))}>
                          {l === "wide" ? c.lensWide : c.lensUltra}
                        </button>
                      ))}
                    </div>
                    <label className={s.check}>
                      <input type="checkbox" checked={demoOpts.sameShirts} onChange={(ev) => setDemoOpts((o) => ({ ...o, sameShirts: ev.target.checked }))} />
                      {c.sameShirts}
                    </label>
                    <label className={s.check}>
                      <input type="checkbox" checked={demoOpts.sameShorts} onChange={(ev) => setDemoOpts((o) => ({ ...o, sameShorts: ev.target.checked }))} />
                      {c.sameShorts}
                    </label>
                    <button className={s.btn} type="button" onClick={() => startDemo(demoOpts)} data-testid="demo-restart">
                      ↻ {c.restart}
                    </button>
                  </div>
                  <div>
                    <h2>{c.accuracy}</h2>
                    {demoScore ? (
                      <div className={s.kpis} data-testid="demo-accuracy">
                        <div className={s.kpi}>
                          <b>{demoScore.truth}</b>
                          <span>{c.truthHits}</span>
                        </div>
                        <div className={s.kpi}>
                          <b>{Math.round(demoScore.precision * 100)}%</b>
                          <span>{c.precision}</span>
                        </div>
                        <div className={s.kpi}>
                          <b>{Math.round(demoScore.recall * 100)}%</b>
                          <span>{c.recall}</span>
                        </div>
                        <div className={s.kpi}>
                          <b>{Math.round(demoScore.attribution * 100)}%</b>
                          <span>{c.hitter}</span>
                        </div>
                        <div className={s.kpi}>
                          <b>{Math.round(demoScore.side * 100)}%</b>
                          <span>{c.side}</span>
                        </div>
                        <div className={s.kpi}>
                          <b>{demoScore.identity === null ? "–" : `${Math.round(demoScore.identity * 100)}%`}</b>
                          <span>{c.identity}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}
            {download ? (
              <div className={s.ok}>
                {c.recordingReady}:{" "}
                <a href={download.url} download={download.name} style={{ color: "inherit", fontWeight: 700 }}>
                  {c.download}
                </a>
              </div>
            ) : null}
          </>
        ) : null}

        {step === "summary" && summary ? (
          <section className={s.card} data-testid="summary">
            <h2>{c.summaryTitle}</h2>
            <div className={s.kpis}>
              <div className={s.kpi}>
                <b>{formatClock(summary.duration).slice(0, 5)}</b>
                <span>{c.duration}</span>
              </div>
              <div className={s.kpi}>
                <b>{summary.rallies}</b>
                <span>{c.rallies}</span>
              </div>
              <div className={s.kpi}>
                <b>{summary.longestRally}</b>
                <span>{c.longest}</span>
              </div>
              <div className={s.kpi}>
                <b>{summary.avgRallyShots}</b>
                <span>{c.avgRally}</span>
              </div>
              <div className={s.kpi}>
                <b>{summary.fastestShotKmh != null ? `${summary.fastestShotKmh} km/h` : "–"}</b>
                <span>{c.fastest}</span>
              </div>
            </div>
            <table className={s.table}>
              <thead>
                <tr>
                  <th />
                  <th>{c.hits}</th>
                  <th>{c.distance}</th>
                  <th>{c.topSpeed}</th>
                </tr>
              </thead>
              <tbody>
                {summary.players.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {avatars[order[i]] ? (
                          <img src={avatars[order[i]]!} alt="" className={s.face} style={{ boxShadow: `0 0 0 2px ${slotColors[i]}` }} />
                        ) : (
                          <i className={s.dot} style={{ background: slotColors[i], color: slotColors[i] }} />
                        )}
                        {slotNames[i]}
                      </span>
                    </td>
                    <td>{p.hits}</td>
                    <td>{p.distance.toFixed(1)} m</td>
                    <td>{p.topSpeed.toFixed(1)} m/s</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={s.hint} style={{ marginTop: 12 }}>
              {c.breakdown(summary.breakdown.accepted, summary.breakdown.inferred, summary.breakdown.predicted)} ·{" "}
              {c.estimate(summary.estimate.estimated, summary.estimate.plusMinus, summary.quality)}
            </p>
            <p className={s.hint}>{c.formula}</p>
            {deliver.kind === "sending" ? <div className={s.notice}>{c.autoSaving}</div> : null}
            {deliver.kind === "done" ? (
              <div className={s.ok} data-testid="delivered">
                {setup ? c.deliveredArena(deliveredNames) : c.deliveredOwn}
                {deliver.refunded ? <> · {c.refunded}</> : null}
              </div>
            ) : null}
            {deliver.kind === "error" ? (
              <div className={s.error}>
                {deliver.code === "too_late" || deliver.code === "not_recordable" ? c.saveFailed(deliver.code) : c.deliverFailed}{" "}
                <button className={s.btnGhost} type="button" onClick={() => summary && void sendStats(summary)}>
                  {c.tryAgain}
                </button>
              </div>
            ) : null}
            {mode === "demo" ? <div className={s.notice}>{c.demoNotSaved}</div> : null}
            <div className={s.row} style={{ marginTop: 12 }}>
              {download ? (
                <a className={s.btnGhost} href={download.url} download={download.name} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  {c.download}
                </a>
              ) : null}
              <button
                className={s.btnGhost}
                type="button"
                onClick={() => {
                  setStep("track");
                  if (mode === "video") videoRef.current?.play().catch(() => {});
                }}
              >
                {c.backToTracking}
              </button>
              <button
                className={s.btnGhost}
                type="button"
                data-testid="new-session"
                onClick={() => {
                  if (mode === "demo" || deliver.kind === "done" || !kind || window.confirm(c.leaveWarn)) newSession();
                }}
              >
                {c.newSession}
              </button>
              {setup ? (
                <a className={s.btnGhost} href="/profile/arena" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  {c.back}
                </a>
              ) : own ? (
                <a className={s.btnGhost} href="/profile/player#wolf-vision" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  {c.backProfile}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>

      {picker ? (
        <div className={s.picker} onClick={() => setPicker(null)}>
          <div className={s.pickerSheet} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label={c.whoIsThis}>
            <h3>{c.whoIsThis}</h3>
            <div className={s.pickerGrid}>
              {slotNames.map((n, i) => (
                <button
                  key={i}
                  type="button"
                  className={s.hitBtn}
                  style={{ ["--c" as string]: slotColors[i] }}
                  onClick={() => {
                    const ok = pipeRef.current?.engine.tag(picker, i);
                    setPicker(null);
                    if (!ok) flash(c.noPerson);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <button className={s.btnGhost} type="button" onClick={() => setPicker(null)} style={{ width: "100%" }}>
              {c.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {pay ? (
        <div className={s.picker}>
          <div className={s.pickerSheet} role="dialog" aria-label={c.payTitle(pay.mode, money(pay.amount))} style={{ background: "#fff", color: "#0d1b26" }}>
            <h3 style={{ color: "#0d1b26" }}>{c.payTitle(pay.mode, money(pay.amount))}</h3>
            <p style={{ fontSize: 14 }}>{c.payBody}</p>
            {payError ? <div className={s.error}>{c.payFailed}</div> : null}
            <StripeCardForm clientSecret={pay.clientSecret} amountLabel={money(pay.amount)} onSuccess={paid} returnPath={typeof window !== "undefined" ? window.location.pathname + window.location.search : "/match-analyzer"} />
            <button
              className={s.btnGhost}
              type="button"
              style={{ width: "100%", marginTop: 8, color: "#0d1b26" }}
              onClick={() => {
                setPay(null);
                cancelPay.current();
              }}
            >
              {c.payCancel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
