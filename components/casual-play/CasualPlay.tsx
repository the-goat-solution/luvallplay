"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { ModalShell } from "@/components/modals/ModalShell";
import type { Lang } from "@/lib/i18n";
import {
  MAX_COURTS,
  MAX_GUEST_NAME,
  MIN_COURTS,
  onCourtIds,
  queueOrder,
  type Action,
  type CasualPlayResponse,
  type CasualPlayState,
  type Game,
  type Player,
  type Tier,
} from "@/lib/casual-play";

const VIEWER_POLL_MS = 5_000;
const ORGANISER_POLL_MS = 8_000;
const PASSWORD_KEY = "cp-organiser-password";

const COPY = {
  en: {
    eyebrow: "Casual Play",
    title: "Court Board",
    organiser: "Organiser",
    organiserOn: "Organiser mode",
    exitOrganiser: "Exit",
    tabSetup: "Players & Tiers",
    tabCourts: "Courts",
    playDay: "Play day",
    courtsInUse: "Courts in use",
    tier1: "Tier 1",
    tier2: "Tier 2",
    out: "Not playing",
    outHint: "Not here today, or sitting out. Drag them into a tier when they arrive.",
    dragHint: "Drag players between the boxes. On a phone, press and hold a name, or tap a name and then tap “Move here”.",
    moveHere: "Move here",
    emptyZone: "Drop players here",
    addGuest: "Add a walk-in",
    guestName: "Name",
    add: "Add",
    guest: "Guest",
    remove: "Remove",
    rename: "Rename",
    renamePrompt: "Name shown on the board",
    balanced: (n: number) => `${n} vs ${n}: perfectly balanced.`,
    unbalanced: (t1: number, t2: number) =>
      `Tier 1 has ${t1}, tier 2 has ${t2}. Everyone still gets games; the bigger tier just waits a little longer between them.`,
    start: "Start courts",
    needPlayers: "Put at least 4 players into the tiers to start.",
    started: "Courts are live. Changes here apply to the next games.",
    court: "Court",
    upNext: "Up next",
    getReady: "Get ready: you're on the next free court",
    waiting: "Waiting",
    resting: "On a break",
    finish: "Game finished",
    confirmFinish: "Tap again to confirm",
    callOff: "Call off",
    callOffConfirm: "Tap again to call off",
    shuffle: "Shuffle up next",
    fullscreen: "Full screen",
    exitFullscreen: "Exit full screen",
    endSession: "End session",
    endTitle: "End this session?",
    endBody: "All courts are cleared and everyone's game count goes back to zero. Tiers are kept.",
    endConfirm: "End session",
    emptyCourt: "Waiting for players",
    notStarted: "Courts appear here as soon as the organiser starts the session.",
    playersToday: "Players today",
    gamesShort: (n: number) => `${n} ${n === 1 ? "game" : "games"}`,
    minutes: (n: number) => `${n} min`,
    takeBreak: "Break",
    backIn: "Back in",
    unlockTitle: "Organiser access",
    unlockBody: "Enter the organiser password to set up tiers and run the courts. Admins who are logged in don't need it.",
    password: "Password",
    wrongPassword: "Incorrect password.",
    unlock: "Unlock",
    cancel: "Cancel",
    loadError: "Couldn't load the court board. Check your connection and try again.",
    retry: "Try again",
    noPlayDay: "No play day is scheduled yet.",
    errGeneric: "Something went wrong. Please try again.",
    live: "Live",
    howTitle: "How the rotation works",
    how: [
      "Every team is one tier 1 player with one tier 2 player.",
      "When a court finishes, the next game goes straight onto it: no waiting for other courts.",
      "Whoever has played the fewest games goes on first; ties go to whoever has waited longest.",
      "Partners and opponents are mixed up, so you rarely play with the same person twice.",
    ],
    vs: "vs",
    onCourt: (n: number) => `on court ${n}`,
  },
  vi: {
    eyebrow: "Chơi Tự Do",
    title: "Bảng Sân",
    organiser: "Ban tổ chức",
    organiserOn: "Chế độ BTC",
    exitOrganiser: "Thoát",
    tabSetup: "Người chơi & Nhóm",
    tabCourts: "Sân",
    playDay: "Ngày chơi",
    courtsInUse: "Số sân",
    tier1: "Nhóm 1",
    tier2: "Nhóm 2",
    out: "Không chơi",
    outHint: "Chưa đến hoặc nghỉ hôm nay. Kéo vào một nhóm khi họ đến.",
    dragHint: "Kéo người chơi giữa các ô. Trên điện thoại, nhấn giữ tên, hoặc chạm tên rồi chạm “Chuyển vào đây”.",
    moveHere: "Chuyển vào đây",
    emptyZone: "Thả người chơi vào đây",
    addGuest: "Thêm khách",
    guestName: "Tên",
    add: "Thêm",
    guest: "Khách",
    remove: "Xoá",
    rename: "Đổi tên",
    renamePrompt: "Tên hiển thị trên bảng",
    balanced: (n: number) => `${n} vs ${n}: cân bằng hoàn hảo.`,
    unbalanced: (t1: number, t2: number) =>
      `Nhóm 1 có ${t1}, nhóm 2 có ${t2}. Mọi người vẫn được chơi; nhóm đông hơn sẽ chờ lâu hơn một chút.`,
    start: "Bắt đầu",
    needPlayers: "Cần ít nhất 4 người trong các nhóm để bắt đầu.",
    started: "Các sân đang chạy. Thay đổi ở đây áp dụng cho các trận tiếp theo.",
    court: "Sân",
    upNext: "Trận tiếp theo",
    getReady: "Chuẩn bị: bạn vào sân trống tiếp theo",
    waiting: "Đang chờ",
    resting: "Đang nghỉ",
    finish: "Xong trận",
    confirmFinish: "Chạm lần nữa để xác nhận",
    callOff: "Huỷ trận",
    callOffConfirm: "Chạm lần nữa để huỷ",
    shuffle: "Đổi trận tiếp theo",
    fullscreen: "Toàn màn hình",
    exitFullscreen: "Thoát toàn màn hình",
    endSession: "Kết thúc buổi",
    endTitle: "Kết thúc buổi chơi?",
    endBody: "Tất cả sân được xoá và số trận của mọi người về 0. Nhóm vẫn được giữ.",
    endConfirm: "Kết thúc",
    emptyCourt: "Đang chờ người chơi",
    notStarted: "Các sân sẽ hiện ở đây ngay khi BTC bắt đầu buổi chơi.",
    playersToday: "Người chơi hôm nay",
    gamesShort: (n: number) => `${n} trận`,
    minutes: (n: number) => `${n} phút`,
    takeBreak: "Nghỉ",
    backIn: "Vào lại",
    unlockTitle: "Quyền ban tổ chức",
    unlockBody: "Nhập mật khẩu BTC để xếp nhóm và điều hành sân. Admin đã đăng nhập thì không cần.",
    password: "Mật khẩu",
    wrongPassword: "Sai mật khẩu.",
    unlock: "Mở khoá",
    cancel: "Huỷ",
    loadError: "Không tải được bảng sân. Kiểm tra kết nối và thử lại.",
    retry: "Thử lại",
    noPlayDay: "Chưa có ngày chơi nào.",
    errGeneric: "Đã xảy ra lỗi. Vui lòng thử lại.",
    live: "Trực tiếp",
    howTitle: "Cách xoay vòng",
    how: [
      "Mỗi đội gồm một người nhóm 1 và một người nhóm 2.",
      "Sân nào xong là trận tiếp theo vào ngay, không cần chờ các sân khác.",
      "Ai chơi ít trận nhất được vào trước; bằng nhau thì ai chờ lâu hơn vào trước.",
      "Đồng đội và đối thủ được xáo trộn để hiếm khi chơi cùng một người hai lần.",
    ],
    vs: "vs",
    onCourt: (n: number) => `đang ở sân ${n}`,
  },
} satisfies Record<Lang, Record<string, unknown>>;

