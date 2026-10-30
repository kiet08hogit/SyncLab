import { Composition } from "remotion";

import { WorkspaceWalkIn } from "./workspace-walk-in";
import { WORKSPACE_FRAMES, WORKSPACE_FPS, WORKSPACE_WIDTH, WORKSPACE_HEIGHT } from "../lib/workspace-camera";

export function Root() {
  return (
    <>
      <Composition id="WorkspaceWalkIn" component={WorkspaceWalkIn} durationInFrames={WORKSPACE_FRAMES} fps={WORKSPACE_FPS} width={WORKSPACE_WIDTH} height={WORKSPACE_HEIGHT} />
    </>
  );
}
