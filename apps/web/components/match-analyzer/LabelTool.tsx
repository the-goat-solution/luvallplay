"use client";

import { LabelTool as Tool } from "@luvallplay/vision/ui";
import { WebVisionHost } from "./host";

export function LabelTool() {
  return (
    <WebVisionHost>
      <Tool />
    </WebVisionHost>
  );
}
