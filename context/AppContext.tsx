"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PlanId } from "@/lib/constants";

type ModalId = "booking" | "membership" | "waitlist" | null;

type AppContextValue = {
  openModal: ModalId;
  setOpenModal: (id: ModalId) => void;
  openMembershipModal: (plan?: PlanId) => void;
  openCasualModal: () => void;
  openWaitlistModal: (sessionDate?: Date) => void;
  selectedPlan: PlanId;
  setSelectedPlan: (plan: PlanId) => void;
  selectedSession: Date | null;
  setSelectedSession: (d: Date | null) => void;
  schedulePick: Date | null;
  setSchedulePick: (d: Date | null) => void;
  waitlistSession: Date | null;
  spotsByDate: Record<string, number>;
  refreshSpots: (dates: string[]) => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [openModal, setOpenModal] = useState<ModalId>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("monthly");
  const [selectedSession, setSelectedSession] = useState<Date | null>(null);
  const [schedulePick, setSchedulePick] = useState<Date | null>(null);
  const [waitlistSession, setWaitlistSession] = useState<Date | null>(null);
  const [spotsByDate, setSpotsByDate] = useState<Record<string, number>>({});

  const refreshSpots = useCallback(async (dates: string[]) => {
    if (dates.length === 0) return;
    try {
      const res = await fetch(
        `/api/spots?dates=${encodeURIComponent(dates.join(","))}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { spots: Record<string, number> };
      setSpotsByDate((prev) => ({ ...prev, ...data.spots }));
    } catch {
      /* offline / db not configured */
    }
  }, []);

  const openMembershipModal = useCallback((plan: PlanId = "monthly") => {
    setSelectedPlan(plan);
    setOpenModal("membership");
  }, []);

  const openCasualModal = useCallback(() => {
    setSelectedSession(null);
    setOpenModal("booking");
  }, []);

  const openWaitlistModal = useCallback((sessionDate?: Date) => {
    setWaitlistSession(sessionDate ?? null);
    setOpenModal("waitlist");
  }, []);

  const value = useMemo(
    () => ({
      openModal,
      setOpenModal,
      openMembershipModal,
      openCasualModal,
      openWaitlistModal,
      selectedPlan,
      setSelectedPlan,
      selectedSession,
      setSelectedSession,
      schedulePick,
      setSchedulePick,
      waitlistSession,
      spotsByDate,
      refreshSpots,
    }),
    [
      openModal,
      openMembershipModal,
      openCasualModal,
      openWaitlistModal,
      selectedPlan,
      selectedSession,
      schedulePick,
      waitlistSession,
      spotsByDate,
      refreshSpots,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
