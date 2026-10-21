import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleX, ExternalLink, GitBranch, Hourglass } from "lucide-react";

import { PipelineTrack } from "@/components/pipeline-track";
import { LiveRefresh } from "@/components/live-refresh";
import { LogOutput } from "@/components/log-output";
import { RetryButton } from "@/components/retry-button";
import { JobSkeleton } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getJob, isLive, isSampleJob } from "@/lib/data";
import { formatClock, formatDate, formatDuration, splitExitCode, timeAgo } from "@/lib/format";
import { jobBranch, jobTitle } from "@/lib/jobs";
import { latestRunDuration } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">): Promise<Metadata> {
  const job = await getJob((await params).id);
  if (!job) return { title: "Job not found" };
  const { name, detail } = jobTitle(job);
  return { title: `${name} ${detail}` };
}

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Migrations
      </Link>
      <Suspense fallback={<JobSkeleton />}>
        <JobDetailView params={params} />
      </Suspense>
    </div>
  );
}

async function JobDetailView({ params }: Pick<PageProps<"/jobs/[id]">, "params">) {
  const job = await getJob((await params).id);
  if (!job) notFound();
  // Sample jobs are not in the API, so only a signed-in user's real job can be
  // retried. Retrying starts the same dependency migration again, which an
  // API change has no trigger for.
  const canRetry =
    job.status === "FAILED" && job.kind === "dependency" && !isSampleJob(job.id) && (await isLive());
  const duration = latestRunDuration(job);
  const title = jobTitle(job);
  const change = job.kind === "api_change" ? job.breakingChange : null;

  return (
    <>
      <LiveRefresh active={job.status === "QUEUED" || job.status === "IN_PROGRESS"} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-baseline gap-2.5 font-serif text-3xl font-normal tracking-tight sm:text-4xl">
              {title.name}
              <span className="font-mono text-lg font-normal text-muted-foreground sm:text-xl">
                {title.detail}
              </span>
            </h1>
            <StatusBadge status={job.status} />
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <div className="flex gap-1.5">
              <dt className="sr-only">Repository</dt>
              <dd>
                <a
                  href={`https://github.com/${job.repository.fullName}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground hover:underline"
                >
                  {job.repository.fullName}
                </a>
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>
                <GitBranch aria-hidden className="size-3.5" />
                <span className="sr-only">Branch</span>
              </dt>
              <dd className="font-mono text-xs">{jobBranch(job)}</dd>
            </div>
            {change?.replacement && (
              <div className="flex gap-1.5">
                <dt>Replace with</dt>
                <dd className="font-mono text-xs">{change.replacement}</dd>
              </div>
            )}
            {change && (
              <div className="flex gap-1.5">
                <dt>Deadline</dt>
                <dd>{change.effectiveAt ?? "None announced"}</dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt>Queued</dt>
              <dd>
                <time dateTime={job.createdAt} title={formatDate(job.createdAt)}>
                  {timeAgo(job.createdAt)}
                </time>
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Updated</dt>
              <dd>
                <time dateTime={job.updatedAt} title={formatDate(job.updatedAt)}>
                  {timeAgo(job.updatedAt)}
                </time>
              </dd>
            </div>
            {duration !== null && (
              <div className="flex gap-1.5">
                <dt>Took</dt>
                <dd className="tabular-nums">{formatDuration(duration)}</dd>
              </div>
            )}
          </dl>
        </div>
        {canRetry && <RetryButton jobId={job.id} />}
        {job.pullRequestUrl && (
          <Button asChild className="w-fit">
            <a href={job.pullRequestUrl} target="_blank" rel="noreferrer">
              Open pull request #{job.pullRequestUrl.split("/").at(-1)}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        )}
      </header>

      {job.status === "FAILED" && job.errorMessage && (
        <div className="flex gap-3 border border-status-failed/30 bg-status-failed/10 p-4">
          <CircleX aria-hidden className="mt-0.5 size-5 shrink-0 text-status-failed" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Migration failed</p>
            <p className="text-sm text-foreground/85">{job.errorMessage}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="pipeline-heading" className="corner-mark flex flex-col gap-5 border bg-card p-5 sm:p-6">
        <h2 id="pipeline-heading" className="label-mono text-muted-foreground">
          Pipeline
        </h2>
        <PipelineTrack steps={job.steps} status={job.status} kind={job.kind} />
      </section>

      <section aria-labelledby="log-heading" className="flex flex-col gap-3">
        <h2 id="log-heading" className="label-mono text-muted-foreground">
          Execution log
        </h2>
        {job.executionLogs.length === 0 ? (
          <div className="flex items-center gap-3 border border-dashed px-5 py-8 text-sm text-muted-foreground">
            <Hourglass aria-hidden className="size-5 shrink-0" />
            Waiting for a worker to claim this job. Log entries appear here as each stage starts.
          </div>
        ) : (
          <ol className="corner-mark flex flex-col border bg-card">
            {job.executionLogs.map((log) => {
              const { exitCode, body } = splitExitCode(log.output);
              const failed = log.step === "FAILED" || (exitCode !== null && exitCode !== 0);
              return (
                <li key={log.id} className="flex flex-col gap-2 border-b px-4 py-3.5 last:border-b-0 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={cn("text-sm font-semibold", failed ? "text-status-failed" : "text-foreground")}>
                      {log.step}
                    </span>
                    <time
                      dateTime={log.createdAt}
                      title={formatDate(log.createdAt)}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {formatClock(log.createdAt)}
                    </time>
                    {exitCode !== null && (
                      <span
                        className={cn(
                          "px-1.5 py-0.5 font-mono text-xs",
                          exitCode === 0
                            ? "bg-status-completed/12 text-status-completed"
                            : "bg-status-failed/12 text-status-failed",
                        )}
                      >
                        exit {exitCode}
                      </span>
                    )}
                  </div>
                  {body && <LogOutput body={body} failed={failed} />}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}
