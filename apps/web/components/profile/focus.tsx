"use client";

import { createContext, useContext, useEffect } from "react";

// Full-page "focus" mode for the profile app: a tab (Wolf Vision once a
// session is being set up) asks the shell to hide its top bar and tab bar
// so the tool gets the whole screen; the tool then shows its own exit.

export const ProfileFocusContext = createContext<((on: boolean) => void) | null>(null);

/** Hides the profile app's top bar and tabs while `on` (no-op outside the profile app). */
export function useProfileFocus(on: boolean) {
  const set = useContext(ProfileFocusContext);
  useEffect(() => {
    if (!set) return;
    set(on);
    return () => set(false);
  }, [set, on]);
}
