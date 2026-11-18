"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { useLanguage } from "@/context/LanguageContext";
import {
  MotionTracker,
  buildTracks,
  computeMotion,
  courtDetections,
  courtHomographyFromTaps,
  type CourtTap,
  detectionAtPoint,
  formatClock,
  groupRallies,
  landmarkId,
  motionAt,
  movementBetween,
  rallyReadout,
  sampleIndexAt,
  summarise,
  trackStep,
  type Anchor,
  type Box,
  type CourtDetection,
  type Hit,
  type MatchSummary,
  type Motion,
  type PlayerMemory,
  type Pt,
  type Sample,
  TAG_MIN_SCORE,
} from "@/lib/match-analyzer";
import type { MatchSetup, SavedMatchStats } from "@/lib/match-stats-db";
import { CourtPicker, DEFAULT_CORNERS, describePoint } from "./CourtPicker";
import { analyseVideo, loadPersonDetector, makeFrameGrabber } from "./detector";
import { PLAYER_COLORS, drawOverlay, type OverlayPlayer } from "./overlay";
import s from "./analyzer.module.css";

type Mode = "live" | "upload";
type Step = "start" | "calibrate" | "analyse" | "work" | "summary";
type Tool = "tag" | "hits";
type Picker = { box: Box; det: CourtDetection; sample: number; t: number };

const PLAYERS = 4;
/** Pause between hits that starts a new rally, in seconds. */
const RALLY_GAP = 4;
/** Longest side of the canvas we draw and record. */
const MAX_CANVAS = 1920;
const COURT_KEY = "tw-match-analyzer-court-v2";

