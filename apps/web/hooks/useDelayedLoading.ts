"use client";

import { useEffect, useRef, useState } from "react";

// Shows a loading indicator only once `active` has stayed true for
// `delayMs` — avoids a spinner flash on fast (<400ms) requests, which
// reads as jankier than no indicator at all.
export function useDelayedLoading(active: boolean, delayMs = 400): boolean {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (active) {
      timerRef.current = setTimeout(() => setShow(true), delayMs);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShow(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, delayMs]);

  return show;
}
