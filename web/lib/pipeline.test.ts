import { describe, expect, it } from "vitest";

import { describePipeline, latestRunDuration, pipelineStages, type StageState } from "@/lib/pipeline";
import type { JobStatus, LogStep } from "@/lib/types";

function states(steps: LogStep[], status: JobStatus): StageState[] {
  return pipelineStages(steps, status).map((stage) => stage.state);
}

function summary(steps: LogStep[], status: JobStatus): string {
  return describePipeline(pipelineStages(steps, status), status);
}

const PENDING = Array(8).fill("pending");

describe("pipelineStages", () => {
  it("leaves every stage pending while the job waits for a worker", () => {
    expect(states([], "QUEUED")).toEqual(PENDING);
    expect(summary([], "QUEUED")).toBe("Waiting for a worker");
  });

  it("runs the first stage once the sandbox has started", () => {
    expect(states(["STARTED"], "IN_PROGRESS")).toEqual(["running", ...PENDING.slice(1)]);
    expect(summary(["STARTED"], "IN_PROGRESS")).toBe("Running clone (stage 1 of 8)");
  });

  it("runs the stage after the last one logged", () => {
    const steps: LogStep[] = ["STARTED", "CLONE", "CHANGELOG", "INSTALL", "BASELINE"];
    expect(states(steps, "IN_PROGRESS")).toEqual([
      "done",
      "done",
      "done",
      "done",
      "running",
      "pending",
      "pending",
      "pending",
    ]);
    expect(summary(steps, "IN_PROGRESS")).toBe("Running upgrade (stage 5 of 8)");
  });

  it("says the job is starting before the STARTED row is flushed", () => {
    expect(states([], "IN_PROGRESS")).toEqual(PENDING);
    expect(summary([], "IN_PROGRESS")).toBe("Starting");
  });

  it("marks the last logged stage as the one that failed", () => {
    const steps: LogStep[] = ["STARTED", "CLONE", "CHANGELOG", "INSTALL", "BASELINE", "UPGRADE", "REFACTOR", "TEST", "FAILED"];
    expect(states(steps, "FAILED")).toEqual(["done", "done", "done", "done", "done", "done", "failed", "pending"]);
    expect(summary(steps, "FAILED")).toBe("Failed at test (stage 7 of 8)");
  });

  it("reports a failure before the sandbox ran any stage", () => {
    expect(states(["FAILED"], "FAILED")).toEqual(PENDING);
    expect(summary(["FAILED"], "FAILED")).toBe("Failed before the sandbox started");
  });

  it("only counts the latest attempt after a retry", () => {
    const steps: LogStep[] = ["STARTED", "CLONE", "CHANGELOG", "INSTALL", "FAILED", "STARTED", "CLONE"];
    expect(states(steps, "IN_PROGRESS")).toEqual(["done", "running", ...PENDING.slice(2)]);
  });

  it("shows nothing running for a retry that is queued but not yet started", () => {
    // A retry moves the job back to QUEUED until a worker claims it again.
    expect(states(["STARTED", "CLONE", "FAILED"], "QUEUED")).toEqual(PENDING);
  });

  it("fails the retried attempt at its own furthest stage", () => {
    const steps: LogStep[] = ["STARTED", "CLONE", "CHANGELOG", "INSTALL", "FAILED", "STARTED", "CLONE", "FAILED"];
    expect(states(steps, "FAILED")).toEqual(["failed", ...PENDING.slice(1)]);
  });

  it("passes every stage of a completed job, including one skipped on redelivery", () => {
    const steps: LogStep[] = [
      "STARTED",
      "CLONE",
      "CHANGELOG",
      "INSTALL",
      "BASELINE",
      "UPGRADE",
      "REFACTOR",
      "TEST",
      "PR",
      "SKIPPED",
    ];
    expect(states(steps, "COMPLETED")).toEqual(Array(8).fill("done"));
    expect(summary(steps, "COMPLETED")).toBe("All stages passed");
  });

  it("labels each stage, with short labels for narrow screens", () => {
    const stages = pipelineStages([], "QUEUED");
    expect(stages.map((stage) => stage.label)).toEqual([
      "Clone",
      "Changelog",
      "Install",
      "Baseline",
      "Upgrade",
      "Refactor",
      "Test",
      "Pull request",
    ]);
    expect(stages.find((stage) => stage.stage === "CHANGELOG")?.shortLabel).toBe("Notes");
    expect(stages.find((stage) => stage.stage === "PR")?.shortLabel).toBe("PR");
    expect(stages.find((stage) => stage.stage === "BASELINE")?.shortLabel).toBe("Baseline");
  });
});

