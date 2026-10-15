import { PIPELINE_STAGES, type JobStatus, type LogStep, type PipelineStage } from "@/lib/types";

export type StageState = "done" | "running" | "failed" | "pending";

export interface StageView {
  stage: PipelineStage;
  label: string;
  /** For narrow screens, where seven full labels do not fit side by side. */
  shortLabel: string;
  state: StageState;
}

const SHORT_LABELS: Partial<Record<PipelineStage, string>> = { CHANGELOG: "Notes", PR: "PR" };

const LABELS: Record<PipelineStage, string> = {
  CLONE: "Clone",
  INSTALL: "Install",
  UPGRADE: "Upgrade",
  CHANGELOG: "Changelog",
  REFACTOR: "Refactor",
  TEST: "Test",
  PR: "Pull request",
};

/**
 * The worker flushes a phase's log rows only once the phase finishes, failing
 * or not. Each attempt ends with a FAILED row and a retry logs a new STARTED
 * row once it reaches the sandbox, so an attempt is the rows after the latest
 * STARTED or FAILED. Within it the furthest logged stage is the last one to
 * finish: a job in progress is running the stage after it, and a failed job
 * failed at it. A job with no stage in its attempt has not reached the sandbox.
 */
export function pipelineStages(steps: LogStep[], status: JobStatus): StageView[] {
  const rows = status === "FAILED" && steps.at(-1) === "FAILED" ? steps.slice(0, -1) : steps;
  const boundary = Math.max(rows.lastIndexOf("STARTED"), rows.lastIndexOf("FAILED"));
  const reached = PIPELINE_STAGES.findLastIndex((stage) => rows.slice(boundary + 1).includes(stage));
  const current = status === "FAILED" ? reached : rows[boundary] === "STARTED" ? reached + 1 : -1;

  return PIPELINE_STAGES.map((stage, index) => {
    let state: StageState = "pending";
    if (status === "COMPLETED" || (status !== "QUEUED" && index < current)) {
      state = "done";
    } else if (index === current && status === "FAILED") {
      state = "failed";
    } else if (index === current && status === "IN_PROGRESS") {
      state = "running";
    }
    return { stage, label: LABELS[stage], shortLabel: SHORT_LABELS[stage] ?? LABELS[stage], state };
  });
}

export function describePipeline(stages: StageView[], status: JobStatus): string {
  if (status === "QUEUED") return "Waiting for a worker";
  if (status === "COMPLETED") return "All stages passed";
  const current = stages.find((stage) => stage.state === "running" || stage.state === "failed");
  if (!current) return status === "FAILED" ? "Failed before the sandbox started" : "Starting";
  const position = stages.indexOf(current) + 1;
  const verb = current.state === "failed" ? "Failed at" : "Running";
  return `${verb} ${current.label.toLowerCase()} (stage ${position} of ${stages.length})`;
}
