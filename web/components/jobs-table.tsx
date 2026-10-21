import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { PipelineTrackCompact } from "@/components/pipeline-track";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, timeAgo } from "@/lib/format";
import { jobTitle } from "@/lib/jobs";
import type { JobWithRepository } from "@/lib/types";

export function JobsTable({ jobs }: { jobs: JobWithRepository[] }) {
  return (
    <div className="corner-mark border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 pl-4 label-mono text-muted-foreground">Migration</TableHead>
            <TableHead className="h-10 label-mono text-muted-foreground max-xl:hidden">Repository</TableHead>
            <TableHead className="h-10 label-mono text-muted-foreground max-lg:hidden">Pipeline</TableHead>
            <TableHead className="h-10 label-mono text-muted-foreground">Status</TableHead>
            <TableHead className="h-10 label-mono text-muted-foreground max-sm:hidden">Updated</TableHead>
            <TableHead className="h-10 pr-4 text-right label-mono text-muted-foreground">
              <span aria-hidden className="sm:hidden">
                PR
              </span>
              <span className="max-sm:sr-only">Pull request</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id} className="relative">
              <TableCell className="py-3.5 pl-4">
                {/* Stretched link: the whole row opens the job, while the PR link keeps its own target. */}
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex items-baseline gap-2 font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                >
                  {jobTitle(job).name}
                  <span className="font-mono text-xs text-muted-foreground">{jobTitle(job).detail}</span>
                </Link>
                <span className="mt-0.5 block text-xs text-muted-foreground xl:hidden">{job.repository.fullName}</span>
              </TableCell>
              <TableCell className="text-muted-foreground max-xl:hidden">{job.repository.fullName}</TableCell>
              <TableCell className="max-lg:hidden">
                <PipelineTrackCompact steps={job.steps} status={job.status} kind={job.kind} />
              </TableCell>
              <TableCell>
                <StatusBadge status={job.status} />
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums max-sm:hidden">
                <time dateTime={job.updatedAt} title={formatDate(job.updatedAt)}>
                  {timeAgo(job.updatedAt)}
                </time>
              </TableCell>
              <TableCell className="pr-4 text-right">
                {job.pullRequestUrl ? (
                  <a
                    href={job.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="relative z-10 inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                  >
                    #{job.pullRequestUrl.split("/").at(-1)}
                    <ExternalLink aria-hidden className="size-3" />
                    <span className="sr-only">(opens on GitHub)</span>
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">None</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
