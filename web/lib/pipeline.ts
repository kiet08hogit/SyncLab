import { PIPELINE_STAGES, type JobStatus, type PipelineStage, type StepResult } from "@/lib/types";

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
 * The worker flushes a phase's log rows only once the phase finishes, so a
 * logged stage has completed, or failed if it logged a nonzero exit code. A job
 * in progress is running the first stage after the furthest one logged. A
 * failed job failed at its last stage with a nonzero exit code, or else at the
 * first stage after the furthest one logged.
 */
export function pipelineStages(steps: StepResult[], status: JobStatus): StageView[] {
  const reached = PIPELINE_STAGES.findLastIndex((stage) => steps.some((step) => step.step === stage));
  const exited = steps.findLast((step) => step.exitCode !== null && step.exitCode !== 0)?.step;
  const exitedIndex = PIPELINE_STAGES.findIndex((stage) => stage === exited);
  const current = status === "FAILED" && exitedIndex !== -1 ? exitedIndex : reached + 1;

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
  if (!current) return "Not started";
  const position = stages.indexOf(current) + 1;
  const verb = current.state === "failed" ? "Failed at" : "Running";
  return `${verb} ${current.label.toLowerCase()} (stage ${position} of ${stages.length})`;
}
