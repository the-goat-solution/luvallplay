// The app's icons: one set, drawn for it on a 24px grid with a 2px round
// stroke (no fills), so every glyph has the same weight, corners and optical
// size. Names say what the icon shows, not where it's used. Decorative by
// default (hidden from screen readers); pass `label` when the icon is the
// only thing that says what a control does.
//
// Shapes: a string is path data; "c cx cy r" a circle; "e cx cy rx ry deg"
// an ellipse turned by deg.
const ICONS = {
  home: ["M4 10.2 12 4l8 6.2V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19Z"],
  user: ["c 12 8 4", "M4.5 20.5c.9-3.8 3.9-6 7.5-6s6.6 2.2 7.5 6"],
  trophy: ["M7.5 4h9v5.5a4.5 4.5 0 0 1-9 0Z", "M7.5 6H5.8A1.8 1.8 0 0 0 4 7.8v.4A3.8 3.8 0 0 0 7.8 12", "M16.5 6h1.7A1.8 1.8 0 0 1 20 7.8v.4a3.8 3.8 0 0 1-3.8 3.8", "M12 14v4", "M8 20.5h8", "M9.5 18h5"],
  // Two rackets crossed (the Arena: challenges).
  rackets: ["e 6.6 6.6 2.8 3.8 -45", "M9.2 9.2 20 20", "e 17.4 6.6 2.8 3.8 45", "M14.8 9.2 4 20"],
  podium: ["M3 20.5h18", "M9 20.5V8.5h6v12", "M4 20.5V13h5", "M15 20.5V11h5v9.5"],
  // An eye in a camera's frame (Vision: AI tracking).
  vision: ["M3 7.5V5.5a2.5 2.5 0 0 1 2.5-2.5h2", "M16.5 3h2A2.5 2.5 0 0 1 21 5.5v2", "M21 16.5v2a2.5 2.5 0 0 1-2.5 2.5h-2", "M7.5 21h-2A2.5 2.5 0 0 1 3 18.5v-2", "M6.5 12s2-3.75 5.5-3.75S17.5 12 17.5 12 15.5 15.75 12 15.75 6.5 12 6.5 12Z", "c 12 12 1.4"],
  bell: ["M6 9.5a6 6 0 0 1 12 0c0 5.2 1.6 7.5 2.5 8.5h-17C4.4 17 6 14.7 6 9.5Z", "M10 21a2.3 2.3 0 0 0 4 0"],
  gear: ["M9.74 5.06 10.82 2.67h2.36l1.08 2.39 1.05.44 2.45-.93 1.67 1.67-.93 2.45.44 1.05 2.39 1.08v2.36l-2.39 1.08-.44 1.05.93 2.45-1.67 1.67-2.45-.93-1.05.44-1.08 2.39h-2.36l-1.08-2.39-1.05-.44-2.45.93-1.67-1.67.93-2.45-.44-1.05-2.39-1.08v-2.36l2.39-1.08.44-1.05-.93-2.45 1.67-1.67 2.45.93Z", "c 12 12 3"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronLeft: ["m15 6-6 6 6 6"],
  chevronRight: ["m9 6 6 6-6 6"],
  check: ["M5 12.5 9.5 17 19 7.5"],
  arrowRight: ["M5 12h14", "m13 6 6 6-6 6"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"],
  crown: ["M3.5 8.5 8 12.5l4-7 4 7 4.5-4-2 9.5h-13Z", "M6 21h12"],
  sparkles: ["M11 3c.7 3.7 2.6 5.6 6.3 6.3-3.7.7-5.6 2.6-6.3 6.3-.7-3.7-2.6-5.6-6.3-6.3C8.4 8.6 10.3 6.7 11 3Z", "M18.5 14.5c.35 1.75 1.25 2.65 3 3-1.75.35-2.65 1.25-3 3-.35-1.75-1.25-2.65-3-3 1.75-.35 2.65-1.25 3-3Z"],
  flame: ["M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3.6-2.5-6-4-9.5-1.6 2.1-2.3 3.8-2.6 5.4-1-.8-1.7-2-1.9-3.4C7.6 9.2 5.5 11.6 5.5 14.5A6.5 6.5 0 0 0 12 21Z"],
  rankUp: ["c 12 12 9", "M12 16.5v-9", "m8.5 11 3.5-3.5 3.5 3.5"],
  star: ["M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"],
  shuttle: ["M8.5 16.5h7a3.5 3.5 0 0 1-7 0Z", "M8.5 16.5 6 4h12l-2.5 12.5", "M10.5 16.5 10 4", "M13.5 16.5 14 4", "M7.1 9.5h9.8"],
  inbox: ["M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z", "M4 13h4l1.5 2.5h5L16 13h4"],
  card: ["M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5Z", "M3 10h18", "M7 14.5h3"],
  image: ["M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z", "c 9 9.5 1.75", "m20 15.5-4.5-4.5L6 20"],
  globe: ["c 12 12 9", "M3 12h18", "M12 3c2.3 2.5 3.5 5.5 3.5 9s-1.2 6.5-3.5 9c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z"],
  contrast: ["c 12 12 9", "M12 3v18a9 9 0 0 0 0-18Z"],
  shield: ["M12 3 5 5.8v5.4c0 4.5 2.9 8.2 7 9.8 4.1-1.6 7-5.3 7-9.8V5.8Z"],
  plug: ["M9 3v4", "M15 3v4", "M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0Z", "M12 16v5"],
  phone: ["M7 4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5Z", "M11 18h2"],
  logOut: ["M10 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H10", "m15 16 4-4-4-4", "M19 12H9.5"],
  key: ["c 8 15.5 4", "m11 12.5 8.5-8.5", "m16.5 7 2.5 2.5", "m14 9.5 2 2"],
  calendar: ["M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z", "M4 10h16", "M8.5 3v4", "M15.5 3v4"],
  bag: ["M5.5 8h13l-1 11.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5Z", "M9 10V7a3 3 0 0 1 6 0v3"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  download: ["M12 4v11", "m7 10 5 5 5-5", "M5 20h14"],
  bolt: ["M13 3 5 13.5h6L10 21l8-10.5h-6Z"],
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

function Shape({ d }: { d: string }) {
  const [kind, ...n] = d.split(" ");
  if (kind === "c") return <circle cx={n[0]} cy={n[1]} r={n[2]} />;
  if (kind === "e") return <ellipse cx={n[0]} cy={n[1]} rx={n[2]} ry={n[3]} transform={`rotate(${n[4]} ${n[0]} ${n[1]})`} />;
  return <path d={d} />;
}

export function Icon({ name, size = 24, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {ICONS[name].map((d) => (
        <Shape key={d} d={d} />
      ))}
    </svg>
  );
}
