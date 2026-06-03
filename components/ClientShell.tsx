"use client";

import { useAnimateIn } from "@/hooks/useAnimateIn";
import { useScrollNav } from "@/hooks/useScrollNav";
import { BookingModal } from "@/components/modals/BookingModal";
import { MembershipModal } from "@/components/modals/MembershipModal";
import { WaitlistModal } from "@/components/modals/WaitlistModal";
import { Lightbox } from "@/components/Lightbox";

export function ClientShell() {
  useScrollNav();
  useAnimateIn();
  return (
    <>
      <BookingModal />
      <MembershipModal />
      <WaitlistModal />
      <Lightbox />
    </>
  );
}
