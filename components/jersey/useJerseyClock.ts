"use client";

import { useEffect, useState } from "react";

// Counts down to `opensAt` using the server's clock (not the visitor's, which
// may be wrong), so everyone sees the form open at the same moment.
export function useJerseyClock(opensAt: string, serverNow: string) {
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const target = new Date(opensAt).getTime();
  const [msLeft, setMsLeft] = useState(() => target - new Date(serverNow).getTime());

  useEffect(() => {
    const tick = () => setMsLeft(target - (Date.now() + offset));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, offset]);

  return { open: msLeft <= 0, msLeft: Math.max(0, msLeft) };
}
