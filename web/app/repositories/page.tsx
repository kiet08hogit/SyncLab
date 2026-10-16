import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { FolderGit2, Lock } from "lucide-react";

import { SampleDataNotice } from "@/components/sample-data-notice";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRepositories } from "@/lib/data";
import { formatDate, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Repositories" };

export default function RepositoriesPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">Repositories</h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          Every repository the SyncLab GitHub App can reach through your installations, with the migrations SyncLab has
          run on each.
        </p>
      </header>

      <Suspense fallback={<TableSkeleton rows={4} />}>
        <RepositoryTable />
      </Suspense>
    </div>
  );
}

async function RepositoryTable() {
  const repositories = await getRepositories();

  if (repositories.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 border border-dashed px-6 py-16 text-center">
        <FolderGit2 aria-hidden className="size-6 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">No repositories yet</p>
          <p className="text-sm text-muted-foreground">
            Install the SyncLab GitHub App on a repository, and it shows up here.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings">Go to installations</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <SampleDataNotice returnTo="/repositories" />
      <div className="corner-mark border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 pl-4 label-mono text-muted-foreground">Repository</TableHead>
              <TableHead className="h-10 text-right label-mono text-muted-foreground">Jobs</TableHead>
              <TableHead className="h-10 text-right label-mono text-muted-foreground max-md:hidden">Active</TableHead>
              <TableHead className="h-10 text-right label-mono text-muted-foreground max-md:hidden">
                Completed
              </TableHead>
              <TableHead className="h-10 text-right label-mono text-muted-foreground max-md:hidden">Failed</TableHead>
              <TableHead className="h-10 pr-4 text-right label-mono text-muted-foreground">Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repositories.map((repository) => (
              <TableRow key={repository.githubRepoId} className="relative">
                <TableCell className="py-3.5 pl-4">
                  <Link
                    href={`/?repo=${encodeURIComponent(repository.fullName)}`}
                    className="flex flex-col gap-0.5 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      {repository.fullName}
                      {repository.private && <Lock aria-label="Private" className="size-3.5 text-muted-foreground" />}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      installation {repository.installationId}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{repository.jobCount}</TableCell>
                <TableCell className="text-right tabular-nums max-md:hidden">
                  <span className={repository.active ? "text-status-running" : "text-muted-foreground"}>
                    {repository.active}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums max-md:hidden">
                  <span className={repository.completed ? "text-status-completed" : "text-muted-foreground"}>
                    {repository.completed}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums max-md:hidden">
                  <span className={repository.failed ? "text-status-failed" : "text-muted-foreground"}>
                    {repository.failed}
                  </span>
                </TableCell>
                <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">
                  {repository.lastActivityAt ? (
                    <time dateTime={repository.lastActivityAt} title={formatDate(repository.lastActivityAt)}>
                      {timeAgo(repository.lastActivityAt)}
                    </time>
                  ) : (
                    "No jobs yet"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
