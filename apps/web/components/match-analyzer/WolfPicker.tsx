"use client";

// Who is on court, for a Wolf Vision session that isn't an Arena challenge:
// pick a registered player ("wolf") from the list, or enter the name and
// email of someone who isn't registered (they get the stats by email after
// the match).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Wolf } from "./session";
import s from "./analyzer.module.css";

export type WolfChoice = { id: number; name: string; avatarUrl: string | null; me: boolean };

let cached: Promise<WolfChoice[]> | null = null;
function loadWolves(): Promise<WolfChoice[]> {
  if (!cached) {
    cached = fetch("/api/wolf-vision/players", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { players: [] }))
      .then((j: { players?: WolfChoice[] }) => j.players ?? [])
      .catch(() => {
        cached = null;
        return [];
      });
  }
  return cached;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
}

export function WolfAvatar({ wolf, color, size = 28 }: { wolf: Pick<Wolf, "name" | "avatarUrl">; color: string; size?: number }) {
  return wolf.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={wolf.avatarUrl} alt="" className={s.wolfAvatar} style={{ width: size, height: size, borderColor: color }} />
  ) : (
    <span className={s.wolfAvatar} style={{ width: size, height: size, borderColor: color, background: color, fontSize: size * 0.4 }} aria-hidden="true">
      {initialsOf(wolf.name)}
    </span>
  );
}

export type PickerCopy = {
  pickTitle: (n: number) => string;
  pickFromList: string;
  pickByEmail: string;
  pickSearch: string;
  pickNone: string;
  pickLoading: string;
  pickName: string;
  pickEmail: string;
  pickEmailHint: string;
  pickAdd: string;
  pickBadEmail: string;
  pickReset: (n: number) => string;
  cancel: string;
  you: string;
};

export function WolfPicker({
  index,
  color,
  people,
  copy,
  onPick,
  onClose,
}: {
  /** Player index 0–3 (Wolf 1–4). */
  index: number;
  color: string;
  people: Wolf[];
  copy: PickerCopy;
  onPick: (w: Wolf | null) => void;
  onClose: () => void;
}) {
  const current = people[index];
  const [tab, setTab] = useState<"list" | "email">(current?.email ? "email" : "list");
  const [wolves, setWolves] = useState<WolfChoice[] | null>(null);
  const [q, setQ] = useState("");
  const [name, setName] = useState(current?.email ? current.name : "");
  const [email, setEmail] = useState(current?.email ?? "");
  const [bad, setBad] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void loadWolves().then((w) => alive && setWolves(w));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const taken = useMemo(() => new Set(people.map((p, i) => (i !== index ? p.playerId : undefined)).filter(Boolean)), [people, index]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (wolves ?? []).filter((w) => !w.me && !taken.has(w.id) && (!needle || w.name.toLowerCase().includes(needle)));
  }, [wolves, q, taken]);

  const addByEmail = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setBad(true);
    onPick({ name: name.trim().slice(0, 60) || e.split("@")[0], email: e });
  };

  return (
    <div className={s.picker} onClick={onClose}>
      <div className={`${s.pickerSheet} ${s.wolfSheet}`} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label={copy.pickTitle(index + 1)} data-testid="wolf-picker">
        <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i className={s.dot} style={{ background: color, color }} />
          {copy.pickTitle(index + 1)}
        </h3>
        <div className={s.seg} role="group" style={{ marginBottom: 12 }}>
          <button type="button" aria-pressed={tab === "list"} onClick={() => setTab("list")} data-testid="pick-tab-list">
            {copy.pickFromList}
          </button>
          <button type="button" aria-pressed={tab === "email"} onClick={() => setTab("email")} data-testid="pick-tab-email">
            {copy.pickByEmail}
          </button>
        </div>

        {tab === "list" ? (
          <>
            <input
              ref={searchRef}
              className={s.wolfSearch}
              type="search"
              placeholder={copy.pickSearch}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              data-testid="pick-search"
            />
            <div className={s.wolfList} role="listbox">
              {wolves === null ? (
                <p className={s.hint}>{copy.pickLoading}</p>
              ) : shown.length ? (
                shown.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="option"
                    aria-selected={current?.playerId === w.id}
                    className={s.wolfOption}
                    onClick={() => onPick({ name: w.name, avatarUrl: w.avatarUrl, playerId: w.id })}
                    data-testid="pick-wolf"
                  >
                    <WolfAvatar wolf={w} color={color} size={34} />
                    <span>{w.name}</span>
                  </button>
                ))
              ) : (
                <p className={s.hint}>{copy.pickNone}</p>
              )}
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addByEmail();
            }}
          >
            <label className={s.field}>
              {copy.pickName}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" data-testid="pick-name" />
            </label>
            <label className={s.field}>
              {copy.pickEmail}
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setBad(false);
                }}
                autoComplete="off"
                required
                data-testid="pick-email"
              />
            </label>
            {bad ? <p className={s.warn}>{copy.pickBadEmail}</p> : null}
            <p className={s.hint}>{copy.pickEmailHint}</p>
            <button className={s.btn} type="submit" style={{ width: "100%" }} data-testid="pick-add">
              {copy.pickAdd}
            </button>
          </form>
        )}

        <div className={s.modalActions}>
          {current && !current.placeholder ? (
            <button className={s.btnGhost} type="button" onClick={() => onPick(null)}>
              {copy.pickReset(index + 1)}
            </button>
          ) : null}
          <button className={s.btnGhost} type="button" onClick={onClose}>
            {copy.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
