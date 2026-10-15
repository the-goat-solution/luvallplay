"use client";

import { useEffect, useState } from "react";

// Tracks the opening and closing times using the server's clock (not the
// visitor's, which may be wrong), so everyone sees the form open and close
// at the same moment.
export function useJerseyClock(opensAt: string, serverNow: string, closesAt: string) {
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const opens = new Date(opensAt).getTime();
  const closes = new Date(closesAt).getTime();
  const [now, setNow] = useState(() => new Date(serverNow).getTime());

  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [offset]);

  const started = now >= opens;
  const closed = now > closes;
  return { started, closed, open: started && !closed, msLeft: Math.max(0, opens - now) };
}
