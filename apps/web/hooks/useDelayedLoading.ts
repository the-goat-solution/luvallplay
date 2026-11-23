"use client";

import { useEffect, useState } from "react";

// Shows a loading indicator only once `active` has stayed true for
// `delayMs` — avoids a spinner flash on fast (<400ms) requests, which
// reads as jankier than no indicator at all.
export function useDelayedLoading(active: boolean, delayMs = 400): boolean {
  const [show, setShow] = useState(false);

  // Hide straight away once the work is done (adjusting state during render).
  if (!active && show) setShow(false);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return show;
}
