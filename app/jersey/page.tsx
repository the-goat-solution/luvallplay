import type { Metadata } from "next";
import { JerseyContent } from "@/components/jersey/JerseyContent";
import { EARLY_BIRD_LIMIT, jerseyOpensAt } from "@/lib/jersey";
import { earlyBirdsLeft } from "@/lib/jersey-db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Club Jersey — Three Wolves Badminton Club",
  description:
    "Register for the official Three Wolves Badminton Club Yonex jersey. First 10 pay $15. Sponsored by House of Barber.",
};

export default async function JerseyPage() {
  let left = EARLY_BIRD_LIMIT;
  if (process.env.POSTGRES_URL) {
    try {
      left = await earlyBirdsLeft();
    } catch (err) {
      console.error("Jersey page status failed", err);
    }
  }
  return (
    <JerseyContent
      opensAt={jerseyOpensAt().toISOString()}
      serverNow={new Date().toISOString()}
      left={left}
    />
  );
}
