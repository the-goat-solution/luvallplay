"use client";

import { useState } from "react";
import { useJerseyT } from "@/lib/jersey-i18n";

export function CopyButton({ text }: { text: string }) {
  const { tr } = useJerseyT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="jersey-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked: the text is on screen to copy by hand */
        }
      }}
    >
      {done ? tr("copied") : tr("copy")}
    </button>
  );
}
