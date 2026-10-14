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
 * The worker writes one log row per stage as it reaches it, so the furthest
 * stage seen is where the job is now: still running, or where it failed.
 */
export function pipelineStages(steps: LogStep[], status: JobStatus): StageView[] {
  const reached = PIPELINE_STAGES.reduce((furthest, stage, index) => (steps.includes(stage) ? index : furthest), -1);

  return PIPELINE_STAGES.map((stage, index) => {
    let state: StageState = "pending";
    if (status === "COMPLETED" || index < reached) {
      state = "done";
    } else if (index === reached) {
      state = status === "FAILED" ? "failed" : status === "IN_PROGRESS" ? "running" : "done";
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
