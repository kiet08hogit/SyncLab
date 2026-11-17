import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SampleDataNotice } from "@/components/sample-data-notice";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { getRepositories, getRepositoryApiUsage } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Repository API usage" };

export default function RepositoryPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<TableSkeleton rows={4} />}><RepositoryUsage params={params} /></Suspense>;
}

async function RepositoryUsage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,18}$/.test(id)) notFound();
  // Check installation access first; a registry 404 can also mean no scan yet.
  const repository = (await getRepositories()).find((repository) => repository.githubRepoId === id);
  if (!repository) notFound();
  const usage = await getRepositoryApiUsage(id);
  const latest = usage?.latestScan;
  const snapshot = usage?.usageScan;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex min-w-0 flex-col gap-3">
        <Link href="/repositories" className="w-fit text-sm text-muted-foreground underline underline-offset-4">All repositories</Link>
        <h1 className="break-words font-serif text-3xl font-normal tracking-tight sm:text-4xl">{repository.fullName}</h1>
        <p className="text-muted-foreground">API usage detected in this repository’s source code.</p>
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href={`/dashboard?repo=${encodeURIComponent(repository.fullName)}`}>View migration jobs</Link>
        </Button>
      </header>
      <SampleDataNotice returnTo={`/repositories/${id}`} message="Sign in with GitHub to see API usage on your own repositories." />
      <section aria-labelledby="scan-heading" className="flex flex-col gap-3 border bg-card p-4 sm:p-6">
        <h2 id="scan-heading" className="font-medium">Scan status</h2>
        <p>{latest ? `Latest scan: ${latest.status.replaceAll("_", " ").toLowerCase()}` : "No scans yet"}</p>
        {latest && <p className="text-sm text-muted-foreground">Latest scan updated <time dateTime={latest.updatedAt}>{formatDate(latest.updatedAt)}</time></p>}
        {latest?.status === "FAILED" && <p role="status" className="break-words text-sm text-status-failed">{latest.errorMessage || "The latest scan failed."}</p>}
        {snapshot && usage ? (
          <p className="break-words text-sm text-muted-foreground">
            Showing {usage.usages.length} detected {usage.usages.length === 1 ? "call" : "calls"} from the last completed scan, finished <time dateTime={snapshot.updatedAt}>{formatDate(snapshot.updatedAt)}</time>
            {snapshot.commitSha ? <> at commit <code>{snapshot.commitSha.slice(0, 12)}</code></> : null}.
            {latest?.id !== snapshot.id && " The latest scan has not replaced these results."}
          </p>
        ) : latest?.status === "QUEUED" || latest?.status === "IN_PROGRESS" ? (
          <p className="text-sm text-muted-foreground">Usage will appear when the pending scan completes.</p>
        ) : <p className="text-sm text-muted-foreground">Usage will appear after a scan completes. Push to the default branch to trigger a scan.</p>}
      </section>
      <section aria-labelledby="usage-heading" className="flex flex-col gap-4">
        <h2 id="usage-heading" className="font-serif text-2xl">Detected API calls</h2>
        {snapshot && usage?.usages.length === 0 && <p className="border border-dashed p-6 text-sm text-muted-foreground">No supported API calls were detected in the last completed scan.</p>}
        <ul className="grid min-w-0 gap-4">
          {usage?.usages.map((call, index) => (
            <li key={`${call.file}:${call.line}:${index}`} className="flex min-w-0 flex-col gap-3 border bg-card p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="label-mono">{call.provider}</span>
                <span className="text-sm text-muted-foreground">{call.style}{call.method ? ` · ${call.method}` : ""}{call.dynamic ? " · Dynamic values" : ""}</span>
              </div>
              <p className="break-all font-mono text-sm">{call.file}:{call.line}</p>
              <p className="break-all font-mono text-sm">{call.operation || "Operation unresolved"}</p>
              <dl className="grid gap-2 text-sm">
                <div><dt className="text-muted-foreground">Models</dt><dd className="break-all font-mono">{call.modelIds.join(", ") || "Not statically resolved"}</dd></div>
                <div><dt className="text-muted-foreground">Parameters</dt><dd className="break-all font-mono">{call.params.join(", ") || "None detected"}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
