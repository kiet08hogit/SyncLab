import { PIPELINE_STAGES, type JobStatus, type LogStep, type PipelineStage } from "@/lib/types";

export type StageState = "done" | "running" | "failed" | "pending";

export interface StageView {
  stage: PipelineStage;
  label: string;
  /** For narrow screens, where six full labels do not fit side by side. */
  shortLabel: string;
  state: StageState;
}

const LABELS: Record<PipelineStage, string> = {
  CLONE: "Clone",
  INSTALL: "Install",
  CHANGELOG: "Changelog",
  REFACTOR: "Refactor",
  TEST: "Test",
  PR: "Pull request",
};

/**
 * The worker flushes a phase's log rows only once the phase finishes, failing
 * or not, and a retried job starts over with a new STARTED row. So within the
 * latest attempt the furthest logged stage is the last one to finish: a job in
 * progress is running the stage after it, and a failed job failed at it.
 */
export function pipelineStages(steps: LogStep[], status: JobStatus): StageView[] {
  const attempt = steps.slice(steps.lastIndexOf("STARTED") + 1);
  const reached = PIPELINE_STAGES.findLastIndex((stage) => attempt.includes(stage));
  const current = status === "FAILED" ? reached : reached + 1;

  return PIPELINE_STAGES.map((stage, index) => {
    let state: StageState = "pending";
    if (status === "COMPLETED" || (status !== "QUEUED" && index < current)) {
      state = "done";
    } else if (index === current && status === "FAILED") {
      state = "failed";
    } else if (index === current && status === "IN_PROGRESS") {
      state = "running";
    }
    return { stage, label: LABELS[stage], shortLabel: stage === "PR" ? "PR" : LABELS[stage], state };
  });
}

export function describePipeline(stages: StageView[], status: JobStatus): string {
  if (status === "QUEUED") return "Waiting for a worker";
  if (status === "COMPLETED") return "All stages passed";
  const current = stages.find((stage) => stage.state === "running" || stage.state === "failed");
  if (!current) return status === "FAILED" ? "Failed before the first stage" : "Not started";
  const position = stages.indexOf(current) + 1;
  const verb = current.state === "failed" ? "Failed at" : "Running";
  return `${verb} ${current.label.toLowerCase()} (stage ${position} of ${stages.length})`;
}
