import { Suspense } from "react";
import Link from "next/link";
import { Search, SearchX, X } from "lucide-react";

import { JobsTable } from "@/components/jobs-table";
import { RunningJobs } from "@/components/running-jobs";
import { OverviewSkeleton } from "@/components/skeletons";
import { StatusFilter } from "@/components/status-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getJobs, getStatusCounts } from "@/lib/data";
import { JOB_STATUSES, type JobStatus } from "@/lib/types";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function MigrationsPage({ searchParams }: PageProps<"/">) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Migrations</h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          Every published release SyncLab picks up becomes a job: cloned, upgraded, refactored, tested in a sandbox, and
          opened as a pull request.
        </p>
      </header>
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Overview({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const params = await searchParams;
  const statusParam = first(params.status);
  const status = JOB_STATUSES.find((value) => value === statusParam);
  const repository = first(params.repo) || undefined;
  const query = first(params.q)?.trim() || undefined;

  const [jobs, counts, running] = await Promise.all([
    getJobs({ status, repository, query }),
    getStatusCounts(),
    getJobs({ status: "IN_PROGRESS" }),
  ]);

  const hrefFor = (next: { status?: JobStatus; repo?: string; q?: string }) => {
    const search = new URLSearchParams();
    if (next.status) search.set("status", next.status);
    if (next.repo) search.set("repo", next.repo);
    if (next.q) search.set("q", next.q);
    const value = search.toString();
    return value ? `/?${value}` : "/";
  };

  const filtered = Boolean(status || repository || query);

  return (
    <>
      <StatusFilter
        counts={counts}
        active={status}
        hrefFor={(next) => hrefFor({ status: next, repo: repository, q: query })}
      />

      {!filtered && running.length > 0 && <RunningJobs jobs={running} />}

      <section aria-labelledby="jobs-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="jobs-heading" className="text-base font-semibold">
              {filtered ? `${jobs.length} matching ${jobs.length === 1 ? "job" : "jobs"}` : "All jobs"}
            </h2>
            {repository && (
              <Link
                href={hrefFor({ status, q: query })}
                className="inline-flex h-7 items-center gap-1 rounded-md border bg-secondary px-2 text-xs text-secondary-foreground hover:bg-accent"
              >
                {repository}
                <X aria-hidden className="size-3" />
                <span className="sr-only">Clear repository filter</span>
              </Link>
            )}
          </div>
          <form action="/" role="search" className="relative w-full sm:w-72">
            {status && <input type="hidden" name="status" value={status} />}
            {repository && <input type="hidden" name="repo" value={repository} />}
            <label htmlFor="job-search" className="sr-only">
              Search jobs
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="job-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Package, version, or repository"
              className="h-10 pl-9"
            />
          </form>
        </div>

        {jobs.length > 0 ? (
          <JobsTable jobs={jobs} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
            <SearchX aria-hidden className="size-6 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">No jobs match these filters</p>
              <p className="text-sm text-muted-foreground">Try another status, or clear the search to see every job.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Clear filters</Link>
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
