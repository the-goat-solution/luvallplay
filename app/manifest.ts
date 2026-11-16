import type { MetadataRoute } from "next";

// Makes the profile installable ("Add to Home Screen"). Opens at the
// profile; scope "/" keeps the leaderboard and gallery inside the app too.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Three Wolves Badminton Club",
    short_name: "3 Wolves",
    description: "Your Three Wolves membership, play days, leaderboard and club shop.",
    id: "/profile",
    start_url: "/profile?source=homescreen",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fcfbf2",
    theme_color: "#0e2c3f",
    lang: "en",
    categories: ["sports", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Membership", url: "/profile/membership", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My stats", url: "/profile/player", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Leaderboard", url: "/leaderboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
