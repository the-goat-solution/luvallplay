"use client";

import { useFormStatus } from "react-dom";
import { MINI_GAME_MAX_PLAYERS } from "@/lib/constants";

// On/off switch for a play day's mini game mode. Lives inside a Server
// Action <form> that flips the current state, so it reads the form's
// pending state to show the switch moving while the action runs.
export function MiniGameToggle({ on }: { on: boolean }) {
  const { pending } = useFormStatus();
  const shown = pending ? !on : on;

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-label="Mini game day"
        disabled={pending}
        onClick={(e) => {
          if (
            !on &&
            !window.confirm(
              `Make this a mini game day? Registration will be locked and the day capped at ${MINI_GAME_MAX_PLAYERS} players.`,
            )
          ) {
            e.preventDefault();
          }
        }}
        style={{
          position: "relative",
          width: 44,
          height: 24,
          padding: 0,
          borderRadius: 12,
          border: "none",
          background: shown ? "#5a2ea6" : "#bbb",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
          transition: "background 0.15s",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 3,
            left: shown ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </button>
      {pending ? (on ? "Turning off…" : "Turning on…") : on ? "Mini game day" : "Normal play day"}
    </label>
  );
}
