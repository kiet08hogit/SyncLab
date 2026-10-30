import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PipelineTrack } from "@/components/pipeline-track";
import { timeAgo } from "@/lib/format";
import { jobTitle } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import type { JobWithRepository } from "@/lib/types";

/** Jobs a worker holds right now. */
export function RunningJobs({ jobs, stacked = false }: { jobs: JobWithRepository[]; stacked?: boolean }) {
  return (
    <section aria-labelledby="running-heading" className="flex flex-col gap-3">
      <h2 id="running-heading" className="label-mono text-muted-foreground">
        Running now
      </h2>
      <ul className={cn("grid gap-3", !stacked && "lg:grid-cols-2")}>
        {jobs.map((job) => (
          <li key={job.id} className="corner-mark border border-l-[3px] border-l-status-running/70 bg-card">
            <Link
              href={`/jobs/${job.id}`}
              className="group flex flex-col gap-5 p-4 sm:p-5 transition-colors hover:bg-accent/40 focus-visible:-outline-offset-2"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex items-baseline gap-2 text-lg font-semibold">
                    {jobTitle(job).name}
                    <span className="font-mono text-sm font-normal text-status-running">{jobTitle(job).detail}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {job.repository.fullName} · started {timeAgo(job.createdAt)}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                  View logs
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                </span>
              </div>
              <PipelineTrack steps={job.steps} status={job.status} kind={job.kind} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
