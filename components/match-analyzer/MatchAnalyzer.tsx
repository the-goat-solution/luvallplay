"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { useLanguage } from "@/context/LanguageContext";
import { formatClock, landmarkId, type CourtTap, type Pt } from "@/lib/match-analyzer";
import { MatchEngine } from "@/lib/ma/engine";
import { LENS_PRIOR, fitCamera, suspectTap, type CourtCamera, type LensPreset } from "@/lib/ma/lens";
import type { CheckerWeights } from "@/lib/ma/checker";
import { isTrial, trialDaysLeft } from "@/lib/wolf-vision-trial";
import { MatchSim, type SimOptions } from "@/lib/ma/sim";
import { scoreHits } from "@/lib/ma/simrun";
import type { MatchSetup, SavedMatchStats } from "@/lib/match-stats-db";
import { CourtPicker, DEFAULT_CORNERS, describePoint } from "./CourtPicker";
import {
  AUTOSAVE_EVERY_MS,
  ChunkRecorder,
  FrameStats,
  Throttle,
  addTotals,
  clearAutosave,
  loadAutosave,
  saveAutosave,
  totalsAsSummary,
  type Autosave,
  type CarriedTotals,
} from "./session";
import { isPhone, listCameras, openCamera, pickCamera, type CameraChoice } from "./camera";
import { loadPersonDetector } from "./detector";
import { PLAYER_COLORS, drawOverlay, type OverlayPlayer } from "./overlay";
import { MicListener, Pipeline, onsetsFromFile, type FrameSource } from "./pipeline";
import { COPY } from "./copy";
import { useProfileFocus } from "@/components/profile/focus";
import s from "./analyzer.module.css";

type Mode = "camera" | "video" | "demo";
type Step = "start" | "setup" | "calibrate" | "track" | "summary";
type Summary = ReturnType<MatchEngine["finish"]>;
type DemoOpts = Required<Pick<SimOptions, "light" | "noise" | "shake" | "sameShirts" | "sameShorts" | "crowdNoise">> & { lens: LensPreset };

const MAX_CANVAS = 1920;
const COURT_KEY = "tw-match-analyzer-court-v3";
const HEARTBEAT_MS = 15_000;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
}

/** AI layers running in this session, for the overlay label. */
function aiLayers(p: Pipeline | null): string[] {
  return p ? p.aiLayers() : [];
}