const COPY = {
  en: {
    title: "Match Analyzer",
    back: "Back to the Arena",
    intro: "Film a doubles game from behind a baseline. The AI finds the four players on court, follows them and works out how far and how fast each one moves. A court assistant tags each player once and taps whoever hits the shuttle; the tool does the rest.",
    privacy: "Video stays on this device. Only the final numbers are saved to the challenge.",
    vs: "vs",
    liveTitle: "Live camera",
    liveSub: "Point a phone on a tripod at the court and analyse as you play. Record the screen with the overlay.",
    uploadTitle: "Upload a video",
    uploadSub: "Analyse a recording after the game. Most accurate: hits can be checked frame by frame and you can export the video with the overlay.",
    setupTitle: "Players",
    teamA: "Team A",
    teamB: "Team B",
    player: (n: number) => `Player ${n}`,
    signIn: "Sign in to record stats for this challenge.",
    signInBtn: "Sign in",
    notFound: "This challenge could not be found.",
    loadFailed: "Could not load the challenge. Check your connection and try again.",
    tips: "Best results",
    tip1: "Phone on a tripod or fence, behind a baseline, a little above head height, with all four court corners in view.",
    tip2: "Do not move the phone after setting the court corners.",
    tip3: "Good light, landscape orientation.",
    cameraFailed: "Could not open the camera. Allow camera access in your browser settings and try again.",
    pickFile: "Choose video",
    model: "Loading the AI model (about 7 MB, once)…",
    modelFailed: "The AI model could not load on this device. Try another browser (Chrome or Safari, up to date).",
    calTitle: "Set the court",
    calTap: (n: number, what: string) => `Point ${n}: tap the ${what} on the video.`,
    calMore: "Pick a point on the court diagram below, then tap it on the video.",
    calCheck: "Check the yellow lines sit on the court lines. Drag a point to fine-tune, or add more points for accuracy.",
    calHelp: "Mark at least 4 court points you can see clearly, not all on one line. The 4 outer corners are asked for first; if some are out of shot, pick other points instead (service line corners, the T, net post feet). The camera is at the bottom of the diagram.",
    undo: "Undo",
    reset: "Reset",
    lastCourt: "Use last court setup",
    done: "Done",
    analysing: "Finding the players in every frame…",
    analyseNote: "Keep this tab open. Around 10 frames are checked per second of video.",
    cancel: "Cancel",
    tagTool: "Tag players",
    hitTool: "Count hits",
    tagBanner: (n: number) => (n < PLAYERS ? `Tap each player to tag them (${n}/${PLAYERS} tagged).` : "All four tagged. Tap anyone again to fix a mix-up, then switch to Count hits."),
    hitBanner: "Tap the player who hits the shuttle, or use the buttons.",
    noPlayerHere: "No tagged player there. Tap on a tagged player.",
    noPersonHere: "No person found there. Tap on a player on court.",
    whoIsThis: "Who is this?",
    rallyOver: "Rally over",
    finish: "Finish",
    record: "Record",
    stopRec: "Stop recording",
    recordingSaved: "Recording ready",
    download: "Download video",
    fullscreen: "Full screen",
    exportVideo: "Export video with overlay",
    exporting: "Exporting… let the video play to the end.",
    hits: "Hits",
    summaryTitle: "Match stats",
    duration: "Duration",
    rallies: "Rallies",
    longest: "Longest rally",
    avgRally: "Avg shots / rally",
    fastest: "Fastest shot",
    distance: "Distance",
    topSpeed: "Top speed",
    save: "Save to challenge",
    saving: "Saving…",
    saved: "Saved to the challenge.",
    saveFailed: (code: string) =>
      code === "too_late" ? "Too late to save: stats can be added up to 36 hours after check-in." : code === "not_recordable" ? "This challenge is not being played." : "Could not save. Try again.",
    backToWork: "Back to analysis",
    newSession: "New session",
    savedBefore: (by: string) => `Stats already saved by ${by}. Saving again replaces them.`,
    leaveWarn: "Leave the Match Analyzer? Unsaved stats will be lost.",
    speedNote: "Shot speed is the average from one hitter to the next (a radar would read the peak, which is higher). Distances are measured on the floor.",
    play: "Play",
    pause: "Pause",
    noPlayers: "No players found on court. Check the court corners match the lines.",
    clearTags: "Clear tags",
    unsupported: "This browser cannot record video.",
  },
  vi: {
    title: "Phân Tích Trận Đấu",
    back: "Quay lại Đấu Trường",
    intro: "Quay trận đánh đôi từ phía sau đường biên cuối. AI tìm bốn người chơi trên sân, theo dõi họ và tính quãng đường, tốc độ di chuyển của từng người. Một trợ lý sân gắn tên mỗi người chơi một lần và chạm vào người đánh cầu; công cụ lo phần còn lại.",
    privacy: "Video được giữ trên thiết bị này. Chỉ các con số cuối cùng được lưu vào thách đấu.",
    vs: "vs",
    liveTitle: "Camera trực tiếp",
    liveSub: "Đặt điện thoại trên chân máy hướng vào sân và phân tích khi đang chơi. Quay màn hình kèm lớp thông tin.",
    uploadTitle: "Tải video lên",
    uploadSub: "Phân tích bản quay sau trận. Chính xác nhất: kiểm tra cú đánh từng khung hình và xuất video kèm lớp thông tin.",
    setupTitle: "Người chơi",
    teamA: "Đội A",
    teamB: "Đội B",
    player: (n: number) => `Người chơi ${n}`,
    signIn: "Đăng nhập để ghi thống kê cho thách đấu này.",
    signInBtn: "Đăng nhập",
    notFound: "Không tìm thấy thách đấu này.",
    loadFailed: "Không tải được thách đấu. Kiểm tra kết nối và thử lại.",
    tips: "Để có kết quả tốt nhất",
    tip1: "Đặt điện thoại trên chân máy hoặc hàng rào, phía sau đường biên cuối, cao hơn đầu một chút, thấy đủ bốn góc sân.",
    tip2: "Không di chuyển điện thoại sau khi đặt góc sân.",
    tip3: "Đủ ánh sáng, để ngang màn hình.",
    cameraFailed: "Không mở được camera. Cho phép truy cập camera trong cài đặt trình duyệt và thử lại.",
    pickFile: "Chọn video",
    model: "Đang tải mô hình AI (khoảng 7 MB, chỉ một lần)…",
    modelFailed: "Không tải được mô hình AI trên thiết bị này. Hãy thử trình duyệt khác (Chrome hoặc Safari bản mới).",
    calTitle: "Đặt sân",
    calTap: (n: number, what: string) => `Điểm ${n}: chạm vào ${what} trên video.`,
    calMore: "Chọn một điểm trên sơ đồ sân bên dưới, rồi chạm vào điểm đó trên video.",
    calCheck: "Kiểm tra các đường vàng trùng với vạch sân. Kéo điểm để chỉnh, hoặc thêm điểm để chính xác hơn.",
    calHelp: "Đánh dấu ít nhất 4 điểm trên sân mà bạn thấy rõ, không nằm trên một đường thẳng. Bốn góc ngoài được hỏi trước; nếu góc nào bị khuất, hãy chọn điểm khác (góc vạch giao cầu, chữ T, chân cột lưới). Camera ở phía dưới sơ đồ.",
    undo: "Hoàn tác",
    reset: "Làm lại",
    lastCourt: "Dùng sân lần trước",
    done: "Xong",
    analysing: "Đang tìm người chơi trong từng khung hình…",
    analyseNote: "Giữ tab này mở. Khoảng 10 khung hình được kiểm tra cho mỗi giây video.",
    cancel: "Hủy",
    tagTool: "Gắn tên",
    hitTool: "Đếm cú đánh",
    tagBanner: (n: number) => (n < PLAYERS ? `Chạm vào từng người chơi để gắn tên (${n}/${PLAYERS}).` : "Đã gắn đủ bốn người. Chạm lại ai đó để sửa nhầm lẫn, rồi chuyển sang Đếm cú đánh."),
    hitBanner: "Chạm vào người đánh cầu, hoặc dùng các nút.",
    noPlayerHere: "Không có người chơi đã gắn tên ở đó.",
    noPersonHere: "Không thấy người ở đó. Chạm vào người chơi trên sân.",
    whoIsThis: "Đây là ai?",
    rallyOver: "Hết pha cầu",
    finish: "Kết thúc",
    record: "Quay",
    stopRec: "Dừng quay",
    recordingSaved: "Bản quay đã sẵn sàng",
    download: "Tải video",
    fullscreen: "Toàn màn hình",
    exportVideo: "Xuất video kèm lớp thông tin",
    exporting: "Đang xuất… để video chạy hết.",
    hits: "Cú đánh",
    summaryTitle: "Thống kê trận",
    duration: "Thời lượng",
    rallies: "Pha cầu",
    longest: "Pha dài nhất",
    avgRally: "TB cú / pha",
    fastest: "Cú nhanh nhất",
    distance: "Quãng đường",
    topSpeed: "Tốc độ tối đa",
    save: "Lưu vào thách đấu",
    saving: "Đang lưu…",
    saved: "Đã lưu vào thách đấu.",
    saveFailed: (code: string) =>
      code === "too_late" ? "Quá muộn: chỉ lưu được trong 36 giờ sau khi check-in." : code === "not_recordable" ? "Thách đấu này không đang diễn ra." : "Không lưu được. Thử lại.",
    backToWork: "Quay lại phân tích",
    newSession: "Phiên mới",
    savedBefore: (by: string) => `${by} đã lưu thống kê. Lưu lại sẽ thay thế.`,
    leaveWarn: "Rời trang? Thống kê chưa lưu sẽ mất.",
    speedNote: "Tốc độ cú đánh là trung bình từ người đánh này tới người đánh tiếp theo (radar đo đỉnh, cao hơn). Quãng đường đo trên mặt sân.",
    play: "Phát",
    pause: "Dừng",
    noPlayers: "Không thấy người chơi trên sân. Kiểm tra các góc sân khớp với vạch.",
    clearTags: "Xóa gắn tên",
    unsupported: "Trình duyệt này không quay video được.",
  },
};

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
}

/** Everything the drawing loop and detection loop read, kept out of React state. */
type Engine = {
  mode: Mode | null;
  step: Step;
  tool: Tool;
  taps: CourtTap[];
  H: ReturnType<typeof courtHomographyFromTaps>;
  dragging: number | null;
  loupe: Pt | null;
  names: string[];
  teams: [string, string];
  hits: Hit[];
  breaks: number[];
  flash: { player: number; at: number } | null;
  // Upload
  samples: Sample[];
  times: number[];
  anchors: Anchor[];
  motions: (Motion | null)[];
  trackBoxes: (Box | null)[][];
  // Live
  memory: PlayerMemory[];
  trackers: MotionTracker[];
  frame: { t: number; dets: CourtDetection[]; assign: (number | null)[] } | null;
  t0: number;
  recordingSince: number | null;
};