type Copy = (typeof COPY)[Lang];
type Zone = "1" | "2" | "out";

const zoneTier = (z: Zone): Tier | null => (z === "1" ? 1 : z === "2" ? 2 : null);
const playerZone = (p: Player): Zone => (p.tier === 1 ? "1" : p.tier === 2 ? "2" : "out");

function readPassword(): string | null {
  try {
    return sessionStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

function writePassword(value: string | null) {
  try {
    if (value) sessionStorage.setItem(PASSWORD_KEY, value);
    else sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    // Private mode: organiser mode just won't survive a reload.
  }
}

function formatPlayDay(date: string, lang: Lang) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, d));
}

export function CasualPlay() {
  const { lang, setLang } = useLanguage();
  const c = COPY[lang];
  const [data, setData] = useState<CasualPlayResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "none" | "ok">("loading");
  const [date, setDate] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [tab, setTab] = useState<"setup" | "courts" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [clockSkew, setClockSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const dragging = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPassword(readPassword()), []);

  const headers = useCallback(
    (pw: string | null = password): HeadersInit => ({
      "Content-Type": "application/json",
      ...(pw ? { "x-organiser-password": pw } : {}),
    }),
    [password],
  );

  const accept = useCallback((body: CasualPlayResponse) => {
    setData(body);
    setDate(body.state.date);
    setClockSkew(body.serverNow - Date.now());
    setLoadState("ok");
  }, []);

  const load = useCallback(
    async (pw: string | null = password): Promise<number> => {
      try {
        const qs = date ? `?date=${encodeURIComponent(date)}` : "";
        const res = await fetch(`/api/casual-play${qs}`, { cache: "no-store", headers: headers(pw) });
        if (res.status === 401) return 401;
        if (res.status === 404) {
          setLoadState("none");
          return 404;
        }
        if (!res.ok) throw new Error(String(res.status));
        accept((await res.json()) as CasualPlayResponse);
        return 200;
      } catch {
        setLoadState((s) => (s === "ok" ? s : "error"));
        return 0;
      }
    },
    [date, headers, password, accept],
  );

  // A stale saved password (changed on the server) quietly drops back to viewer mode.
  useEffect(() => {
    load().then((status) => {
      if (status === 401) {
        writePassword(null);
        setPassword(null);
      }
    });
  }, [load]);

  const organiser = data?.organiser ?? false;

  useEffect(() => {
    const every = organiser ? ORGANISER_POLL_MS : VIEWER_POLL_MS;
    const poll = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && !dragging.current) load();
    }, every);
    const tick = window.setInterval(() => setNow(Date.now()), 20_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, organiser]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const state = data?.state ?? null;
  const activeTab = tab ?? (state?.started ? "courts" : "setup");

  const act = async (action: Action): Promise<boolean> => {
    if (!state) return false;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/casual-play", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ date: state.date, action }),
      });
      const body = (await res.json().catch(() => null)) as (CasualPlayResponse & { error?: string }) | null;
      if (res.status === 401) {
        writePassword(null);
        setPassword(null);
        setNotice(c.wrongPassword);
        return false;
      }
      if (body && "state" in body) accept(body);
      if (!res.ok) {
        setNotice(body?.error ?? c.errGeneric);
        return false;
      }
      return true;
    } catch {
      setNotice(c.errGeneric);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setLanguage = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l;
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else pageRef.current?.requestFullscreen?.().catch(() => {});
  };

  const exitOrganiser = () => {
    writePassword(null);
    setPassword(null);
    setTab(null);
    load(null);
  };

  const names = useMemo(() => new Map(state?.players.map((p) => [p.id, p]) ?? []), [state?.players]);
  const serverNow = now + clockSkew;

  return (
    <div className={`cp-page${fullscreen ? " cp-fullscreen" : ""}`} ref={pageRef}>
      <header className="cp-hero">
        <div className="mg-hero-bg" />
        <div className="mg-hero-overlay" />
        <div className="container cp-topbar">
          <div className="cp-brand">
            <img src="/uploads/Three wolves logo transparent.svg" alt="Three Wolves" className="cp-logo" />
            <div>
              <div className="cp-eyebrow">{c.eyebrow}</div>
              <h1 className="cp-title">{c.title}</h1>
            </div>
          </div>
          <div className="cp-top-actions">
            {state?.started && (
              <span className="cp-live">
                <span className="cp-live-dot" />
                {c.live}
              </span>
            )}
            <div className="lang-toggle">
              <button type="button" className={`lang-btn${lang === "en" ? " active" : ""}`} onClick={() => setLanguage("en")}>
                EN
              </button>
              <button type="button" className={`lang-btn${lang === "vi" ? " active" : ""}`} onClick={() => setLanguage("vi")}>
                VI
              </button>
            </div>
          </div>
        </div>
        {state && (
          <div className="container cp-dayline">
            <div>
              <div className="cp-day">{formatPlayDay(state.date, lang)}</div>
              {data?.session && (data.session.time || data.session.location) && (
                <div className="cp-day-meta">
                  {[data.session.time, data.session.location].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
            <div className="cp-day-actions">
              {organiser ? (
                <span className="cp-organiser-badge">
                  <KeyIcon />
                  {c.organiserOn}
                  <button type="button" onClick={exitOrganiser}>
                    {c.exitOrganiser}
                  </button>
                </span>
              ) : (
                <button type="button" className="cp-ghost-btn" onClick={() => setUnlockOpen(true)}>
                  <KeyIcon />
                  {c.organiser}
                </button>
              )}
              <button type="button" className="cp-ghost-btn cp-hide-mobile" onClick={toggleFullscreen}>
                <ExpandIcon />
                {fullscreen ? c.exitFullscreen : c.fullscreen}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="cp-main">
        <div className="container">
          {notice && (
            <div className="mg-notice" role="status">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label={c.cancel}>
                ×
              </button>
            </div>
          )}

          {loadState === "loading" && <div className="mg-loading" aria-hidden="true" />}
          {loadState === "error" && (
            <div className="mg-card mg-error">
              <p>{c.loadError}</p>
              <button type="button" className="btn btn-navy mg-btn-sm" onClick={() => load()}>
                {c.retry}
              </button>
            </div>
          )}
          {loadState === "none" && (
            <div className="mg-card mg-error">
              <p>{c.noPlayDay}</p>
            </div>
          )}

          {loadState === "ok" && state && (
            <>
              {organiser && (
                <div className="cp-toolbar">
                  <div className="cp-tabs" role="tablist">
                    {(["setup", "courts"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === t}
                        className={`cp-tab${activeTab === t ? " active" : ""}`}
                        onClick={() => setTab(t)}
                      >
                        {t === "setup" ? c.tabSetup : c.tabCourts}
                      </button>
                    ))}
                  </div>
                  {data && data.dates.length > 1 && (
                    <label className="cp-date-select">
                      <span>{c.playDay}</span>
                      <select
                        value={state.date}
                        onChange={(e) => {
                          setTab(null);
                          setDate(e.target.value);
                        }}
                      >
                        {data.dates.map((d) => (
                          <option key={d} value={d}>
                            {formatPlayDay(d, lang)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {organiser && activeTab === "setup" ? (
                <SetupPanel
                  state={state}
                  copy={c}
                  busy={busy}
                  onAction={act}
                  onDragChange={(d) => (dragging.current = d)}
                  onStarted={() => setTab("courts")}
                />
              ) : (
                <CourtsPanel
                  state={state}
                  names={names}
                  copy={c}
                  organiser={organiser}
                  busy={busy}
                  serverNow={serverNow}
                  onAction={act}
                  onEnd={() => setEndOpen(true)}
                />
              )}
            </>
          )}
        </div>
      </main>

      <footer className="mg-footer">
        <div className="container">
          <span>Three Wolves Badminton Club</span>
        </div>
      </footer>

      <UnlockModal
        open={unlockOpen}
        copy={c}
        onClose={() => setUnlockOpen(false)}
        onUnlock={async (pw) => {
          const status = await load(pw);
          if (status === 401) return false;
          writePassword(pw);
          setPassword(pw);
          setUnlockOpen(false);
          return true;
        }}
      />

      <ModalShell
        id="cp-end-modal"
        open={endOpen}
        onClose={() => setEndOpen(false)}
        title={c.endTitle}
        footer={
          <>
            <button type="button" className="btn btn-bronze-outline" onClick={() => setEndOpen(false)}>
              {c.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary mg-btn-grow"
              disabled={busy}
              onClick={async () => {
                if (await act({ type: "endSession" })) {
                  setEndOpen(false);
                  setTab("setup");
                }
              }}
            >
              {c.endConfirm}
            </button>
          </>
        }
      >
        <p className="mg-modal-text">{c.endBody}</p>
      </ModalShell>
    </div>
  );
}

/* ── Setup: tiers ─────────────────────────────────────── */

function SetupPanel({
  state,
  copy: c,
  busy,
  onAction,
  onDragChange,
  onStarted,
}: {
  state: CasualPlayState;
  copy: Copy;
  busy: boolean;
  onAction: (a: Action) => Promise<boolean>;
  onDragChange: (dragging: boolean) => void;
  onStarted: () => void;
}) {
  const [guestName, setGuestName] = useState("");
  const [guestTier, setGuestTier] = useState<Zone>("2");
  // Optimistic placement while a move is in flight, so a dropped chip
  // doesn't jump back for a moment.
  const [pendingMoves, setPendingMoves] = useState<Record<string, Zone>>({});

  const players = state.players.map((p) =>
    pendingMoves[p.id] ? { ...p, tier: zoneTier(pendingMoves[p.id]) } : p,
  );
  const t1 = players.filter((p) => p.tier === 1).length;
  const t2 = players.filter((p) => p.tier === 2).length;
  const busyIds = onCourtIds(state);

  const move = async (id: string, zone: Zone) => {
    const p = state.players.find((x) => x.id === id);
    if (!p || playerZone(p) === zone) return;
    setPendingMoves((m) => ({ ...m, [id]: zone }));
    await onAction({ type: "setTier", playerId: id, tier: zoneTier(zone) });
    setPendingMoves((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  };

  const addGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = guestName.trim();
    if (!name) return;
    if (await onAction({ type: "addGuest", name, tier: zoneTier(guestTier) })) setGuestName("");
  };

  const rename = (p: Player) => {
    const name = window.prompt(c.renamePrompt, p.name)?.trim();
    if (name && name !== p.name) onAction({ type: "rename", playerId: p.id, name });
  };

  return (
    <section className="cp-setup">
      <div className="cp-setup-head">
        <div className="mg-card cp-courts-card">
          <div className="section-label">{c.courtsInUse}</div>
          <div className="cp-stepper">
            <button
              type="button"
              aria-label="−"
              disabled={busy || state.courts <= MIN_COURTS}
              onClick={() => onAction({ type: "setCourts", courts: state.courts - 1 })}
            >
              −
            </button>
            <span className="cp-stepper-value">{state.courts}</span>
            <button
              type="button"
              aria-label="+"
              disabled={busy || state.courts >= MAX_COURTS}
              onClick={() => onAction({ type: "setCourts", courts: state.courts + 1 })}
            >
              +
            </button>
          </div>
        </div>
        <div className="mg-card cp-start-card">
          <p className={`cp-balance${t1 === t2 ? " ok" : ""}`}>
            {t1 + t2 < 4 ? c.needPlayers : t1 === t2 ? c.balanced(t1) : c.unbalanced(t1, t2)}
          </p>
          {state.started ? (
            <p className="cp-started-note">{c.started}</p>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-full cp-start-btn"
              disabled={busy || t1 + t2 < 4}
              onClick={async () => {
                if (await onAction({ type: "start" })) onStarted();
              }}
            >
              <PlayIcon />
              {c.start}
            </button>
          )}
        </div>
      </div>

      <p className="cp-hint">{c.dragHint}</p>

      <TierBoard
        players={players}
        busyIds={busyIds}
        started={state.started}
        copy={c}
        onMove={move}
        onRename={rename}
        onRemoveGuest={(id) => onAction({ type: "removeGuest", playerId: id })}
        onDragChange={onDragChange}
      />

      <form className="mg-card cp-guest" onSubmit={addGuest}>
        <div className="section-label">{c.addGuest}</div>
        <div className="cp-guest-row">
          <input
            type="text"
            value={guestName}
            maxLength={MAX_GUEST_NAME}
            placeholder={c.guestName}
            aria-label={c.guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
          <select value={guestTier} onChange={(e) => setGuestTier(e.target.value as Zone)} aria-label={c.tier1}>
            <option value="1">{c.tier1}</option>
            <option value="2">{c.tier2}</option>
            <option value="out">{c.out}</option>
          </select>
          <button type="submit" className="btn btn-navy mg-btn-sm" disabled={busy || !guestName.trim()}>
            {c.add}
          </button>
        </div>
      </form>

      <details className="cp-how">
        <summary>{c.howTitle}</summary>
        <ol className="mg-how-list">
          {c.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}

type DragState = { id: string; x: number; y: number; over: Zone | null };

function zoneAt(x: number, y: number): Zone | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-zone]");
  return (el?.dataset.zone as Zone | undefined) ?? null;
}

/**
 * Three drop zones with pointer-based dragging, so it behaves the same with
 * a mouse and on a phone (HTML5 drag and drop doesn't fire for touch). On
 * touch a drag starts after a short press, so the list still scrolls
 * normally; a quick tap selects a player for the "Move here" buttons.
 */
function TierBoard({
  players,
  busyIds,
  started,
  copy: c,
  onMove,
  onRename,
  onRemoveGuest,
  onDragChange,
}: {
  players: Player[];
  busyIds: Set<string>;
  started: boolean;
  copy: Copy;
  onMove: (id: string, zone: Zone) => void;
  onRename: (p: Player) => void;
  onRemoveGuest: (id: string) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const startPointer = (e: React.PointerEvent, player: Player) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const touch = e.pointerType !== "mouse";
    const origin = { x: e.clientX, y: e.clientY };
    let last = origin;
    let active = false;
    let cancelled = false;

    const begin = () => {
      active = true;
      onDragChange(true);
      setSelected(null);
      setDrag({ id: player.id, x: last.x, y: last.y, over: zoneAt(last.x, last.y) });
      navigator.vibrate?.(12);
    };
    const timer = touch ? window.setTimeout(begin, 220) : undefined;

    const onMovePointer = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        const dist = Math.hypot(last.x - origin.x, last.y - origin.y);
        if (dist > 8) {
          if (touch) {
            cancelled = true; // the finger is scrolling, not dragging
            cleanup();
          } else begin();
        }
        return;
      }
      setDrag({ id: player.id, x: last.x, y: last.y, over: zoneAt(last.x, last.y) });
    };
    const onUp = () => {
      const wasActive = active;
      cleanup();
      if (wasActive) {
        const zone = zoneAt(last.x, last.y);
        if (zone) onMove(player.id, zone);
      } else if (!cancelled) {
        setSelected((s) => (s === player.id ? null : player.id));
      }
    };
    const onCancel = () => cleanup();
    const blockScroll = (ev: TouchEvent) => {
      if (active) ev.preventDefault();
    };
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMovePointer);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", blockScroll);
      cleanupRef.current = null;
      if (active) {
        active = false;
        onDragChange(false);
        setDrag(null);
      }
    }
    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMovePointer);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", blockScroll, { passive: false });
  };

  const zones: { zone: Zone; title: string; hint?: string }[] = [
    { zone: "1", title: c.tier1 },
    { zone: "2", title: c.tier2 },
    { zone: "out", title: c.out, hint: c.outHint },
  ];
  const selectedPlayer = players.find((p) => p.id === selected) ?? null;
  const dragged = drag ? players.find((p) => p.id === drag.id) : null;

  return (
    <>
      <div className={`cp-tiers${drag ? " cp-dragging" : ""}`}>
        {zones.map(({ zone, title, hint }) => {
          const list = players
            .filter((p) => playerZone(p) === zone)
            .sort((a, b) => a.name.localeCompare(b.name, "vi"));
          const canDropSelected = selectedPlayer && playerZone(selectedPlayer) !== zone;
          return (
            <div
              key={zone}
              data-zone={zone}
              className={`cp-zone cp-zone-${zone}${drag?.over === zone ? " cp-zone-over" : ""}`}
            >
              <div className="cp-zone-head">
                <span className="cp-zone-title">{title}</span>
                <span className="cp-zone-count">{list.length}</span>
                {canDropSelected && (
                  <button
                    type="button"
                    className="cp-move-here"
                    onClick={() => {
                      onMove(selectedPlayer.id, zone);
                      setSelected(null);
                    }}
                  >
                    {c.moveHere}
                  </button>
                )}
              </div>
              {hint && <p className="cp-zone-hint">{hint}</p>}
              <ul className="cp-chips">
                {list.map((p) => (
                  <li
                    key={p.id}
                    className={`cp-chip${selected === p.id ? " selected" : ""}${drag?.id === p.id ? " ghosted" : ""}`}
                    onPointerDown={(e) => startPointer(e, p)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {busyIds.has(p.id) && <span className="cp-chip-dot" aria-hidden="true" />}
                    <span className="cp-chip-name">{p.name}</span>
                    {p.guest && <span className="cp-chip-tag">{c.guest}</span>}
                    {started && p.games > 0 && <span className="cp-chip-games">{p.games}</span>}
                    {selected === p.id && (
                      <span className="cp-chip-tools">
                        <button type="button" onClick={() => onRename(p)}>
                          {c.rename}
                        </button>
                        {p.guest && (
                          <button type="button" onClick={() => onRemoveGuest(p.id)}>
                            {c.remove}
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
                {list.length === 0 && <li className="cp-zone-empty">{c.emptyZone}</li>}
              </ul>
            </div>
          );
        })}
      </div>
      {drag && dragged && (
        <div className="cp-chip cp-chip-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <span className="cp-chip-name">{dragged.name}</span>
        </div>
      )}
    </>
  );
}

/* ── Courts board ─────────────────────────────────────── */

function CourtsPanel({
  state,
  names,
  copy: c,
  organiser,
  busy,
  serverNow,
  onAction,
  onEnd,
}: {
  state: CasualPlayState;
  names: Map<string, Player>;
  copy: Copy;
  organiser: boolean;
  busy: boolean;
  serverNow: number;
  onAction: (a: Action) => Promise<boolean>;
  onEnd: () => void;
}) {
  const busyIds = onCourtIds(state);
  const nextIds = new Set(state.next ? [...state.next.teamA, ...state.next.teamB] : []);
  const inRotation = state.players.filter((p) => p.tier !== null);
  const waiting = queueOrder(inRotation.filter((p) => !p.paused && !busyIds.has(p.id) && !nextIds.has(p.id)));
  const resting = inRotation.filter((p) => p.paused).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const name = (id: string) => names.get(id)?.name ?? "—";
  const courtOf = new Map(
    state.onCourt.flatMap((g) => (g ? [...g.teamA, ...g.teamB].map((id) => [id, g.court] as const) : [])),
  );

  if (!state.started) {
    return (
      <section className="cp-waiting-start">
        <div className="mg-card cp-not-started">
          <CourtIcon />
          <p>{c.notStarted}</p>
        </div>
        {inRotation.length > 0 && (
          <div className="mg-card">
            <div className="section-label">
              {c.playersToday} · {inRotation.length}
            </div>
            <ul className="mg-roster">
              {[...inRotation]
                .sort((a, b) => a.name.localeCompare(b.name, "vi"))
                .map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="cp-board-wrap">
      <div className={`cp-courts cp-courts-${state.courts}`}>
        {state.onCourt.map((game, i) => (
          <CourtCard
            key={`${i}-${game?.id ?? "free"}`}
            court={i + 1}
            game={game}
            name={name}
            copy={c}
            organiser={organiser}
            busy={busy}
            serverNow={serverNow}
            onFinish={() => onAction({ type: "finish", court: i + 1 })}
            onCallOff={() => onAction({ type: "void", court: i + 1 })}
          />
        ))}
      </div>

      <div className="cp-lower">
        <div className="cp-next">
          <div className="cp-next-head">
            <span className="cp-next-label">{c.upNext}</span>
            {organiser && state.next && (
              <button
                type="button"
                className="cp-link-btn"
                disabled={busy}
                onClick={() => onAction({ type: "reshuffleNext" })}
              >
                <ShuffleIcon />
                {c.shuffle}
              </button>
            )}
          </div>
          {state.next ? (
            <>
              <Matchup game={state.next} name={name} copy={c} compact courtOf={courtOf} />
              <p className="cp-next-ready">{c.getReady}</p>
            </>
          ) : (
            <p className="cp-next-empty">{c.emptyCourt}</p>
          )}
        </div>

        {(waiting.length > 0 || resting.length > 0) && (
          <div className="cp-queue">
            <div className="cp-queue-head">
              <span className="section-label">{c.waiting}</span>
              <span className="cp-zone-count">{waiting.length}</span>
            </div>
            <ol className="cp-queue-list">
              {waiting.map((p) => (
                <li key={p.id}>
                  <span className="cp-queue-name">{p.name}</span>
                  <span className="cp-queue-games">{c.gamesShort(p.games)}</span>
                  {organiser && (
                    <button
                      type="button"
                      className="cp-mini-btn"
                      disabled={busy}
                      onClick={() => onAction({ type: "setPaused", playerId: p.id, paused: true })}
                    >
                      {c.takeBreak}
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {resting.length > 0 && (
              <>
                <div className="cp-queue-head cp-resting-head">
                  <span className="section-label">{c.resting}</span>
                  <span className="cp-zone-count">{resting.length}</span>
                </div>
                <ul className="cp-queue-list cp-resting">
                  {resting.map((p) => (
                    <li key={p.id}>
                      <span className="cp-queue-name">{p.name}</span>
                      <span className="cp-queue-games">{c.gamesShort(p.games)}</span>
                      {organiser && (
                        <button
                          type="button"
                          className="cp-mini-btn"
                          disabled={busy}
                          onClick={() => onAction({ type: "setPaused", playerId: p.id, paused: false })}
                        >
                          {c.backIn}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {organiser && (
        <div className="cp-end-row">
          <button type="button" className="btn btn-bronze-outline mg-btn-sm" onClick={onEnd}>
            {c.endSession}
          </button>
        </div>
      )}
    </section>
  );
}

function Matchup({
  game,
  name,
  copy: c,
  compact = false,
  courtOf,
}: {
  game: Game;
  name: (id: string) => string;
  copy: Copy;
  compact?: boolean;
  /** For the preview: which court a player is still finishing on, if any. */
  courtOf?: Map<string, number>;
}) {
  const team = (ids: [string, string]) => (
    <div className="cp-team">
      {ids.map((id) => (
        <span key={id}>
          {name(id)}
          {courtOf?.has(id) && <em className="cp-on-court">{c.onCourt(courtOf.get(id)!)}</em>}
        </span>
      ))}
    </div>
  );
  return (
    <div className={`cp-matchup${compact ? " compact" : ""}`}>
      {team(game.teamA)}
      <div className="cp-vs">{c.vs}</div>
      {team(game.teamB)}
    </div>
  );
}

/** A button that needs a second tap within a few seconds, so a stray tap can't end a game. */
function ConfirmButton({
  label,
  confirmLabel,
  className,
  disabled,
  onConfirm,
  children,
}: {
  label: string;
  confirmLabel: string;
  className: string;
  disabled: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? " armed" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {children}
      {armed ? confirmLabel : label}
    </button>
  );
}

function CourtCard({
  court,
  game,
  name,
  copy: c,
  organiser,
  busy,
  serverNow,
  onFinish,
  onCallOff,
}: {
  court: number;
  game: Game | null;
  name: (id: string) => string;
  copy: Copy;
  organiser: boolean;
  busy: boolean;
  serverNow: number;
  onFinish: () => void;
  onCallOff: () => void;
}) {
  const minutes = game ? Math.max(0, Math.floor((serverNow - game.startedAt) / 60_000)) : 0;
  return (
    <article className={`cp-court${game ? "" : " cp-court-free"}`}>
      <div className="cp-court-top">
        <div className="cp-court-num">
          <span>{c.court}</span>
          <strong>{court}</strong>
        </div>
        {game && <span className="cp-court-time">{c.minutes(minutes)}</span>}
      </div>
      {game ? (
        <Matchup game={game} name={name} copy={c} />
      ) : (
        <p className="cp-court-empty">{c.emptyCourt}</p>
      )}
      {organiser && game && (
        <div className="cp-court-actions">
          <ConfirmButton
            label={c.finish}
            confirmLabel={c.confirmFinish}
            className="btn btn-primary cp-finish-btn"
            disabled={busy}
            onConfirm={onFinish}
          >
            <CheckIcon />
          </ConfirmButton>
          <ConfirmButton
            label={c.callOff}
            confirmLabel={c.callOffConfirm}
            className="cp-calloff-btn"
            disabled={busy}
            onConfirm={onCallOff}
          />
        </div>
      )}
    </article>
  );
}

function UnlockModal({
  open,
  copy: c,
  onClose,
  onUnlock,
}: {
  open: boolean;
  copy: Copy;
  onClose: () => void;
  onUnlock: (password: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue("");
      setError(false);
    }
  }, [open]);
  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    const ok = await onUnlock(value);
    setBusy(false);
    if (!ok) setError(true);
  };
  return (
    <ModalShell
      id="cp-unlock-modal"
      open={open}
      onClose={onClose}
      title={c.unlockTitle}
      footer={
        <>
          <button type="button" className="btn btn-bronze-outline" onClick={onClose}>
            {c.cancel}
          </button>
          <button type="button" className="btn btn-primary mg-btn-grow" onClick={submit} disabled={busy || !value}>
            {c.unlock}
          </button>
        </>
      }
    >
      <p className="mg-modal-text">{c.unlockBody}</p>
      <form
        className="mg-password"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="cp-password">{c.password}</label>
        <input
          id="cp-password"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          aria-invalid={error ? true : undefined}
        />
        {error && <p className="mg-password-error">{c.wrongPassword}</p>}
      </form>
    </ModalShell>
  );
}

/* ── Icons ────────────────────────────────────────────── */

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function KeyIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...iconProps} width={18} height={18}>
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...iconProps} width={18} height={18}>
      <path d="M4 12.5 9.5 18 20 6" />
    </svg>
  );
}
function ShuffleIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}
function CourtIcon() {
  return (
    <svg {...iconProps} width={40} height={40} strokeWidth={1.6}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 12h18M12 4v16M7 4v16M17 4v16" />
    </svg>
  );
}
