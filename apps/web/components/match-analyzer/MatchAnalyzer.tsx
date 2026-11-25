"use client";

import type { ComponentProps } from "react";
import { MatchAnalyzer as Tracker } from "@luvallplay/vision/ui";
import { WebVisionHost } from "./host";

export function MatchAnalyzer(props: ComponentProps<typeof Tracker>) {
  return (
    <WebVisionHost>
      <Tracker {...props} />
    </WebVisionHost>
  );
}
