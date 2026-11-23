"use client";

import { AppProvider } from "@/context/AppContext";
import { ClubProvider } from "@/context/ClubContext";
import type { PublicClub } from "@/lib/club-public";
import { LanguageProvider } from "@/context/LanguageContext";
import { ToastProvider } from "@/context/ToastContext";
import type { ReactNode } from "react";

export function Providers({ club, children }: { club: PublicClub; children: ReactNode }) {
  return (
    <ClubProvider club={club}>
      <LanguageProvider>
        <ToastProvider>
          <AppProvider>{children}</AppProvider>
        </ToastProvider>
      </LanguageProvider>
    </ClubProvider>
  );
}