describe("pipelineStages, against the order the sandbox logs", () => {
  // prepare logs CLONE then CHANGELOG, then install, the baseline test run and
  // the upgrade each log one row, before refactor, test and publish.
  const order: LogStep[] = ["STARTED", "CLONE", "CHANGELOG", "INSTALL", "BASELINE", "UPGRADE", "REFACTOR", "TEST", "PR"];

  it("runs install, not a later stage, right after prepare", () => {
    expect(summary(order.slice(0, 3), "IN_PROGRESS")).toBe("Running install (stage 3 of 8)");
  });

  it("shows the baseline test run as its own stage", () => {
    expect(summary(order.slice(0, 4), "IN_PROGRESS")).toBe("Running baseline (stage 4 of 8)");
    expect(summary([...order.slice(0, 5), "FAILED"], "FAILED")).toBe("Failed at baseline (stage 4 of 8)");
  });

  it("walks every stage in order", () => {
    for (let logged = 1; logged < order.length - 1; logged++) {
      const view = states(order.slice(0, logged + 1), "IN_PROGRESS");
      expect(view.slice(0, logged)).toEqual(Array(logged).fill("done"));
      expect(view[logged]).toBe("running");
    }
  });
});

describe("latestRunDuration", () => {
  const at = (minute: number, second = 0) => `2026-10-16T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`;
  const log = (step: LogStep, minute: number, second = 0) => ({ step, createdAt: at(minute, second) });

  it("measures a completed run from STARTED to its last log row", () => {
    const executionLogs = [log("STARTED", 0), log("CLONE", 1), log("PR", 4)];
    expect(latestRunDuration({ status: "COMPLETED", executionLogs })).toBe(240_000);
  });

  it("ignores SKIPPED rows that redeliveries append to a completed job", () => {
    const executionLogs = [log("STARTED", 0), log("PR", 4), log("SKIPPED", 50)];
    expect(latestRunDuration({ status: "COMPLETED", executionLogs })).toBe(240_000);
  });

  it("measures only the latest attempt after a retry", () => {
    const executionLogs = [log("STARTED", 0), log("FAILED", 1), log("STARTED", 5), log("CLONE", 6), log("FAILED", 7)];
    expect(latestRunDuration({ status: "FAILED", executionLogs })).toBe(120_000);
  });

  it("keeps the previous run's duration when a retry fails to enqueue", () => {
    // The gateway sets the job back to FAILED without logging a new row.
    const executionLogs = [log("STARTED", 0), log("CLONE", 1), log("FAILED", 3)];
    expect(latestRunDuration({ status: "FAILED", executionLogs })).toBe(180_000);
  });

  it("has nothing to measure when the latest attempt failed before it started", () => {
    const executionLogs = [log("STARTED", 0), log("FAILED", 1), log("FAILED", 5)];
    expect(latestRunDuration({ status: "FAILED", executionLogs })).toBeNull();
    expect(latestRunDuration({ status: "FAILED", executionLogs: [log("FAILED", 0)] })).toBeNull();
  });

  it("leaves queued and running jobs alone", () => {
    const executionLogs = [log("STARTED", 0)];
    expect(latestRunDuration({ status: "IN_PROGRESS", executionLogs })).toBeNull();
    expect(latestRunDuration({ status: "QUEUED", executionLogs })).toBeNull();
  });
});
