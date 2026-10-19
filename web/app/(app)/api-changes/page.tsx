import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { FlaskConical, Radar, SearchX } from "lucide-react";

import { ChangeFilters, ChangesTable, changesHref, ProviderCards } from "@/components/api-monitor";
import { ReviewProvider } from "@/components/review-buttons";
import { PollButton } from "@/components/poll-button";
import { SampleDataNotice } from "@/components/sample-data-notice";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiChanges, getApiProviders, type MonitorSource } from "@/lib/api-changes";
import {
  API_CHANGE_KINDS,
  API_CHANGE_STATUSES,
  API_PROVIDERS,
  type ApiChangeFilter,
  type ApiProviderSummary,
} from "@/lib/types";

export const metadata: Metadata = { title: "API changes" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find((candidate) => candidate === value);
}

export default function ApiChangesPage({ searchParams }: PageProps<"/api-changes">) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">API changes</h1>
          <p className="max-w-2xl text-pretty text-muted-foreground">
            SyncLab watches the Anthropic and OpenAI APIs for breaking changes, reading each one from the
            provider&apos;s own pages. Every change it finds here is one a migration can fix before it lands.
          </p>
        </div>
        <Suspense fallback={<Skeleton className="h-10 w-32" />}>
          <Poll />
        </Suspense>
      </header>
      <Suspense fallback={<MonitorSkeleton />}>
        <Monitor searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** The oldest check across every source: the poll is done once even that one is newer. */
function oldestCheck(providers: ApiProviderSummary[]): string | null {
  const checks = providers.flatMap((provider) => provider.sources.map((source) => source.lastCheckedAt));
  if (checks.some((check) => check === null)) return null;
  return (checks as string[]).sort()[0] ?? null;
}

// Signed out, the sample notice below already says to sign in, so the button
// only explains itself on hover. With no monitor on the API, nothing else does.
const DISABLED_POLL: Partial<Record<MonitorSource, { reason: string; shown: boolean }>> = {
  sample: { reason: "Sign in to check the providers.", shown: false },
  unavailable: { reason: "Available once the API runs the change monitor.", shown: true },
};

async function Poll() {
  const { source, data } = await getApiProviders();
  const disabled = DISABLED_POLL[source];
  return (
    <PollButton checkedAt={oldestCheck(data)} disabledReason={disabled?.reason} showReason={disabled?.shown} />
  );
}

async function Monitor({ searchParams }: Pick<PageProps<"/api-changes">, "searchParams">) {
  const params = await searchParams;
  const filter: ApiChangeFilter = {
    provider: pick(API_PROVIDERS, first(params.provider)),
    status: pick(API_CHANGE_STATUSES, first(params.status)),
    kind: pick(API_CHANGE_KINDS, first(params.kind)),
  };
  const filtered = Boolean(filter.provider || filter.status || filter.kind);

  const [providers, changes] = await Promise.all([getApiProviders(), getApiChanges(filter)]);

  return (
    <>
      {providers.source === "sample" && (
        <SampleDataNotice
          returnTo="/api-changes"
          message="Sign in with GitHub to see the changes SyncLab's monitor has found."
        />
      )}
      {providers.source === "unavailable" && <MonitorUnavailableNotice />}

      <section aria-labelledby="providers-heading" className="flex flex-col gap-3">
        <h2 id="providers-heading" className="label-mono text-muted-foreground">
          Watched providers
        </h2>
        <ProviderCards providers={providers.data} />
      </section>

      <section aria-labelledby="changes-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3">
          <h2 id="changes-heading" className="label-mono text-muted-foreground">
            Breaking changes
          </h2>
          <ChangeFilters filter={filter} />
        </div>
        <ReviewProvider changeIds={changes.data.map((change) => change.id)}>
          {changes.data.length > 0 ? (
            <ChangesTable changes={changes.data} filter={filter} />
          ) : filtered ? (
            <EmptyState
              icon={SearchX}
              title="No changes match these filters"
              body="Try another provider or status, or clear the filters."
              action={{ label: "Clear filters", href: changesHref({}) }}
            />
          ) : (
            <EmptyState
              icon={Radar}
              title="No breaking changes found yet"
              body="The monitor lists a change here as soon as a provider announces one."
            />
          )}
        </ReviewProvider>
      </section>
    </>
  );
}

function MonitorUnavailableNotice() {
  return (
    <div className="flex items-start gap-2.5 border border-dashed bg-accent/40 px-4 py-3.5 text-sm text-muted-foreground">
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium text-foreground">Sample data.</span> The SyncLab API you are connected to does not
        run the change monitor yet, so this page shows what it will look like. It switches to the monitor&apos;s own
        findings once the API serves them.
      </p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Radar;
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed px-6 py-16 text-center">
      <Icon aria-hidden className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {action && (
        <Button asChild variant="outline" size="sm">
          <Link href={action.href} scroll={false}>
            {action.label}
          </Link>
        </Button>
      )}
    </div>
  );
}

function MonitorSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}
