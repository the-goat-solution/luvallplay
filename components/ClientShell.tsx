"use client";

import { useAnimateIn } from "@/hooks/useAnimateIn";
import { useScrollNav } from "@/hooks/useScrollNav";
import { BookingModal } from "@/components/modals/BookingModal";
import { MembershipModal } from "@/components/modals/MembershipModal";
import { WaitlistModal } from "@/components/modals/WaitlistModal";
import { Lightbox } from "@/components/Lightbox";
import type { CmsGalleryImage } from "@/lib/sanity-queries";

export function ClientShell({
  galleryImages,
}: {
  galleryImages?: CmsGalleryImage[];
}) {
  useScrollNav();
  useAnimateIn();
  return (
    <>
      <BookingModal />
      <MembershipModal />
      <WaitlistModal />
      <Lightbox images={galleryImages} />
    </>
  );
}
