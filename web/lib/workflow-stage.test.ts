import { describe, expect, it } from "vitest";

import { nextWorkflowStage } from "@/lib/workflow-stage";

describe("nextWorkflowStage", () => {
  it("moves forward and backward from the selected stage, wrapping at the ends", () => {
    expect(nextWorkflowStage(4, "ArrowRight", 5)).toBe(0);
    expect(nextWorkflowStage(4, "ArrowLeft", 5)).toBe(3);
    expect(nextWorkflowStage(0, "ArrowRight", 5)).toBe(1);
    expect(nextWorkflowStage(0, "ArrowLeft", 5)).toBe(4);
    expect(nextWorkflowStage(2, "ArrowRight", 5)).toBe(3);
  });

  it("sends Home and End to the first and last stages", () => {
    expect(nextWorkflowStage(3, "Home", 5)).toBe(0);
    expect(nextWorkflowStage(1, "End", 5)).toBe(4);
  });
});
