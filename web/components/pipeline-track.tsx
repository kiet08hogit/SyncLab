import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { describePipeline, pipelineStages, type StageState } from "@/lib/pipeline";
import type { JobStatus, LogStep } from "@/lib/types";

const SEGMENT: Record<StageState, string> = {
  done: "bg-status-completed",
  running: "bg-status-running motion-safe:animate-pulse",
  failed: "bg-status-failed",
  pending: "bg-foreground/12",
};

/** One segment per sandbox stage. Sized for a table cell. */
export function PipelineTrackCompact({ steps, status }: { steps: LogStep[]; status: JobStatus }) {
  const stages = pipelineStages(steps, status);
  const description = describePipeline(stages, status);

  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={description} className="flex w-36 gap-1">
        {stages.map((stage) => (
          <span key={stage.stage} className={cn("h-1.5 flex-1", SEGMENT[stage.state])} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  );
}

const STOP: Record<StageState, string> = {
  done: "border-status-completed bg-status-completed text-primary-foreground",
  running: "border-status-running bg-status-running/15 text-status-running",
  failed: "border-status-failed bg-status-failed text-background",
  pending: "border-foreground/20 bg-background text-muted-foreground",
};

const LINE: Record<StageState, string> = {
  done: "bg-status-completed",
  running: "bg-linear-to-r from-status-completed to-status-running",
  failed: "bg-status-failed/40",
  pending: "bg-foreground/15",
};

const STATE_TEXT: Record<StageState, string> = {
  done: "Passed",
  running: "Running",
  failed: "Failed",
  pending: "Not reached",
};

/**
 * The full track: one labelled stop per stage, joined like a route line.
 * Labels follow the track's own width rather than the screen's, because a
 * half-width dashboard card is as narrow as a phone. Below 28rem eight labels
 * collide, so they give way to a single caption naming the current stage.
 */
export function PipelineTrack({ steps, status }: { steps: LogStep[]; status: JobStatus }) {
  const stages = pipelineStages(steps, status);

  return (
    <div className="@container">
      <ol aria-label={describePipeline(stages, status)} className="grid grid-cols-8">
        {stages.map((stage, index) => (
          <li key={stage.stage} className="relative flex flex-col items-center gap-2 text-center">
            {index > 0 && (
              <span
                aria-hidden
                className={cn("absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2", LINE[stage.state])}
              />
            )}
            <span
              className={cn(
                "relative z-10 grid size-7 place-items-center border-2 text-xs font-semibold",
                STOP[stage.state],
              )}
            >
              {stage.state === "done" ? (
                <Check aria-hidden className="size-3.5" strokeWidth={3} />
              ) : stage.state === "failed" ? (
                <X aria-hidden className="size-3.5" strokeWidth={3} />
              ) : stage.state === "running" ? (
                <span aria-hidden className="relative size-2.5">
                  <span className="absolute inset-0 bg-status-running/60 motion-safe:animate-ping" />
                  <span className="absolute inset-0 bg-status-running" />
                </span>
              ) : (
                <span aria-hidden className="tabular-nums">
                  {index + 1}
                </span>
              )}
            </span>
            <span className="flex flex-col @max-md:sr-only">
              <span
                className={cn(
                  "text-[11px] leading-tight font-medium @xl:text-sm",
                  stage.state === "pending" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                <span aria-hidden className="@xl:hidden">
                  {stage.shortLabel}
                </span>
                <span className="@max-xl:sr-only">{stage.label}</span>
              </span>
              <span className="sr-only">{STATE_TEXT[stage.state]}</span>
            </span>
          </li>
        ))}
      </ol>
      <p aria-hidden className="mt-3 text-center text-xs text-muted-foreground @md:hidden">
        {describePipeline(stages, status)}
      </p>
    </div>
  );
}
