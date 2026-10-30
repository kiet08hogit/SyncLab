import { describe, expect, it } from "vitest";

import { heroCopyHidden, workspaceCamera } from "@/lib/workspace-camera";

describe("heroCopyHidden", () => {
  const viewport = 900;

  it("hides faded copy only while that copy intersects the viewport", () => {
    expect(heroCopyHidden(true, 0, 120, 400, viewport)).toBe(true);
    expect(heroCopyHidden(true, 0, -200, -1, viewport)).toBe(false);
    expect(heroCopyHidden(true, 0, viewport, viewport + 80, viewport)).toBe(false);
    expect(heroCopyHidden(true, 0, -40, 20, viewport)).toBe(true);
  });

  it("leaves visible copy and reduced-motion copy in the accessibility tree", () => {
    expect(heroCopyHidden(true, 1, 120, 400, viewport)).toBe(false);
    expect(heroCopyHidden(true, 0.02, 120, 400, viewport)).toBe(false);
    expect(heroCopyHidden(false, 0, 120, 400, viewport)).toBe(false);
  });

  it("fades the hero copy before the chapter ends", () => {
    expect(workspaceCamera(0).copy).toBe(1);
    expect(workspaceCamera(0.4).copy).toBe(0);
  });
});
