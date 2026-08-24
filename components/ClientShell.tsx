"use client";

import { useAnimateIn } from "@/hooks/useAnimateIn";
import { useScrollNav } from "@/hooks/useScrollNav";
import { BookingModal } from "@/components/modals/BookingModal";
import { MembershipModal } from "@/components/modals/MembershipModal";
import { WaitlistModal } from "@/components/modals/WaitlistModal";
import { DonateModal } from "@/components/modals/DonateModal";
import { Lightbox } from "@/components/Lightbox";
import type { CmsGalleryImage } from "@/lib/sanity-queries";
import type { CmsPricingPlan } from "@/lib/pricing-plans";

export function ClientShell({
  galleryImages,
  pricingPlans,
}: {
  galleryImages?: CmsGalleryImage[];
  pricingPlans?: CmsPricingPlan[] | null;
}) {
  useScrollNav();
  useAnimateIn();
  return (
    <>
      <BookingModal />
      <MembershipModal pricingPlans={pricingPlans} />
      <WaitlistModal />
      <DonateModal />
      <Lightbox images={galleryImages} />
    </>
  );
}
