import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FolderSearch, Lock } from "lucide-react";

import { RepositoryScanButton } from "@/components/repository-scan-button";
import { LiveRefresh } from "@/components/live-refresh";
import { Button } from "@/components/ui/button";
import { fetchRepositoryApiImpact, fetchRepositoryApiUsage, listRepositories } from "@/lib/api";
import { KIND_LABEL, PROVIDER_LABEL } from "@/lib/api-change-format";
import { formatDate, timeAgo } from "@/lib/format";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Repository API usage" };

export default function RepositoryPage({ params }: PageProps<"/repositories/[id]">) {
  return <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground sm:px-8">Loading repository API usage...</div>}>
    <RepositoryDetail params={params} />
  </Suspense>;
}

async function RepositoryDetail({ params }: Pick<PageProps<"/repositories/[id]">, "params">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 sm:px-8">
        <h1 className="font-serif text-3xl">Repository API usage</h1>
        <p className="text-muted-foreground">Sign in with GitHub to see API calls and impacts in your repositories.</p>
        <Button asChild className="w-fit"><Link href={`/auth/github?returnTo=${encodeURIComponent(`/repositories/${id}`)}`}>Sign in with GitHub</Link></Button>
      </div>
    );
  }

  const repositories = await listRepositories(session.accessToken);
  const repository = repositories.find((item) => item.githubRepoId === id);
  if (!repository) notFound();
  const [usage, impact] = await Promise.all([
    fetchRepositoryApiUsage(session.accessToken, id),
    fetchRepositoryApiImpact(session.accessToken, id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <LiveRefresh active={usage?.latestScan?.status === "QUEUED" || usage?.latestScan?.status === "IN_PROGRESS"} />
      <Link href="/repositories" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Repositories
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 font-serif text-3xl tracking-tight sm:text-4xl">
            {repository.fullName}
            {repository.private && <Lock aria-label="Private" className="size-5 text-muted-foreground" />}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">API usage and confirmed changes affecting this repository.</p>
        </div>
        <RepositoryScanButton githubRepoId={id} />
      </header>

      <section aria-labelledby="scan-heading" className="corner-mark border bg-card p-5">
        <h2 id="scan-heading" className="text-lg font-semibold">Scan status</h2>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span>Latest: {usage?.latestScan ? `${usage.latestScan.status.toLowerCase()} ${timeAgo(usage.latestScan.createdAt)}` : "never scanned"}</span>
          {usage?.usageScan && <span>Usage from {usage.usageScan.commitSha?.slice(0, 7) ?? "latest scan"} ({formatDate(usage.usageScan.updatedAt)})</span>}
        </div>
        {usage?.latestScan?.errorMessage && <p role="alert" className="mt-2 text-sm text-status-failed">{usage.latestScan.errorMessage}</p>}
      </section>

      <section aria-labelledby="usage-heading" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="usage-heading" className="font-serif text-2xl">API usage</h2>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">{usage?.usages.length ?? 0} {usage?.usages.length === 1 ? "call" : "calls"}</span>
        </div>
        {usage?.usages.length ? (
          <ul className="grid gap-3">
            {usage.usages.map((call, index) => (
              <li key={`${call.file}:${call.line}:${index}`} className="corner-mark min-w-0 border bg-card p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{PROVIDER_LABEL[call.provider]}</span>
                  <span className="font-mono text-xs text-muted-foreground">{call.style}{call.method ? ` · ${call.method}` : ""}</span>
                  {call.dynamic && <span className="label-mono text-status-running">dynamic values</span>}
                </div>
                <p className="mt-2 break-all font-mono text-sm">{call.operation ?? "Operation unknown"}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{call.file}:{call.line}</p>
                {(call.params.length > 0 || call.modelIds.length > 0) && (
                  <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
                    {call.params.length > 0 && <div><dt className="text-muted-foreground">Parameters</dt><dd className="break-all font-mono">{call.params.join(", ")}</dd></div>}
                    {call.modelIds.length > 0 && <div><dt className="text-muted-foreground">Models</dt><dd className="break-all font-mono">{call.modelIds.join(", ")}</dd></div>}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 border border-dashed p-6 text-sm text-muted-foreground">
            <FolderSearch aria-hidden className="size-5 shrink-0" />
            {usage?.usageScan ? "No Anthropic or OpenAI calls found in the latest completed scan." : "Run a scan to find Anthropic and OpenAI calls."}
          </div>
        )}
      </section>

      <section aria-labelledby="impact-heading" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="impact-heading" className="font-serif text-2xl">Impacts</h2>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">{impact?.impacts.length ?? 0} {impact?.impacts.length === 1 ? "change" : "changes"}</span>
        </div>
        {impact?.impacts.length ? (
          <ul className="grid gap-3">
            {impact.impacts.map((item) => (
              <li key={item.changeId} className="corner-mark min-w-0 border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{PROVIDER_LABEL[item.provider]}</span>
                  <span className="text-muted-foreground">{KIND_LABEL[item.kind]}</span>
                  <span className={item.confidence === "confirmed" ? "text-status-completed" : "text-status-running"}>{item.confidence}</span>
                </div>
                <p className="mt-2 break-all font-mono text-sm">{item.field ?? item.operation ?? "Provider behavior"}{item.replacement && ` → ${item.replacement}`}</p>
                <p className="mt-1 text-xs text-muted-foreground">Detected {timeAgo(item.detectedAt)}{item.effectiveAt && ` · Effective ${item.effectiveAt}`}</p>
                <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{item.files.join(", ")}</p>
                {item.migration && (
                  <Link href={`/jobs/${item.migration.id}`} className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Migration {item.migration.status.toLowerCase()} <ArrowUpRight aria-hidden className="size-4" />
                  </Link>
                )}
                {item.migration?.pullRequestUrl && (
                  <a href={item.migration.pullRequestUrl} target="_blank" rel="noreferrer" className="ml-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Pull request <ArrowUpRight aria-hidden className="size-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="border border-dashed p-6 text-sm text-muted-foreground">No confirmed provider changes currently impact this repository.</p>}
      </section>
    </div>
  );
}
