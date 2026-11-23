"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_PUBLIC_CLUB, type PublicClub } from "@/lib/club-public";

// The club's public settings for client components (lib/club-public.ts).
const ClubContext = createContext<PublicClub>(DEFAULT_PUBLIC_CLUB);

export function ClubProvider({ club, children }: { club: PublicClub; children: ReactNode }) {
  return <ClubContext.Provider value={club}>{children}</ClubContext.Provider>;
}

/** The current club's public settings (the built-in values outside a provider). */
export function useClub(): PublicClub {
  return useContext(ClubContext);
}
