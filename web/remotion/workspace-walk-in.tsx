import { AbsoluteFill, Freeze, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { SOURCE_START_FRAME, SOURCE_TRAVEL_FRAMES } from "../lib/workspace-camera";
import { MonitorGleam } from "./monitor-gleam";

/** Preserve the supplied 0:02-0:06 camera move and replace its original flash. */
export function WorkspaceWalkIn() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#06090b", overflow: "hidden" }}>
      <Freeze frame={Math.min(frame, SOURCE_TRAVEL_FRAMES)}>
        <OffthreadVideo src={staticFile("videos/hero-office-source.mp4")} trimBefore={SOURCE_START_FRAME} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </Freeze>
      <MonitorGleam />
    </AbsoluteFill>
  );
}
