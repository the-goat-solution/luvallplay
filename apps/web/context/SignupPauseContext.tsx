"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_PAUSED_DAYS, type Weekday } from "@/lib/constants";

// Weekdays whose public sign-ups are paused, read server-side on the home
// page (see lib/day-requests.ts getPausedDays) and shared with the schedule,
// membership section and modals.
const SignupPauseContext = createContext<readonly Weekday[]>(DEFAULT_PAUSED_DAYS);

export function SignupPauseProvider({
  pausedDays,
  children,
}: {
  pausedDays: Weekday[];
  children: ReactNode;
}) {
  return (
    <SignupPauseContext.Provider value={pausedDays}>
      {children}
    </SignupPauseContext.Provider>
  );
}

export function usePausedDays(): readonly Weekday[] {
  return useContext(SignupPauseContext);
}
