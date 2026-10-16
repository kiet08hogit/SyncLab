import { describe, expect, it } from "vitest";

import { describePipeline, pipelineStages, type StageState } from "@/lib/pipeline";
import type { JobStatus, LogStep } from "@/lib/types";

function states(steps: LogStep[], status: JobStatus): StageState[] {
  return pipelineStages(steps, status).map((stage) => stage.state);
}

function summary(steps: LogStep[], status: JobStatus): string {
  return describePipeline(pipelineStages(steps, status), status);
}

describe("pipelineStages", () => {
  it("leaves every stage pending while the job waits for a worker", () => {
    expect(states([], "QUEUED")).toEqual(Array(7).fill("pending"));
    expect(summary([], "QUEUED")).toBe("Waiting for a worker");
  });

  it("runs the first stage once the sandbox has started", () => {
    expect(states(["STARTED"], "IN_PROGRESS")).toEqual([
      "running",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(summary(["STARTED"], "IN_PROGRESS")).toBe("Running clone (stage 1 of 7)");
  });

  it("runs the stage after the last one logged", () => {
    expect(states(["STARTED", "CLONE", "INSTALL", "UPGRADE"], "IN_PROGRESS")).toEqual([
      "done",
      "done",
      "done",
      "running",
      "pending",
      "pending",
      "pending",
    ]);
    expect(summary(["STARTED", "CLONE", "INSTALL", "UPGRADE"], "IN_PROGRESS")).toBe(
      "Running changelog (stage 4 of 7)",
    );
  });

  it("says the job is starting before the STARTED row is flushed", () => {
    expect(states([], "IN_PROGRESS")).toEqual(Array(7).fill("pending"));
    expect(summary([], "IN_PROGRESS")).toBe("Starting");
  });

  it("marks the last logged stage as the one that failed", () => {
    expect(states(["STARTED", "CLONE", "INSTALL", "TEST", "FAILED"], "FAILED")).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "failed",
      "pending",
    ]);
    expect(summary(["STARTED", "CLONE", "INSTALL", "TEST", "FAILED"], "FAILED")).toBe(
      "Failed at test (stage 6 of 7)",
    );
  });

  it("reports a failure before the sandbox ran any stage", () => {
    expect(states(["FAILED"], "FAILED")).toEqual(Array(7).fill("pending"));
    expect(summary(["FAILED"], "FAILED")).toBe("Failed before the sandbox started");
  });

  it("only counts the latest attempt after a retry", () => {
    const steps: LogStep[] = ["STARTED", "CLONE", "INSTALL", "UPGRADE", "FAILED", "STARTED", "CLONE"];
    expect(states(steps, "IN_PROGRESS")).toEqual([
      "done",
      "running",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("shows nothing running for a retry that is queued but not yet started", () => {
    // A retry moves the job back to QUEUED until a worker claims it again.
    expect(states(["STARTED", "CLONE", "FAILED"], "QUEUED")).toEqual(Array(7).fill("pending"));
  });

  it("fails the retried attempt at its own furthest stage", () => {
    const steps: LogStep[] = ["STARTED", "CLONE", "INSTALL", "UPGRADE", "FAILED", "STARTED", "CLONE", "FAILED"];
    expect(states(steps, "FAILED")).toEqual([
      "failed",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("passes every stage of a completed job, including one skipped on redelivery", () => {
    const steps: LogStep[] = ["STARTED", "CLONE", "INSTALL", "UPGRADE", "CHANGELOG", "REFACTOR", "TEST", "PR", "SKIPPED"];
    expect(states(steps, "COMPLETED")).toEqual(Array(7).fill("done"));
    expect(summary(steps, "COMPLETED")).toBe("All stages passed");
  });

  it("labels each stage, with short labels for narrow screens", () => {
    const stages = pipelineStages([], "QUEUED");
    expect(stages.map((stage) => stage.label)).toEqual([
      "Clone",
      "Install",
      "Upgrade",
      "Changelog",
      "Refactor",
      "Test",
      "Pull request",
    ]);
    expect(stages.find((stage) => stage.stage === "CHANGELOG")?.shortLabel).toBe("Notes");
    expect(stages.find((stage) => stage.stage === "PR")?.shortLabel).toBe("PR");
    expect(stages.find((stage) => stage.stage === "TEST")?.shortLabel).toBe("Test");
  });
});