function newEngine(): Engine {
  return {
    mode: null,
    step: "start",
    tool: "tag",
    taps: [],
    H: null,
    dragging: null,
    loupe: null,
    names: [],
    teams: ["", ""],
    hits: [],
    breaks: [],
    flash: null,
    samples: [],
    times: [],
    anchors: [],
    motions: [null, null, null, null],
    trackBoxes: [[], [], [], []],
    memory: [null, null, null, null],
    trackers: Array.from({ length: PLAYERS }, () => new MotionTracker()),
    frame: null,
    t0: 0,
    recordingSince: null,
  };
}

export function MatchAnalyzer({ challengeId }: { challengeId: number | null }) {
  const { lang, setLang } = useLanguage();
  const c = COPY[lang];

  const [setup, setSetup] = useState<MatchSetup | null>(null);
  const [existing, setExisting] = useState<SavedMatchStats | null>(null);
  const [setupError, setSetupError] = useState<"signed_out" | "not_found" | "failed" | null>(null);
  const [names, setNames] = useState<string[]>(() => [1, 2, 3, 4].map((n) => COPY.en.player(n)));
  const [teams, setTeams] = useState<[string, string]>(["Team A", "Team B"]);

  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>("start");
  const [tool, setTool] = useState<Tool>("tag");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detector, setDetector] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [taps, setTaps] = useState<CourtTap[]>([]);
  /** The court point the next tap on the video will be. */
  const [target, setTarget] = useState<Pt | null>(DEFAULT_CORNERS[0]);
  const [tagged, setTagged] = useState<boolean[]>([false, false, false, false]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [breaks, setBreaks] = useState<number[]>([]);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [recording, setRecording] = useState(false);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; code: string }>({ kind: "idle" });
  const [hasLastCourt, setHasLastCourt] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null);
  const eng = useRef<Engine>(newEngine());
  const calTarget = useRef<Pt | null>(DEFAULT_CORNERS[0]);
  const pickTarget = (p: Pt | null) => {
    calTarget.current = p;
    setTarget(p);
  };

  // ── Challenge set-up ────────────────────────────────────────────────────
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

  useEffect(() => {
    try {
      setHasLastCourt(Boolean(localStorage.getItem(COURT_KEY)));
    } catch {
      /* storage blocked */
    }
  }, []);

  // Mirror React state into the engine the loops read.
  const H = useMemo(() => courtHomographyFromTaps(taps), [taps]);
  const rallies = useMemo(() => groupRallies(hits, RALLY_GAP, breaks), [hits, breaks]);
  useEffect(() => {
    const e = eng.current;
    Object.assign(e, { mode, step, tool, taps, H, names, teams, hits, breaks });
  }, [mode, step, tool, taps, H, names, teams, hits, breaks]);

  // ── Clock ───────────────────────────────────────────────────────────────
  const now = useCallback((): number => {
    const e = eng.current;
    if (e.mode === "upload") return videoRef.current?.currentTime ?? 0;
    return e.t0 ? (performance.now() - e.t0) / 1000 : 0;
  }, []);

  const motionOf = (e: Engine, i: number): Motion | null => (e.mode === "upload" ? e.motions[i] : e.trackers[i].motion);
  const positionAt = useCallback((player: number, t: number): Pt | null => {
    const m = motionOf(eng.current, player);
    return m ? motionAt(m, t)?.p ?? null : null;
  }, []);

  // ── Detector ────────────────────────────────────────────────────────────
  const ensureDetector = useCallback(async () => {
    if (detectorRef.current) return detectorRef.current;
    setDetector("loading");
    try {
      detectorRef.current = await loadPersonDetector();
      setDetector("ready");
      return detectorRef.current;
    } catch (err) {
      console.error("[match-analyzer] detector", err);
      setDetector("failed");
      return null;
    }
  }, []);

  // ── Drawing loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (step === "start" || step === "summary") return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return;
      const e = eng.current;
      // Development only: lets the browser tests find detected players.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __matchAnalyzer?: Engine }).__matchAnalyzer = e;
      const vw = video.videoWidth, vh = video.videoHeight;
      const scale = Math.min(1, MAX_CANVAS / Math.max(vw, vh));
      const cw = Math.round(vw * scale), ch = Math.round(vh * scale);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(video, 0, 0, cw, ch);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      const t = now();
      const working = e.step === "work";
      const players: OverlayPlayer[] = [];
      let untagged: Box[] = [];
      const readout = working ? rallyReadout(groupRallies(e.hits, RALLY_GAP, e.breaks), t, PLAYERS, positionAt) : null;
      if (working && e.H) {
        if (e.mode === "upload") {
          const k = nearestSample(e.times, t);
          if (k >= 0 && e.tool === "tag") {
            const used = new Set(e.trackBoxes.map((b) => b[k]).filter(Boolean));
            untagged = courtDetections(e.samples[k].dets, e.H.toCourt, { w: vw, h: vh })
              .filter((d) => !used.has(d.box) && d.score >= TAG_MIN_SCORE)
              .map((d) => d.box);
          }
        } else if (e.frame && e.tool === "tag") {
          const used = new Set(e.frame.assign.filter((j): j is number => j !== null));
          untagged = e.frame.dets.filter((d, j) => !used.has(j) && d.score >= TAG_MIN_SCORE).map((d) => d.box);
        }
        for (let i = 0; i < PLAYERS; i++) {
          let pos: Pt | null = null;
          let box: Box | null = null;
          if (e.mode === "upload") {
            const m = e.motions[i];
            const at = m ? motionAt(m, t) : null;
            if (at) {
              pos = at.p;
              box = at.box;
            }
          } else if (e.frame) {
            const j = e.frame.assign[i];
            if (j !== null && now() - e.frame.t < 0.5) {
              pos = e.frame.dets[j].p;
              box = e.frame.dets[j].box;
            }
          }
          let distance = 0, topSpeed = 0;
          const m = motionOf(e, i);
          if (readout && m) {
            const mv = movementBetween(m, readout.start, readout.start + readout.time);
            distance = mv.distance;
            topSpeed = mv.topSpeed;
          }
          players.push({
            name: e.names[i] ?? `P${i + 1}`,
            color: PLAYER_COLORS[i],
            team: i < 2 ? 0 : 1,
            pos,
            box,
            hits: readout?.hitsBy[i] ?? 0,
            topSpeed,
            distance,
            tagged: e.mode === "upload" ? e.anchors.some((a) => a.player === i) : e.memory[i] !== null,
          });
        }
      }
      // The team standing on the near half is named on the left of the map.
      const teamY = [0, 1].map((tm) => {
        const ys = players.filter((p) => p.team === tm && p.pos).map((p) => p.pos!.y);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : tm === 0 ? 0 : 13.4;
      });
      const mapTeams: [string, string] = teamY[0] <= teamY[1] ? e.teams : [e.teams[1], e.teams[0]];

      drawOverlay(ctx, vw, vh, {
        toImage: e.H?.toImage ?? null,
        players,
        rally: readout,
        teams: mapTeams,
        untagged,
        calibration: e.step === "calibrate" ? { taps: e.taps.map((q) => q.image), selected: e.dragging ?? undefined } : undefined,
        flash: e.flash ? { player: e.flash.player, age: (performance.now() - e.flash.at) / 1000 } : null,
        recording: e.recordingSince != null ? (performance.now() - e.recordingSince) / 1000 : null,
        show: { hud: working, cards: working, rings: working, tags: working, map: working && Boolean(e.H) },
      });

      // Magnifier while placing a corner.
      if (e.step === "calibrate" && e.loupe) {
        const r = 0.11 * Math.min(vw, vh);
        const zoom = 3;
        const cx = e.loupe.x < vw / 2 ? vw - r - 20 : r + 20;
        const cy = r + 20;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(video, e.loupe.x - r / zoom, e.loupe.y - r / zoom, (2 * r) / zoom, (2 * r) / zoom, cx - r, cy - r, 2 * r, 2 * r);
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy);
        ctx.lineTo(cx + 14, cy);
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx, cy + 14);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#facc15";
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [step, now, positionAt]);

  // ── Live detection loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "live" || step !== "work") return;
    let alive = true;
    const grabber = makeFrameGrabber();
    let last = 0;
    const tick = async () => {
      while (alive) {
        await new Promise((r) => requestAnimationFrame(r));
        const e = eng.current;
        const det = detectorRef.current;
        const video = videoRef.current;
        if (!det || !video || !e.H || video.readyState < 2) continue;
        if (performance.now() - last < 55) continue; // ~15 detections a second at most
        last = performance.now();
        const t = now();
        const dets = courtDetections(grabber.detect(det, video), e.H.toCourt, frameOf(video));
        const assign = trackStep(e.memory, dets, t);
        for (let i = 0; i < PLAYERS; i++) {
          const j = assign[i];
          e.trackers[i].push(t, j !== null ? { p: dets[j].p, box: dets[j].box } : null);
        }
        e.frame = { t, dets, assign };
      }
    };
    tick();
    return () => {
      alive = false;
    };
  }, [mode, step, now]);

  // Keep the screen awake while filming live.
  useEffect(() => {
    if (mode !== "live" || step === "start" || step === "summary") return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, [mode, step]);

  // Warn before leaving with unsaved hits.
  useEffect(() => {
    if (hits.length === 0 || saveState.kind === "saved") return;
    const onLeave = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [hits.length, saveState.kind]);

  // Release the camera and object URLs when leaving the page.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  // Upload transport: follow the video's clock.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || mode !== "upload") return;
    const onTime = () => setTime(v.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [mode]);

  // ── Starting a session ──────────────────────────────────────────────────
  const startLive = async () => {
    setError(null);
    setMode("live");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      v.muted = true;
      await v.play();
      setStep("calibrate");
      ensureDetector();
    } catch (err) {
      console.error("[match-analyzer] camera", err);
      setMode(null);
      setError(c.cameraFailed);
    }
  };

  const startUpload = (file: File) => {
    setError(null);
    setMode("upload");
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const v = videoRef.current!;
    v.srcObject = null;
    v.src = url;
    v.muted = true;
    v.onloadedmetadata = () => {
      setDuration(v.duration);
      v.currentTime = Math.min(1, v.duration / 2);
      setStep("calibrate");
    };
    ensureDetector();
  };

  // ── Canvas taps ─────────────────────────────────────────────────────────
  const toVideo = (ev: React.PointerEvent): { p: Pt; perPx: number } | null => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video?.videoWidth) return null;
    const rect = canvas.getBoundingClientRect();
    // object-fit: contain may letterbox the canvas inside its box.
    const ar = video.videoWidth / video.videoHeight;
    let w = rect.width, h = rect.height, ox = 0, oy = 0;
    if (w / h > ar) {
      w = h * ar;
      ox = (rect.width - w) / 2;
    } else {
      h = w / ar;
      oy = (rect.height - h) / 2;
    }
    const perPx = video.videoWidth / w;
    return { p: { x: (ev.clientX - rect.left - ox) * perPx, y: (ev.clientY - rect.top - oy) * perPx }, perPx };
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const at = toVideo(ev);
    if (!at) return;
    const e = eng.current;
    if (e.step === "calibrate") {
      ev.currentTarget.setPointerCapture(ev.pointerId);
      const near = e.taps.findIndex((q) => Math.hypot(q.image.x - at.p.x, q.image.y - at.p.y) < 40 * at.perPx);
      if (near >= 0) {
        e.dragging = near;
      } else if (calTarget.current) {
        const court = calTarget.current;
        // Tapping a court point again moves it instead of adding a second one.
        const next = [...e.taps.filter((q) => landmarkId(q.court) !== landmarkId(court)), { image: at.p, court }];
        e.taps = next;
        e.dragging = next.length - 1;
        setTaps(next);
        const used = new Set(next.map((q) => landmarkId(q.court)));
        const nextTarget = DEFAULT_CORNERS.find((p) => !used.has(landmarkId(p))) ?? null;
        calTarget.current = nextTarget;
        setTarget(nextTarget);
      }
      e.loupe = at.p;
      return;
    }
    if (e.step !== "work" || !e.H) return;
    if (e.tool === "tag") tagAt(at.p, at.perPx);
    else hitAt(at.p, at.perPx);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const e = eng.current;
    if (e.step !== "calibrate" || e.dragging === null) return;
    const at = toVideo(ev);
    if (!at) return;
    const next = e.taps.map((q, k) => (k === e.dragging ? { ...q, image: at.p } : q));
    e.taps = next;
    e.loupe = at.p;
    setTaps(next);
  };

  const onPointerUp = () => {
    const e = eng.current;
    e.dragging = null;
    e.loupe = null;
  };

  const tagAt = (p: Pt, perPx: number) => {
    const e = eng.current;
    if (e.mode === "upload") {
      const k = nearestSample(e.times, now());
      if (k < 0) return;
      const dets = courtDetections(e.samples[k].dets, e.H!.toCourt, frameOf(videoRef.current));
      const det = detectionAtPoint(dets, p, 12 * perPx);
      if (!det) return flashNotice(c.noPersonHere);
      videoRef.current?.pause();
      setPicker({ box: det.box, det, sample: k, t: e.samples[k].t });
    } else {
      const f = e.frame;
      if (!f) return;
      const det = detectionAtPoint(f.dets, p, 12 * perPx);
      if (!det) return flashNotice(c.noPersonHere);
      setPicker({ box: det.box, det, sample: -1, t: f.t });
    }
  };

  const assignPicked = (player: number) => {
    const e = eng.current;
    const pk = picker;
    setPicker(null);
    if (!pk) return;
    if (e.mode === "upload") {
      const k = pk.sample;
      const owner = e.trackBoxes.findIndex((b) => b[k] === pk.box);
      const anchors = [...e.anchors, { sample: k, player, box: pk.box }];
      // Tagging someone who was followed as another player swaps the two.
      const mine = e.trackBoxes[player][k];
      if (owner >= 0 && owner !== player && mine) anchors.push({ sample: k, player: owner, box: mine });
      e.anchors = anchors;
      rebuildTracks();
    } else {
      const f = e.frame;
      const owner = f ? f.dets.findIndex((d) => d.box === pk.box) : -1;
      const ownerPlayer = f && owner >= 0 ? f.assign.indexOf(owner) : -1;
      const old = e.memory[player];
      e.memory[player] = { p: pk.det.p, t: pk.t, look: pk.det.look };
      if (ownerPlayer >= 0 && ownerPlayer !== player) e.memory[ownerPlayer] = old;
      if (f) {
        const mineJ = f.assign[player];
        f.assign[player] = owner >= 0 ? owner : null;
        if (ownerPlayer >= 0 && ownerPlayer !== player) f.assign[ownerPlayer] = mineJ;
      }
    }
    setTagged((tg) => tg.map((v, i) => (i === player ? true : v)));
  };

  const rebuildTracks = () => {
    const e = eng.current;
    if (!e.H) return;
    const tracks = buildTracks(e.samples, e.H.toCourt, PLAYERS, e.anchors, frameOf(videoRef.current));
    e.trackBoxes = tracks.map((tr) => tr.map((tp) => tp?.box ?? null));
    e.motions = tracks.map((tr, i) => (e.anchors.some((a) => a.player === i) ? computeMotion(e.times, tr) : null));
  };

  const hitAt = (p: Pt, perPx: number) => {
    const e = eng.current;
    const t = now();
    let best = -1, bestD = Infinity;
    for (let i = 0; i < PLAYERS; i++) {
      let box: Box | null = null;
      if (e.mode === "upload") {
        const m = e.motions[i];
        box = m ? motionAt(m, t)?.box ?? null : null;
      } else if (e.frame) {
        const j = e.frame.assign[i];
        box = j !== null ? e.frame.dets[j].box : null;
      }
      if (!box) continue;
      const slack = 30 * perPx;
      const inside = p.x >= box[0] - slack && p.x <= box[0] + box[2] + slack && p.y >= box[1] - slack && p.y <= box[1] + box[3] + slack;
      if (!inside) continue;
      const d = Math.hypot(p.x - (box[0] + box[2] / 2), p.y - (box[1] + box[3] / 2));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return flashNotice(c.noPlayerHere);
    recordHit(best);
  };

  const recordHit = useCallback(
    (player: number) => {
      const t = now();
      setHits((h) => [...h, { t, player }].sort((a, b) => a.t - b.t));
      eng.current.flash = { player, at: performance.now() };
      navigator.vibrate?.(25);
    },
    [now],
  );

  const rallyOver = useCallback(() => {
    const t = now();
    setBreaks((b) => [...b, t].sort((x, y) => x - y));
  }, [now]);

  const undoHit = useCallback(() => {
    setHits((h) => {
      if (h.length === 0) return h;
      // Undo the latest hit at or before now (in upload mode the video may have moved back).
      const t = now();
      let idx = -1;
      h.forEach((x, i) => {
        if (x.t <= t + 0.05) idx = i;
      });
      if (idx < 0) idx = h.length - 1;
      return h.filter((_, i) => i !== idx);
    });
  }, [now]);

  const noticeTimer = useRef<number | null>(null);
  const flashNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200);
  };

  // Keyboard shortcuts on a laptop: 1-4 hits, R rally over, Z undo, Space play.
  useEffect(() => {
    if (step !== "work") return;
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === "INPUT" || picker) return;
      if (ev.key >= "1" && ev.key <= "4") recordHit(Number(ev.key) - 1);
      else if (ev.key === "r" || ev.key === "R") rallyOver();
      else if (ev.key === "z" || ev.key === "Z" || ev.key === "Backspace") undoHit();
      else if (ev.key === " " && mode === "upload") {
        ev.preventDefault();
        const v = videoRef.current;
        if (v?.paused) v.play();
        else v?.pause();
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, mode, picker, recordHit, rallyOver, undoHit]);

  // ── Calibration ─────────────────────────────────────────────────────────
  const finishCalibration = async () => {
    if (!H) return;
    const v = videoRef.current!;
    try {
      localStorage.setItem(COURT_KEY, JSON.stringify({ taps, w: v.videoWidth, h: v.videoHeight }));
    } catch {
      /* storage blocked */
    }
    if (mode === "live") {
      eng.current.t0 = performance.now();
      setStep("work");
      setTool("tag");
      return;
    }
    // Upload: find the players in every frame first.
    const det = await ensureDetector();
    if (!det) return;
    setStep("analyse");
    const ac = new AbortController();
    abortRef.current = ac;
    // 10 checks a second for clips up to 3 minutes, 5 for a whole game.
    const fps = v.duration > 180 ? 5 : 10;
    try {
      const samples = await analyseVideo(urlRef.current!, fps, (p) => setProgress(p), ac.signal);
      const e = eng.current;
      e.samples = samples;
      e.times = samples.map((x) => x.t);
      e.anchors = [];
      rebuildTracks();
      // Jump to the first frame where all four players are on court, ready to tag.
      const toCourt = H.toCourt;
      let best = 0, bestN = -1;
      for (let k = 0; k < samples.length && bestN < PLAYERS; k++) {
        const n = courtDetections(samples[k].dets, toCourt, frameOf(v)).filter((d) => d.score >= TAG_MIN_SCORE).length;
        if (n > bestN) {
          best = k;
          bestN = n;
        }
      }
      if (bestN <= 0) setError(c.noPlayers);
      v.currentTime = samples[best]?.t ?? 0;
      setStep("work");
      setTool("tag");
    } catch (err) {
      console.error("[match-analyzer] analyse", err);
      setError(c.modelFailed);
      setStep("calibrate");
    } finally {
      setProgress(null);
    }
  };

  const useLastCourt = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(COURT_KEY) ?? "null") as { taps: CourtTap[]; w: number; h: number } | null;
      const v = videoRef.current;
      if (!saved?.taps?.[0]?.court || !v?.videoWidth) return;
      const sx = v.videoWidth / saved.w, sy = v.videoHeight / saved.h;
      const next = saved.taps.map((q) => ({ court: q.court, image: { x: q.image.x * sx, y: q.image.y * sy } }));
      eng.current.taps = next;
      setTaps(next);
      calTarget.current = null;
      setTarget(null);
    } catch {
      /* ignore */
    }
  };

  // ── Recording ───────────────────────────────────────────────────────────
  const startRecording = (withAudio: boolean): MediaRecorder | null => {
    const canvas = canvasRef.current;
    const mime = pickMime();
    if (!canvas || !mime || !canvas.captureStream) {
      setError(c.unsupported);
      return null;
    }
    const stream = canvas.captureStream(30);
    if (withAudio && videoRef.current) {
      try {
        if (!audioRef.current) {
          const actx = new AudioContext();
          const src = actx.createMediaElementSource(videoRef.current);
          const dest = actx.createMediaStreamDestination();
          src.connect(dest);
          src.connect(actx.destination);
          audioRef.current = { ctx: actx, dest };
        }
        audioRef.current.dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      } catch {
        /* no audio: video only */
      }
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      if (download) URL.revokeObjectURL(download.url);
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      setDownload({ url: URL.createObjectURL(blob), name: `three-wolves-match-${stamp}.${ext}` });
      eng.current.recordingSince = null;
      setRecording(false);
    };
    rec.start(1000);
    recorderRef.current = rec;
    eng.current.recordingSince = performance.now();
    setRecording(true);
    return rec;
  };

  const toggleLiveRecording = () => {
    if (recorderRef.current && recorderRef.current.state === "recording") recorderRef.current.stop();
    else startRecording(false);
  };

  const exportUpload = async () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
    v.muted = false;
    v.playbackRate = 1;
    setRate(1);
    const rec = startRecording(true);
    if (!rec) return;
    setExporting(true);
    v.addEventListener(
      "ended",
      () => {
        rec.stop();
        v.muted = true;
        setExporting(false);
      },
      { once: true },
    );
    await audioRef.current?.ctx.resume();
    await v.play();
  };

  // ── Finishing ───────────────────────────────────────────────────────────
  const finish = () => {
    const e = eng.current;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    videoRef.current?.pause();
    const end = e.mode === "upload" ? duration : now();
    const motions = Array.from({ length: PLAYERS }, (_, i) => motionOf(e, i) ?? computeMotion([], []));
    setSummary(summarise(motions, hits, rallies, 0, end, positionAt));
    setSaveState({ kind: "idle" });
    setStep("summary");
  };

  const save = async () => {
    if (!summary || !setup) return;
    setSaveState({ kind: "saving" });
    const ids = setup.teams.flatMap((t) => t.players.map((p) => p.id));
    try {
      const res = await fetch("/api/arena/match-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: setup.challengeId,
          mode,
          duration: summary.duration,
          rallies: summary.rallies,
          longestRally: summary.longestRally,
          avgRallyShots: summary.avgRallyShots,
          fastestShotKmh: summary.fastestShotKmh,
          players: summary.players.map((p, i) => ({ playerId: ids[i], hits: p.hits, distance: p.distance, topSpeed: p.topSpeed })),
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
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    abortRef.current?.abort();
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
      v.removeAttribute("src");
      v.load();
    }
    eng.current = newEngine();
    setMode(null);
    setStep("start");
    setTaps([]);
    calTarget.current = DEFAULT_CORNERS[0];
    setTarget(DEFAULT_CORNERS[0]);
    setHits([]);
    setBreaks([]);
    setTagged([false, false, false, false]);
    setSummary(null);
    setDownload(null);
    setError(null);
  };

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const taggedCount = tagged.filter(Boolean).length;
  const banner =
    step === "calibrate"
      ? H
        ? c.calCheck
        : target
          ? c.calTap(taps.length + 1, describePoint(target, lang))
          : c.calMore
      : step === "work"
        ? notice ?? (detector === "loading" ? c.model : tool === "tag" ? c.tagBanner(taggedCount) : c.hitBanner)
        : null;
  const blocked = Boolean(challengeId) && !setup;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className={s.page}>
      <header className={s.top}>
        <h1>{c.title}</h1>
        {challengeId ? <a href="/profile/arena">{c.back}</a> : null}
        <button className={s.langBtn} onClick={() => setLang(lang === "en" ? "vi" : "en")} type="button">
          {lang === "en" ? "VI" : "EN"}
        </button>
      </header>

      <main className={s.body}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}

        {step === "start" ? (
          <>
            <section className={s.card}>
              <p>{c.intro}</p>
              <p>{c.privacy}</p>
              {setupError === "signed_out" ? (
                <div className={s.notice}>
                  {c.signIn}{" "}
                  <a href={`/login?next=${encodeURIComponent(`/match-analyzer?challenge=${challengeId}`)}`} style={{ color: "inherit", fontWeight: 700 }}>
                    {c.signInBtn}
                  </a>
                </div>
              ) : setupError ? (
                <div className={s.error}>{setupError === "not_found" ? c.notFound : c.loadFailed}</div>
              ) : null}
              {existing ? <div className={s.notice}>{c.savedBefore(existing.recordedBy.name)}</div> : null}
            </section>

            <section className={s.card}>
              <h2>{c.setupTitle}</h2>
              {setup ? (
                <div className={s.matchup}>
                  {setup.teams.map((team, ti) => (
                    <div className={s.team} key={ti} style={{ gridColumn: ti === 0 ? 1 : 3 }}>
                      <b>{team.name}</b>
                      {team.players.map((p, pi) => (
                        <span key={p.id}>
                          <i className={s.dot} style={{ background: PLAYER_COLORS[ti * 2 + pi], color: PLAYER_COLORS[ti * 2 + pi] }} />
                          {p.name}
                        </span>
                      ))}
                    </div>
                  ))}
                  <span className={s.vs} style={{ gridColumn: 2, gridRow: 1 }}>
                    {c.vs}
                  </span>
                </div>
              ) : challengeId ? null : (
                <div className={s.names}>
                  {[0, 1].map((ti) => (
                    <div key={ti} className={s.team}>
                      <label className={s.field}>
                        {ti === 0 ? c.teamA : c.teamB}
                        <input value={teams[ti]} maxLength={40} onChange={(ev) => setTeams((tm) => (ti === 0 ? [ev.target.value, tm[1]] : [tm[0], ev.target.value]))} />
                      </label>
                      {[0, 1].map((pi) => {
                        const i = ti * 2 + pi;
                        return (
                          <label key={i} className={s.field} style={{ marginTop: 8 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <i className={s.dot} style={{ background: PLAYER_COLORS[i], color: PLAYER_COLORS[i] }} />
                              {c.player(i + 1)}
                            </span>
                            <input value={names[i]} maxLength={40} onChange={(ev) => setNames((n) => n.map((x, k) => (k === i ? ev.target.value : x)))} />
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className={s.modes}>
              <button className={s.mode} type="button" onClick={startLive} disabled={blocked}>
                <strong>📹 {c.liveTitle}</strong>
                <small>{c.liveSub}</small>
              </button>
              <button className={s.mode} type="button" onClick={() => fileRef.current?.click()} disabled={blocked}>
                <strong>🎞️ {c.uploadTitle}</strong>
                <small>{c.uploadSub}</small>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                hidden
                data-testid="video-file"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  if (f) startUpload(f);
                  ev.target.value = "";
                }}
              />
            </div>

            <section className={s.card}>
              <h2>{c.tips}</h2>
              <ul className={s.steps}>
                <li>{c.tip1}</li>
                <li>{c.tip2}</li>
                <li>{c.tip3}</li>
              </ul>
            </section>
          </>
        ) : null}

        {/* The stage stays mounted from calibration to the end, so the video keeps playing. */}
        <div className={s.stage} ref={stageRef} hidden={step === "start" || step === "summary"}>
          <canvas
            ref={canvasRef}
            data-testid="stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <video ref={videoRef} className={s.hiddenVideo} playsInline muted preload="auto" />
          {banner ? <div className={s.banner}>{banner}</div> : null}
        </div>

        {step === "calibrate" ? (
          <div className={s.toolbar}>
            <div className={s.row}>
              <button
                className={s.btnGhost}
                type="button"
                disabled={taps.length === 0}
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
            </div>
            <button className={s.btn} type="button" disabled={!H || (detector === "loading" && mode === "upload")} onClick={finishCalibration}>
              {c.done}
            </button>
          </div>
        ) : null}

        {step === "calibrate" ? (
          <section className={s.card}>
            <h2>{c.calTitle}</h2>
            <p>{c.calHelp}</p>
            <CourtPicker taps={taps} target={target} onPick={pickTarget} />
          </section>
        ) : null}

        {step === "analyse" ? (
          <section className={s.card}>
            <h2>{c.analysing}</h2>
            <div className={s.progress} role="progressbar" aria-valuenow={progress ? Math.round((progress.done / progress.total) * 100) : 0}>
              <div style={{ width: `${progress ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p style={{ marginTop: 10 }}>
              {progress ? `${progress.done} / ${progress.total}` : c.model} · {c.analyseNote}
            </p>
            <button className={s.btnGhost} type="button" onClick={() => abortRef.current?.abort()}>
              {c.cancel}
            </button>
          </section>
        ) : null}

        {step === "work" ? (
          <>
            {mode === "upload" ? (
              <div className={s.transport}>
                <button
                  className={s.btnGhost}
                  type="button"
                  disabled={exporting}
                  onClick={() => {
                    const v = videoRef.current;
                    if (v?.paused) v.play();
        else v?.pause();
                  }}
                >
                  {playing ? `⏸ ${c.pause}` : `▶ ${c.play}`}
                </button>
                <button className={s.btnGhost} type="button" aria-label="-1 frame" disabled={exporting} onClick={() => videoRef.current && (videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1 / 30))}>
                  ⏮
                </button>
                <button className={s.btnGhost} type="button" aria-label="+1 frame" disabled={exporting} onClick={() => videoRef.current && (videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 1 / 30))}>
                  ⏭
                </button>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={time}
                  disabled={exporting}
                  aria-label="Position"
                  onChange={(ev) => {
                    const v = videoRef.current;
                    if (v) v.currentTime = Number(ev.target.value);
                  }}
                />
                <span className={s.time}>
                  {formatClock(time)} / {formatClock(duration)}
                </span>
                <select
                  className={s.select}
                  value={rate}
                  disabled={exporting}
                  aria-label="Speed"
                  onChange={(ev) => {
                    const r = Number(ev.target.value);
                    setRate(r);
                    if (videoRef.current) videoRef.current.playbackRate = r;
                  }}
                >
                  {[0.25, 0.5, 1].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className={s.toolbar}>
              <div className={s.seg} role="group">
                <button type="button" aria-pressed={tool === "tag"} onClick={() => setTool("tag")}>
                  🏷️ {c.tagTool}
                </button>
                <button type="button" aria-pressed={tool === "hits"} onClick={() => setTool("hits")}>
                  🏸 {c.hitTool}
                </button>
              </div>
              <div className={s.row}>
                <button className={s.btnGhost} type="button" onClick={rallyOver}>
                  {c.rallyOver}
                </button>
                <button className={s.btnGhost} type="button" onClick={undoHit} disabled={hits.length === 0}>
                  ↶ {c.undo}
                </button>
                {mode === "live" ? (
                  <button className={recording ? s.btnDanger : s.btnGhost} type="button" onClick={toggleLiveRecording}>
                    {recording ? `⏹ ${c.stopRec}` : `⏺ ${c.record}`}
                  </button>
                ) : (
                  <button className={s.btnGhost} type="button" onClick={exportUpload} disabled={exporting}>
                    {exporting ? c.exporting : c.exportVideo}
                  </button>
                )}
                <button className={s.btnGhost} type="button" onClick={toggleFullscreen}>
                  ⛶ {c.fullscreen}
                </button>
                <button className={s.btn} type="button" onClick={finish} disabled={exporting}>
                  {c.finish}
                </button>
              </div>
            </div>

            <div className={s.hitPad}>
              {names.map((n, i) => (
                <button key={i} type="button" className={s.hitBtn} style={{ ["--c" as string]: PLAYER_COLORS[i] }} onClick={() => recordHit(i)} data-testid={`hit-${i}`}>
                  {n}
                  <small>
                    {hits.filter((h) => h.player === i).length} {c.hits.toLowerCase()} · {i + 1}
                  </small>
                </button>
              ))}
            </div>

            {mode === "upload" && hits.length ? (
              <ul className={s.hits} aria-label={c.hits}>
                {hits.map((h, k) => (
                  <li key={`${h.t}-${k}`} style={{ ["--c" as string]: PLAYER_COLORS[h.player] }}>
                    <a
                      href="#"
                      style={{ color: "inherit" }}
                      onClick={(ev) => {
                        ev.preventDefault();
                        if (videoRef.current) videoRef.current.currentTime = h.t;
                      }}
                    >
                      {formatClock(h.t)} {names[h.player]}
                    </a>
                    <button type="button" aria-label="Remove" onClick={() => setHits((hs) => hs.filter((_, j) => j !== k))}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {tool === "tag" && taggedCount > 0 ? (
              <div className={s.row}>
                <button
                  className={s.btnGhost}
                  type="button"
                  onClick={() => {
                    const e = eng.current;
                    e.anchors = [];
                    e.memory = [null, null, null, null];
                    if (e.mode === "upload") rebuildTracks();
                    setTagged([false, false, false, false]);
                  }}
                >
                  {c.clearTags}
                </button>
              </div>
            ) : null}

            {download ? (
              <div className={s.ok}>
                {c.recordingSaved}:{" "}
                <a href={download.url} download={download.name} style={{ color: "inherit", fontWeight: 700 }}>
                  {c.download}
                </a>
              </div>
            ) : null}
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
                        <i className={s.dot} style={{ background: PLAYER_COLORS[i], color: PLAYER_COLORS[i] }} />
                        {names[i]}
                      </span>
                    </td>
                    <td>{p.hits}</td>
                    <td>{p.distance.toFixed(1)} m</td>
                    <td>{p.topSpeed.toFixed(1)} m/s</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 12, fontSize: "0.8rem" }}>{c.speedNote}</p>
            {saveState.kind === "saved" ? <div className={s.ok}>{c.saved}</div> : null}
            {saveState.kind === "error" ? <div className={s.error}>{c.saveFailed(saveState.code)}</div> : null}
            <div className={s.row} style={{ marginTop: 12 }}>
              {setup ? (
                <button className={s.btn} type="button" onClick={save} disabled={saveState.kind === "saving"}>
                  {saveState.kind === "saving" ? c.saving : c.save}
                </button>
              ) : null}
              {download ? (
                <a className={s.btnGhost} href={download.url} download={download.name} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  {c.download}
                </a>
              ) : null}
              <button className={s.btnGhost} type="button" onClick={() => setStep("work")}>
                {c.backToWork}
              </button>
              <button
                className={s.btnGhost}
                type="button"
                onClick={() => {
                  if (saveState.kind === "saved" || hits.length === 0 || window.confirm(c.leaveWarn)) newSession();
                }}
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

      {picker ? (
        <div className={s.picker} onClick={() => setPicker(null)}>
          <div className={s.pickerSheet} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label={c.whoIsThis}>
            <h3>{c.whoIsThis}</h3>
            <div className={s.pickerGrid}>
              {names.map((n, i) => (
                <button key={i} type="button" className={s.hitBtn} style={{ ["--c" as string]: PLAYER_COLORS[i] }} onClick={() => assignPicked(i)}>
                  {n}
                  <small>{i < 2 ? teams[0] : teams[1]}</small>
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

function frameOf(video: HTMLVideoElement | null | undefined) {
  return video?.videoWidth ? { w: video.videoWidth, h: video.videoHeight } : undefined;
}

/** Index of the analysed frame closest to t (-1 when there are none). */
function nearestSample(times: number[], t: number): number {
  if (times.length === 0) return -1;
  const k = sampleIndexAt(times, t);
  if (k < 0) return 0;
  if (k + 1 < times.length && times[k + 1] - t < t - times[k]) return k + 1;
  return k;
}
