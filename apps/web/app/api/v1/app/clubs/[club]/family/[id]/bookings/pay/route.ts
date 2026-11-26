import { appRoute } from "@/lib/app-api";
import { familyPay } from "@/lib/juniors/app-family";

// A club that charges for a junior's place: a card payment for the app to
// confirm. The webhook books the place when the payment succeeds.
const route = appRoute("family.pay", ({ player, club, params, body }) => familyPay(player, club, params.id, body.date), { rateKey: (ip) => `pi:${ip}` });

export const POST = route.handle;
export const OPTIONS = route.preflight;
