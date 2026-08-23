export const MAX_CASUAL = 8;
export const CASUAL_PRICE_CENTS = 1000;
export const MONTHLY_PRICE_CENTS = 3300;
export const QUARTERLY_PRICE_CENTS = 8500;
export const BOOKING_WINDOW_DAYS = 30;
export const BOOKING_CUTOFF_HOUR = 17;
export const DONATION_MIN_CENTS = 200;
export const DONATION_MAX_CENTS = 500000;

export type DonationFrequency = "once" | "monthly";

export const GALLERY_IMAGES = [
  {
    src: "/uploads/705237516_122111863220852785_3866235625892853843_n.jpg",
    alt: "Three Wolves — group photo",
  },
  {
    src: "/uploads/678602054_122107704008852785_8338718090885557850_n.jpg",
    alt: "Player in action",
  },
  {
    src: "/uploads/656703917_122095036622852785_1698823098359580880_n.jpg",
    alt: "Three Wolves members on court",
  },
] as const;

export const PRICES = {
  casual: 10,
  monthly: 33,
  quarterly: 85,
} as const;

export type PlanId = keyof typeof PRICES;
