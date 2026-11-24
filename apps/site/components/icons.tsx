// Line icons in the brand style: 1.9px stroke at 24px, round caps and joins.
import type { ReactNode, SVGProps } from "react";

const paths: Record<string, ReactNode> = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  pin: (<><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  card: (<><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10.5h18M7 15h4" /></>),
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" />,
  bag: (<><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  video: (<><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="M16 10.5l5-3v9l-5-3" /></>),
  phone: (<><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M11 18.5h2" /></>),
  arc: (<><path d="M4 18c4-10 10-12 16-12" /><circle cx="20" cy="6" r="1.5" /></>),
  cut: <path d="M6 4l12 16M6 20L18 4" />,
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20h4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  shuttle: (<><circle cx="7" cy="17" r="3" /><path d="M9 15l5-11M9.5 15.5L20 10M14 4l6 6M11.5 9.5L16 13" /></>),
  paddle: (<><rect x="9" y="3" width="10" height="12" rx="4" transform="rotate(30 14 9)" /><path d="M10.5 14.5L6 20" /><circle cx="18.5" cy="18.5" r="2" /></>),
  net: (<><path d="M3 14h18M3 14v6M21 14v6M7 14v6M11 14v6M15 14v6M19 14v6" /><circle cx="12" cy="6" r="3" /></>),
  court: (<><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M4 12h16M12 3v18M4 7h16M4 17h16" /></>),
};

export function Icon({ name, size = 24, ...rest }: { name: keyof typeof paths | string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {paths[name]}
    </svg>
  );
}
