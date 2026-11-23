"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_PUBLIC_CLUB, type PublicClub } from "@/lib/club-public";
import { applyClubTerms } from "@/lib/club-terms";

// The club's public settings for client components (lib/club-public.ts).
const ClubContext = createContext<PublicClub>(DEFAULT_PUBLIC_CLUB);

export function ClubProvider({ club, children }: { club: PublicClub; children: ReactNode }) {
  // Translated text uses the club's own names (lib/club-terms.ts).
  applyClubTerms(club.terms);
  return <ClubContext.Provider value={club}>{children}</ClubContext.Provider>;
}

/** The current club's public settings (the built-in values outside a provider). */
export function useClub(): PublicClub {
  return useContext(ClubContext);
}