export function MatchAnalyzer({ challengeId, sandbox, demo, embedded = false }: { challengeId: number | null; sandbox: boolean; demo: boolean; embedded?: boolean }) {
  const { lang, setLang } = useLanguage();
  const c = COPY[lang];

  // ── Challenge ─────────────────────────────────────────────────────────
  const [setup, setSetup] = useState<MatchSetup | null>(null);
  const [existing, setExisting] = useState<SavedMatchStats | null>(null);
  const [setupError, setSetupError] = useState<"signed_out" | "not_found" | "failed" | null>(null);
  const [names, setNames] = useState<string[]>(() => [1, 2, 3, 4].map((n) => COPY.en.player(n)));
  const [teams, setTeams] = useState<[string, string]>([COPY.en.teamA, COPY.en.teamB]);
  useEffect(() => {
    if (!challengeId) return;
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
        setNames(data.setup.teams.flatMap((t) => t.players.map((p) => p.name)));
        setTeams([data.setup.teams[0].name, data.setup.teams[1].name]);
      } catch {
        if (alive) setSetupError("failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [challengeId]);

  // ── Passes ────────────────────────────────────────────────────────────
  const loadPasses = useCallback(async () => {
    if (isTrial()) return setPayState("trial");
    const url = new URL(window.location.href);
    const paidKind = url.searchParams.get("wv_paid");
    const sessionId = url.searchParams.get("session_id");
    const one = async (kind: "live" | "upload") => {
      const q = new URLSearchParams({ kind });
      if (sessionId && paidKind === kind) q.set("session_id", sessionId);
      const res = await fetch(`/api/wolf-vision/pass?${q}`, { cache: "no-store" });
      if (res.status === 401) return "signed_out" as const;
      if (res.status === 503) return "free" as const;
      if (!res.ok) throw new Error("pass");
      return (await res.json()) as { pass: PassInfo; testMode: boolean };
    };
    try {
      const [live, upload] = await Promise.all([one("live"), one("upload")]);
      if (live === "free" || upload === "free") return setPayState("free");
      if (live === "signed_out" || upload === "signed_out") return setPayState("signed_out");
      setPasses({ live: live.pass, upload: upload.pass });
      setTestMode(live.testMode);
      setPayState("ready");
      if (paidKind) {
        // Back from Stripe Checkout: tidy the address bar.
        url.searchParams.delete("wv_paid");
        url.searchParams.delete("session_id");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      setPayState("ready");
    }
  }, []);
  useEffect(() => {
    void loadPasses();
  }, [loadPasses]);

  // ── Session state ─────────────────────────────────────────────────────
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhone()), []);
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>("start");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lens, setLens] = useState<LensPreset>("wide");
  const [cameras, setCameras] = useState<CameraChoice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  /** order[slot] = player index (0,1 posting pair; 2,3 accepting pair). Slots: near-left, near-right, far-left, far-right. */
  const [order, setOrder] = useState<number[]>([0, 1, 2, 3]);
  const [sound, setSound] = useState(true);
  const [taps, setTaps] = useState<CourtTap[]>([]);
  const [target, setTarget] = useState<Pt | null>(DEFAULT_CORNERS[0]);
  const [showPicker, setShowPicker] = useState(true);
  const [hasLastCourt, setHasLastCourt] = useState(false);
  const [detectorState, setDetectorState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [paused, setPaused] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [picker, setPicker] = useState<Pt | null>(null);
  const [recording, setRecording] = useState(false);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; code: string }>({ kind: "idle" });
  const [tick, setTick] = useState(0);
  const [demoOpts, setDemoOpts] = useState<DemoOpts>({ light: 1, noise: 2, shake: 0, sameShirts: true, sameShorts: false, crowdNoise: 0.3, lens: "wide" });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileObj = useRef<File | null>(null);
  const urlRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const pipeRef = useRef<Pipeline | null>(null);
  const srcRef = useRef<FrameSource | null>(null);
  const micRef = useRef<MicListener | null>(null);
  const simRef = useRef<MatchSim | null>(null);
  const simCanvas = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<ChunkRecorder | null>(null);
  const statsRef = useRef(new FrameStats());
  const throttleRef = useRef(new Throttle());
  /** Totals from before a resume (added to this part's numbers). */
  const carriedRef = useRef<CarriedTotals | null>(null);
  /** Upload resume: where to continue in the video. */
  const resumeAtRef = useRef(0);
  const lastAutosave = useRef(0);
  const [resumable, setResumable] = useState<Autosave | null>(null);
  // ── Paywall: $5 live match, $2 video analysis (the test scenario is free) ──
  type PassInfo = { id: number; kind: "live" | "upload"; test: boolean } | null;
  const [passes, setPasses] = useState<{ live: PassInfo; upload: PassInfo }>({ live: null, upload: null });
  /** "free": no paywall here (local runs without a database). "trial": free for everyone until the end of Feb 2027. */
  const [payState, setPayState] = useState<"loading" | "ready" | "signed_out" | "free" | "trial">(() => (isTrial() ? "trial" : "loading"));
  const [testMode, setTestMode] = useState(false);
  const [paywallFor, setPaywallFor] = useState<"live" | "upload" | null>(null);
  const [buying, setBuying] = useState(false);
  const [shareTraining, setShareTraining] = useState(true);
  const passIdRef = useRef<number | null>(null);
  const [recNote, setRecNote] = useState<string | null>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const clock0 = useRef(0);
  const dragging = useRef<number | null>(null);
  const calTarget = useRef<Pt | null>(DEFAULT_CORNERS[0]);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const img = new Image();
    img.src = "/uploads/three-wolves-logo-white-mini.png";
    img.onload = () => (logoRef.current = img);
    try {
      setHasLastCourt(Boolean(localStorage.getItem(COURT_KEY)));
    } catch {
      /* storage blocked */
    }
    const saved = loadAutosave();
    // Only offer a match that belongs here (same challenge, or a free session).
    if (saved && saved.challengeId === challengeId) setResumable(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickTarget = (p: Pt | null) => {
    calTarget.current = p;
    setTarget(p);
  };

  const dims = useCallback((): { w: number; h: number } | null => {
    if (mode === "demo" && simRef.current) return { w: simRef.current.W, h: simRef.current.H };
    const v = videoRef.current;
    return v?.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
  }, [mode]);

  const videoW = dims()?.w ?? 0;
  const videoH = dims()?.h ?? 0;
  const cam: CourtCamera | null = useMemo(
    () => (videoW ? fitCamera(taps, videoW, videoH, LENS_PRIOR[lens]) : null),
    [taps, lens, videoW, videoH],
  );
  const suspect = useMemo(() => (cam ? suspectTap(cam, taps, videoW) : null), [cam, taps, videoW]);

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

  const stopEverything = () => {
    micRef.current?.stop();
    micRef.current = null;
    if (recorderRef.current?.active) recorderRef.current.stop();
  };

  // ── Starting ──────────────────────────────────────────────────────────
  /** Opens a mode if a pass covers it, otherwise shows the paywall for it. */
  const gate = (kind: "live" | "upload", go: () => void) => {
    if (payState === "free" || payState === "trial" || passes[kind]) {
      passIdRef.current = passes[kind]?.id ?? null;
      go();
    } else setPaywallFor(kind);
  };

  const buyPass = async (kind: "live" | "upload") => {
    setBuying(true);
    setError(null);
    try {
      const res = await fetch("/api/wolf-vision/pass", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, challengeId, returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; pass?: PassInfo; error?: string };
      if (data.url) {
        window.location.href = data.url; // Stripe Checkout; comes back with ?wv_paid=…
        return;
      }
      if (data.pass) {
        setPasses((p) => ({ ...p, [kind]: data.pass! }));
        setPaywallFor(null);
        setNotice(c.passReady(kind));
      } else setError(c.payFailed);
    } catch {
      setError(c.payFailed);
    }
    setBuying(false);
  };

  const chooseCamera = async () => {
    setError(null);
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

  // ── Resume after a crash / closed tab ───────────────────────────────────
  const resumeMatch = () => {
    const a = resumable;
    if (!a) return;
    carriedRef.current = a.totals;
    resumeAtRef.current = a.mode === "video" ? (a.videoTime ?? 0) : 0;
    setLens(a.lens);
    setOrder(a.order);
    setSound(a.sound);
    setTaps(a.taps);
    pickTarget(null);
    setResumable(null);
    setNotice(c.resumedNote(Math.round(a.totals.duration / 60)));
    if (a.mode === "camera") void chooseCamera();
    else {
      setNotice(c.resumeVideo);
      fileRef.current?.click();
    }
  };

  const discardResume = () => {
    clearAutosave();
    setResumable(null);
  };

  const chooseVideo = (file: File) => {
    setError(null);
    setMode("video");
    fileObj.current = file;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(file);
    const v = videoRef.current!;
    v.srcObject = null;
    v.src = urlRef.current;
    v.muted = true;
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, v.duration / 2);
      setStep("setup");
      setTick((x) => x + 1);
    };
  };

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
      } catch {
        return setError(c.cameraFailed);
      }
    }
    ensureDetector();
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

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const at = toVideo(ev);
    if (!at) return;
    if (step === "calibrate") {
      ev.currentTarget.setPointerCapture(ev.pointerId);
      const near = taps.findIndex((q) => Math.hypot(q.image.x - at.p.x, q.image.y - at.p.y) < 40 * at.perPx);
      if (near >= 0) {
        dragging.current = near;
        return;
      }
      const court = calTarget.current;
      if (!court) return;
      const next = [...taps.filter((q) => landmarkId(q.court) !== landmarkId(court)), { image: at.p, court }];
      setTaps(next);
      dragging.current = next.length - 1;
      const used = new Set(next.map((q) => landmarkId(q.court)));
      pickTarget(DEFAULT_CORNERS.find((p) => !used.has(landmarkId(p))) ?? null);
      return;
    }
    if (step === "track" && fixOpen) setPicker(at.p);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (step !== "calibrate" || dragging.current === null) return;
    const at = toVideo(ev);
    if (!at) return;
    const k = dragging.current;
    setTaps((t) => t.map((q, i) => (i === k ? { ...q, image: at.p } : q)));
  };

  const useLastCourt = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(COURT_KEY) ?? "null") as { taps: CourtTap[]; w: number; h: number; lens: LensPreset } | null;
      const d = dims();
      if (!saved || !d) return;
      const sx = d.w / saved.w, sy = d.h / saved.h;
      setTaps(saved.taps.map((q) => ({ court: q.court, image: { x: q.image.x * sx, y: q.image.y * sy } })));
      setLens(saved.lens);
      pickTarget(null);
    } catch {
      /* ignore */
    }
  };

  // ── Arena: only challenges with a phone set up show tracking ──────────
  const heartbeat = useCallback(
    (kind: "start" | "beat" | "end") => {
      if (!setup || mode === "demo") return;
      const v = pipeRef.current?.engine.view();
      fetch("/api/arena/match-stats", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: setup.challengeId,
          kind,
          rallies: v?.rally?.total ?? 0,
          hits: v ? v.estimate.seen + v.estimate.predicted : 0,
          quality: Math.round((v?.quality.q ?? 0) * 100) / 100,
        }),
      }).catch(() => {});
    },
    [setup, mode],
  );

  // ── Tracking ──────────────────────────────────────────────────────────
  const startTracking = async () => {
    const d = dims();
    if (!cam || !d) return;
    try {
      localStorage.setItem(COURT_KEY, JSON.stringify({ taps, w: d.w, h: d.h, lens }));
      setHasLastCourt(true);
    } catch {
      /* storage blocked */
    }
    // Paywall: this session uses the pass (a resume within 6 hours reuses it).
    if (payState !== "free" && payState !== "trial" && mode !== "demo") {
      const kind = mode === "camera" ? "live" : "upload";
      const id = passIdRef.current ?? passes[kind]?.id;
      const ok = id
        ? await fetch("/api/wolf-vision/pass", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ passId: id }) })
            .then((r) => r.ok || r.status === 503)
            .catch(() => false)
        : false;
      if (!ok) return setError(c.passNeeded);
    }
    const det = await ensureDetector();
    if (!det) return setError(c.modelFailed);
    // The shared AI model (improved by everyone's sessions); the bundled one if it cannot load in time.
    const shared = await Promise.race([
      fetch("/api/wolf-vision/model")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { model?: { weights?: CheckerWeights } } | null) => j?.model?.weights ?? undefined)
        .catch(() => undefined),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 2500)),
    ]);
    const engine = new MatchEngine({ cam, videoW: d.w, videoH: d.h, courtPoints: taps.length, lens, audioOn: sound, checker: shared, autoTrain: true });
    const pipe = new Pipeline(engine, d.w, d.h, det);
    pipe.realtime = mode === "camera";
    pipeRef.current = pipe;
    // AI pose layer: loads in the background; tracking starts without waiting for it.
    void import("./pose")
      .then(async ({ loadPose, PoseRunner }) => {
        const { softwareGpu } = await import("./detector");
        const model = await loadPose(!softwareGpu());
        if (pipeRef.current === pipe) pipe.pose = new PoseRunner(model);
      })
      .catch(() => {
        /* no pose layer: the motion swing detector still runs */
      });
    // Test environments only: lets the browser test harness read the engine.
    if (sandbox) (window as unknown as { __wolfVision?: Pipeline }).__wolfVision = pipe;
    const v = videoRef.current!;
    if (mode === "camera") {
      clock0.current = performance.now();
      const clock = () => (performance.now() - clock0.current) / 1000;
      srcRef.current = { kind: "video", video: v, clock };
      const track = streamRef.current?.getVideoTracks()[0];
      statsRef.current.cameraFps = track?.getSettings().frameRate ?? null;
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
      v.currentTime = resumeAtRef.current;
      v.playbackRate = 1;
      await v.play().catch(() => {});
    }
    setStep("track");
    heartbeat("start");
  };

  const finish = useCallback(() => {
    const e = pipeRef.current?.engine;
    if (!e) return;
    stopEverything();
    videoRef.current?.pause();
    const part = e.finish();
    // Auto-training: send this session's fine-tuned checker weights (numbers only, never video).
    if (shareTraining && e.checker && e.training.trained >= 200 && mode !== "demo" && payState !== "free") {
      void fetch("/api/wolf-vision/model", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "checker",
          weights: e.checker.toJSON(),
          trained: e.training.trained,
          meta: { mode: mode === "camera" ? "live" : "upload", quality: part.quality, pos: e.training.pos, neg: e.training.neg },
        }),
      }).catch(() => {});
    }
    setSummary(carriedRef.current ? totalsAsSummary(addTotals(carriedRef.current, part), part) : part);
    clearAutosave();
    setSaveState({ kind: "idle" });
    setStep("summary");
    heartbeat("end");
  }, [heartbeat, shareTraining, mode, payState]);

  // Drawing + processing loop.
  useEffect(() => {
    if (step !== "track" && step !== "calibrate") return;
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
    if (hasVfc) vfHandle = vfv!.requestVideoFrameCallback!(onFrame);
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
      if (step === "track" && pipe && src && !pausedRef.current) {
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
            const stats = statsRef.current;
            stats.frameDelivered(now);
            const r = pipe.step(src, t);
            stats.frameAnalysed(r.ms, r.detected, now);
            rateSteps++;
            if (v.srcObject) {
              // Live: when the phone falls behind (heat, a busy main thread), run the person
              // detector less often; motion analysis (shuttle, swings) keeps every frame.
              const snap = stats.snapshot(now);
              pipe.detectEvery = throttleRef.current.update(snap.workMs, 1000 / Math.max(10, snap.delivered), now);
            }
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
      }
      lastNow = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (mode === "demo" && simCanvas.current) ctx.drawImage(simCanvas.current, 0, 0, cw, ch);
      else if (videoRef.current) ctx.drawImage(videoRef.current, 0, 0, cw, ch);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const e = pipe?.engine;
      if (step === "calibrate" || !e) {
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
          calibration: { taps: taps.map((q) => q.image), selected: dragging.current ?? undefined },
          show: { hud: false, cards: false, players: false, map: false, system: false },
        });
        return;
      }
      const view = e.view();
      const rs = e.rallyStats(view.t);
      const players: OverlayPlayer[] = view.players.map((p, i) => ({
        name: slotNames[i],
        color: slotColors[i],
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
        perf: (() => {
          const sn = statsRef.current.snapshot(now);
          return { camera: sn.cameraFps ?? (mode === "camera" ? sn.delivered : null), analysed: sn.analysed, detector: sn.detector, throttled: throttleRef.current.throttled, ai: aiLayers(pipe) };
        })(),
        estimate: view.estimate,
        waiting: view.waiting,
        logo: logoRef.current,
        show: { hud: true, cards: true, players: true, map: true, system: true },
      });
      if (now - lastUi > 250) {
        lastUi = now;
        setTick((x) => x + 1);
      }
      // Autosave the running totals (resume after a crash, a locked phone or a closed tab).
      if (step === "track" && e && mode !== "demo" && now - lastAutosave.current > AUTOSAVE_EVERY_MS) {
        lastAutosave.current = now;
        saveAutosave({
          v: 1,
          savedAt: Date.now(),
          challengeId,
          mode: mode === "camera" ? "camera" : "video",
          lens,
          taps,
          order,
          sound,
          totals: addTotals(carriedRef.current, e.snapshot()),
          videoTime: mode === "video" ? videoRef.current?.currentTime : undefined,
          videoName: mode === "video" ? fileObj.current?.name : undefined,
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (hasVfc) vfv!.cancelVideoFrameCallback?.(vfHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, cam, taps, order, teams, names, finish]);

  useEffect(() => {
    if (step !== "track" || !setup || mode === "demo") return;
    const id = window.setInterval(() => heartbeat("beat"), HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [step, setup, mode, heartbeat]);

  // Keep the screen awake while filming.
  useEffect(() => {
    if (mode !== "camera" || (step !== "track" && step !== "calibrate")) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, [mode, step]);


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
    if (recorderRef.current?.active) return recorderRef.current.stop();
    const canvas = canvasRef.current;
    const mime = pickMime();
    if (!canvas || !mime || !canvas.captureStream) return setError(c.unsupported);
    // Chunks go to the phone's storage as they are made (a whole match in memory crashes Safari).
    const rec = new ChunkRecorder(mime);
    recorderRef.current = rec;
    setRecNote(null);
    void rec.start(canvas.captureStream(30), (blob) => {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      setDownload({ url: URL.createObjectURL(blob), name: `wolf-vision-${stamp}.${mime.startsWith("video/mp4") ? "mp4" : "webm"}` });
      setRecording(false);
      if (rec.stoppedFor) setRecNote(rec.stoppedFor === "limit" ? c.recLimit : c.recStorage);
    });
    setRecording(true);
  };

  const save = async () => {
    if (!summary || !setup) return;
    setSaveState({ kind: "saving" });
    const ids = setup.teams.flatMap((t) => t.players.map((p) => p.id));
    // Engine slots → challenge players (posting pair, then accepting pair).
    const bySlot = (playerIndex: number) => summary.players[order.indexOf(playerIndex)];
    try {
      const res = await fetch("/api/arena/match-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: setup.challengeId,
          mode: mode === "camera" ? "live" : "upload",
          duration: summary.duration,
          rallies: summary.rallies,
          longestRally: summary.longestRally,
          avgRallyShots: summary.avgRallyShots,
          fastestShotKmh: summary.fastestShotKmh,
          players: ids.map((id, j) => ({ playerId: id, hits: bySlot(j).hits, distance: bySlot(j).distance, topSpeed: bySlot(j).topSpeed })),
          auto: {
            quality: summary.quality,
            accepted: summary.breakdown.accepted,
            inferred: summary.breakdown.inferred,
            predicted: summary.breakdown.predicted,
            estimated: summary.estimate.estimated,
            plusMinus: summary.estimate.plusMinus,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; stats?: SavedMatchStats };
      if (!res.ok) return setSaveState({ kind: "error", code: data.error ?? "server" });
      setExisting(data.stats ?? null);
      setSaveState({ kind: "saved" });
    } catch {
      setSaveState({ kind: "error", code: "server" });
    }
  };

  const newSession = () => {
    stopEverything();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
      v.removeAttribute("src");
      v.load();
    }
    pipeRef.current = null;
    srcRef.current = null;
    simRef.current = null;
    setMode(null);
    setStep("start");
    carriedRef.current = null;
    resumeAtRef.current = 0;
    clearAutosave();
    setTaps([]);
    pickTarget(DEFAULT_CORNERS[0]);
    setSummary(null);
    setDownload(null);
    setFixOpen(false);
    setPaused(false);
  };

  // ── Leaving a session ─────────────────────────────────────────────────
  // Past the start screen Wolf Vision takes the whole page (the profile app's
  // top bar and tabs are hidden), so it has its own Exit. Leaving a session
  // that is under way asks first; so do the phone's back gesture and, while
  // it is running or paid for, reloading or closing the tab.
  const inSession = step !== "start";
  const paid = payState === "ready";
  const unsavedChallenge = step === "summary" && Boolean(setup) && mode !== "demo" && saveState.kind !== "saved";
  const running = mode !== "demo" && (step === "calibrate" || step === "track" || unsavedChallenge || (paid && inSession));
  const [exitAsk, setExitAsk] = useState(false);
  useProfileFocus(embedded && inSession);

  const exitSession = () => {
    setExitAsk(false);
    // Leaving mid-match keeps the numbers so far, offered as "Resume match".
    const e = pipeRef.current?.engine;
    const keep: Autosave | null =
      step === "track" && e && mode !== "demo"
        ? {
            v: 1,
            savedAt: Date.now(),
            challengeId,
            mode: mode === "camera" ? "camera" : "video",
            lens,
            taps,
            order,
            sound,
            totals: addTotals(carriedRef.current, e.snapshot()),
            videoTime: mode === "video" ? videoRef.current?.currentTime : undefined,
            videoName: mode === "video" ? fileObj.current?.name : undefined,
          }
        : null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (step === "track") heartbeat("end");
    newSession();
    if (keep) {
      saveAutosave(keep);
      setResumable(keep);
    }
    window.scrollTo(0, 0);
  };
  const askExit = () => (running ? setExitAsk(true) : exitSession());
  const exitRef = useRef({ running, exit: exitSession });
  exitRef.current = { running, exit: exitSession };

  // The back gesture / button: one history entry for the session, so going
  // back returns to the start screen (asking first if the session is under way).
  useEffect(() => {
    if (!inSession) return;
    window.scrollTo(0, 0);
    window.history.pushState({ wvSession: true }, "");
    const onPop = (ev: PopStateEvent) => {
      if ((ev.state as { wvSession?: boolean } | null)?.wvSession) return; // still inside the session
      if (exitRef.current.running) {
        window.history.pushState({ wvSession: true }, "");
        setExitAsk(true);
      } else exitRef.current.exit();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Left with Exit: drop the session's history entry again.
      if ((window.history.state as { wvSession?: boolean } | null)?.wvSession) window.history.back();
    };
  }, [inSession]);

  // Reload / close tab: the browser's own "Leave site?" dialog (the only one a page may show then).
  useEffect(() => {
    if (!running) return;
    const onLeave = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [running]);

  useEffect(() => {
    if (!exitAsk) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExitAsk(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitAsk]);

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
    void tick;
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

  const view = pipeRef.current?.engine.view();
  const elapsed = view?.elapsed ?? 0;
  const banner =
    step === "calibrate"
      ? cam
        ? c.calCheck
        : target
          ? c.calTap(taps.length + 1, describePoint(target, lang))
          : c.calMore
      : step === "track"
        ? notice ?? (fixOpen ? c.fixHint : detectorState === "loading" ? c.model : null)
        : null;
  const blocked = Boolean(challengeId) && !setup;
  const swap = (a: number, b: number) => setOrder((o) => o.map((v, i) => (i === a ? o[b] : i === b ? o[a] : v)));

  return (
    <div className={`${s.page} ${embedded ? (inSession ? s.focus : s.embedded) : ""}`}>
      <header className={s.top}>
        {inSession ? (
          <button type="button" className={s.exitBtn} onClick={askExit} data-testid="wv-exit">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            {c.exit}
          </button>
        ) : null}
        <h1>
          {c.title}
          {isTrial() ? <span className={s.betaBadge} data-testid="beta-badge">{c.beta}</span> : null}
          <small>{c.sub}</small>
        </h1>
        {challengeId && !inSession ? <a href="/profile/arena">{c.back}</a> : null}
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

        {step === "start" ? (
          <>
            {setupError === "signed_out" ? (
              <div className={s.notice}>
                {c.signIn}{" "}
                <a href={`/login?next=${encodeURIComponent(`/profile/wolf-vision?challenge=${challengeId}`)}`} style={{ color: "inherit", fontWeight: 700 }}>
                  {c.signInBtn}
                </a>
              </div>
            ) : setupError ? (
              <div className={s.error}>{setupError === "not_found" ? c.notFound : c.loadFailed}</div>
            ) : null}
            {existing ? <div className={s.notice}>{c.savedBefore(existing.recordedBy.name)}</div> : null}
            {setup ? (
              <section className={s.matchup}>
                {setup.teams.map((team, ti) => (
                  <div className={`${s.team} ${ti === 0 ? s.teamCoral : s.teamTeal}`} key={ti}>
                    <b>{team.name}</b>
                    {team.players.map((p, pi) => (
                      <span key={p.id}>
                        <i className={s.dot} style={{ background: PLAYER_COLORS[ti * 2 + pi], color: PLAYER_COLORS[ti * 2 + pi] }} />
                        {p.name}
                      </span>
                    ))}
                  </div>
                ))}
                <span className={s.vs}>{c.vs}</span>
              </section>
            ) : null}
            {resumable ? (
              <section className={s.card} data-testid="resume-card">
                <h2>{c.resumeTitle}</h2>
                <p>{c.resumeText(Math.max(1, Math.round(resumable.totals.duration / 60)), new Date(resumable.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</p>
                <div className={s.row}>
                  <button className={s.btn} type="button" onClick={resumeMatch} data-testid="resume">
                    {c.resumeMatch}
                  </button>
                  <button className={s.btnGhost} type="button" onClick={discardResume}>
                    {c.discard}
                  </button>
                </div>
              </section>
            ) : null}
            {payState === "trial" ? (
              <section className={s.trial} data-testid="trial-banner">
                <div className={s.trialRibbon}>{c.freeNow}</div>
                <div>
                  <h2>{c.trialTitle}</h2>
                  <p>{c.trialText}</p>
                  <p className={s.trialAfter}>
                    <b>{c.trialDays(trialDaysLeft())}</b> · {c.trialAfter}
                  </p>
                </div>
              </section>
            ) : null}
            <div className={s.modes}>
              <button className={s.mode} type="button" onClick={() => gate("live", () => void chooseCamera())} disabled={blocked || !phone} data-testid="mode-camera">
                <strong>📱 {c.cameraTitle}</strong>
                <small>{phone ? c.cameraSub : c.cameraOnlyPhone}</small>
                {payState === "trial" ? (
                  <span className={s.freeChipRow}>
                    <span className={s.freeChip}>{c.freeNow}</span>
                    <span className={s.freeThen}>{c.trialThen(c.priceLive)}</span>
                  </span>
                ) : (
                  <span className={s.price}>{passes.live ? c.passReady("live") : c.priceLive}</span>
                )}
              </button>
              <button className={s.mode} type="button" onClick={() => gate("upload", () => fileRef.current?.click())} disabled={blocked} data-testid="mode-video">
                <strong>🎞️ {c.videoTitle}</strong>
                <small>{c.videoSub}</small>
                {payState === "trial" ? (
                  <span className={s.freeChipRow}>
                    <span className={s.freeChip}>{c.freeNow}</span>
                    <span className={s.freeThen}>{c.trialThen(c.priceUpload)}</span>
                  </span>
                ) : (
                  <span className={s.price}>{passes.upload ? c.passReady("upload") : c.priceUpload}</span>
                )}
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
                  if (f) chooseVideo(f);
                  ev.target.value = "";
                }}
              />
            </div>
            {paywallFor ? (
              <section className={`${s.card} ${s.paywall}`} data-testid="paywall">
                <span className={s.aiBadge}>✦ {c.aiBadge}</span>
                <h2>{c.payTitle(paywallFor)}</h2>
                <p>{c.payText(paywallFor)}</p>
                <p className={s.muted}>{c.aiLayers}</p>
                {payState === "signed_out" ? (
                  <div className={s.notice}>
                    {c.paySignIn}{" "}
                    <a href={`/login?next=${encodeURIComponent(`/profile/wolf-vision${challengeId ? `?challenge=${challengeId}` : ""}`)}`} style={{ color: "inherit", fontWeight: 700 }}>
                      {c.signInBtn}
                    </a>
                  </div>
                ) : (
                  <div className={s.row}>
                    <button className={s.btn} type="button" disabled={buying || payState === "loading"} onClick={() => void buyPass(paywallFor)} data-testid="buy-pass">
                      {buying ? c.payWorking : c.payBtn(paywallFor)}
                    </button>
                    <button className={s.btnGhost} type="button" onClick={() => setPaywallFor(null)}>
                      {c.cancel}
                    </button>
                    {testMode ? <span className={s.hint}>{c.payTest}</span> : null}
                  </div>
                )}
              </section>
            ) : null}
            <section className={`${s.card} ${s.train}`} data-testid="wv-train">
              <div>
                <h2>✦ {c.trainTitle}</h2>
                <p>{c.trainText}</p>
              </div>
              <a className={s.btn} href="/profile/wolf-vision/label" data-testid="wv-train-link">
                {c.trainBtn} →
              </a>
            </section>
            <section className={`${s.card} ${s.hero}`} data-testid="wv-about">
              <span className={s.aiBadge} data-testid="ai-badge">✦ {c.aiBadge}</span>
              <p>{c.intro}</p>
              <p className={s.muted}>{c.aiLayers}</p>
              <p className={s.muted}>{c.privacy}</p>
            </section>
          </>
        ) : null}

        {step === "setup" ? (
          <section className={s.card}>
            <h2>{c.setupTitle}</h2>
            <div className={s.setupGrid}>
              <div>
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
                <label className={s.check}>
                  <input type="checkbox" checked={shareTraining} onChange={(e) => setShareTraining(e.target.checked)} data-testid="share-training" /> {c.shareTraining}
                </label>
              </div>
              <div>
                <div className={s.label}>{c.positions}</div>
                <div className={s.positions}>
                  <div className={s.posRow}>
                    <span className={s.posSide}>{c.far}</span>
                    {[2, 3].map((slot) => (
                      <span key={slot} className={s.posName} style={{ borderColor: slotColors[slot] }}>
                        <small>{slot === 2 ? c.left : c.right}</small>
                        {slotNames[slot]}
                      </span>
                    ))}
                    <button type="button" className={s.btnGhost} onClick={() => swap(2, 3)}>
                      ⇄ {c.swapPartners}
                    </button>
                  </div>
                  <div className={s.netLine} />
                  <div className={s.posRow}>
                    <span className={s.posSide}>{c.near}</span>
                    {[0, 1].map((slot) => (
                      <span key={slot} className={s.posName} style={{ borderColor: slotColors[slot] }}>
                        <small>{slot === 0 ? c.left : c.right}</small>
                        {slotNames[slot]}
                      </span>
                    ))}
                    <button type="button" className={s.btnGhost} onClick={() => swap(0, 1)}>
                      ⇄ {c.swapPartners}
                    </button>
                  </div>
                  <div className={s.posCam}>📷</div>
                </div>
                <button type="button" className={s.btnGhost} onClick={() => setOrder((o) => [o[2], o[3], o[0], o[1]])}>
                  ⇅ {c.swapEnds}
                </button>
              </div>
            </div>
            <div className={s.row} style={{ justifyContent: "flex-end" }}>
              <button className={s.btn} type="button" onClick={continueSetup}>
                {c.continue}
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
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
          />
          <video ref={videoRef} className={s.hiddenVideo} playsInline muted preload="auto" />
          {banner ? <div className={s.banner}>{banner}</div> : null}
          {step === "calibrate" ? (
            showPicker ? (
              <div className={s.pickerOverlay}>
                {/* Beside the diagram, never on it: a corner of the court sits in each corner of the drawing. */}
                <button type="button" className={s.pickerHide} onClick={() => setShowPicker(false)} aria-label={c.hideDiagram} data-testid="picker-hide">
                  ×
                </button>
                <CourtPicker taps={taps} target={target} onPick={pickTarget} compact />
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
                    pickTarget(DEFAULT_CORNERS[0]);
                  }}
                >
                  {c.reset}
                </button>
                {hasLastCourt ? (
                  <button className={s.btnGhost} type="button" onClick={useLastCourt}>
                    {c.lastCourt}
                  </button>
                ) : null}
                {cam ? <span className={s.hint}>{c.calQuality((cam.rms * 1920) / Math.max(1, videoW), cam.lens.lambda)}</span> : null}
                {suspect ? (
                  <span className={s.warn} role="status" data-testid="cal-suspect">
                    {c.calSuspect(suspect.index + 1, describePoint(taps[suspect.index].court, lang))}
                  </span>
                ) : null}
              </div>
              <button className={s.btn} type="button" disabled={!cam || detectorState === "loading"} onClick={startTracking}>
                {detectorState === "loading" ? c.model : c.start}
              </button>
            </div>
            <section className={s.card}>
              <h2>{c.calTitle}</h2>
              <p>{c.calHelp}</p>
            </section>
          </>
        ) : null}

        {step === "track" ? (
          <>
            <div className={s.toolbar}>
              <div className={s.statusPill}>
                <i />
                {c.tracking} · {formatClock(elapsed).slice(0, 5)}
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
                <button className={s.btn} type="button" onClick={finish}>
                  {c.endGame}
                </button>
              </div>
            </div>
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
            {recNote ? <div className={s.notice}>{recNote}</div> : null}
          </>
        ) : null}

        {step === "summary" && summary ? (
          <section className={s.card}>
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
                        <i className={s.dot} style={{ background: slotColors[i], color: slotColors[i] }} />
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
            {payState === "trial" && mode !== "demo" ? <p className={s.trialNote}>✦ {c.trialSummary}</p> : null}
            {saveState.kind === "saved" ? <div className={s.ok}>{c.saved}</div> : null}
            {saveState.kind === "error" ? <div className={s.error}>{c.saveFailed(saveState.code)}</div> : null}
            {mode === "demo" ? <div className={s.notice}>{c.demoNotSaved}</div> : null}
            <div className={s.row} style={{ marginTop: 12 }}>
              {setup && mode !== "demo" ? (
                <button className={s.btn} type="button" onClick={save} disabled={saveState.kind === "saving"}>
                  {saveState.kind === "saving" ? c.saving : c.save}
                </button>
              ) : null}
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
                onClick={() => (mode === "demo" || saveState.kind === "saved" ? newSession() : setExitAsk(true))}
              >
                {c.newSession}
              </button>
              {setup && saveState.kind === "saved" ? (
                <a className={s.btnGhost} href="/profile/arena" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  {c.back}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>

      {exitAsk ? (
        <div className={s.picker} onClick={() => setExitAsk(false)}>
          <div className={s.pickerSheet} onClick={(ev) => ev.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="wv-exit-title" data-testid="exit-modal">
            <h3 id="wv-exit-title">{c.exitTitle}</h3>
            <p className={s.modalText}>
              {step === "track" ? c.exitTracking : unsavedChallenge ? c.exitUnsaved : step === "summary" ? c.leaveWarn : c.exitSetup}
            </p>
            {paid && mode !== "demo" ? <p className={s.modalText}>{c.exitPaid}</p> : null}
            <div className={s.modalActions}>
              <button className={s.btnGhost} type="button" onClick={() => setExitAsk(false)} autoFocus>
                {c.exitStay}
              </button>
              <button className={s.btnDanger} type="button" onClick={exitSession} data-testid="exit-confirm">
                {c.exitConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
    </div>
  );
}
