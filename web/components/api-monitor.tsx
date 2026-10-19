import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, CircleDot, CircleSlash, ExternalLink, type LucideIcon, X } from "lucide-react";

import { ReviewButtons } from "@/components/review-buttons";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  describeChange,
  effectiveCountdown,
  formatCalendarDate,
  KIND_LABEL,
  PROVIDER_LABEL,
  shortUrl,
  SOURCE_LABEL,
} from "@/lib/api-change-format";
import { formatDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  API_CHANGE_STATUSES,
  API_PROVIDERS,
  type ApiChange,
  type ApiChangeFilter,
  type ApiChangeStatus,
  type ApiProviderSummary,
  type ApiSource,
} from "@/lib/types";

export const CHANGE_STATUS_META: Record<
  ApiChangeStatus,
  { label: string; icon: LucideIcon; text: string; className: string }
> = {
  detected: {
    label: "Detected",
    icon: CircleDot,
    text: "text-status-running",
    className: "text-status-running bg-status-running/12",
  },
  confirmed: {
    label: "Confirmed",
    icon: CircleCheck,
    text: "text-status-completed",
    className: "text-status-completed bg-status-completed/12",
  },
  dismissed: {
    label: "Dismissed",
    icon: CircleSlash,
    text: "text-status-queued",
    className: "text-status-queued bg-status-queued/12",
  },
};

export function ChangeStatusBadge({ status }: { status: ApiChangeStatus }) {
  const meta = CHANGE_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={cn("h-6 gap-1.5 px-2.5", meta.className)}>
      <Icon aria-hidden data-icon="inline-start" />
      {meta.label}
    </Badge>
  );
}

function Timestamp({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatDate(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

function ExternalPage({ url, className }: { url: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex min-w-0 items-center gap-1 text-primary hover:underline", className)}
    >
      <span className="truncate">{shortUrl(url)}</span>
      <ExternalLink aria-hidden className="size-3 shrink-0" />
      <span className="sr-only">(opens the provider&apos;s page)</span>
    </a>
  );
}

function SourceRow({ source }: { source: ApiSource }) {
  return (
    <li className="flex flex-col gap-1.5 border-t px-4 py-3 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{SOURCE_LABEL[source.kind]}</span>
        <ExternalPage url={source.url} className="max-w-full font-mono text-xs" />
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt>Checked</dt>
          <dd className="text-foreground tabular-nums">
            {source.lastCheckedAt ? <Timestamp iso={source.lastCheckedAt} /> : "never"}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Last changed</dt>
          <dd className="text-foreground tabular-nums">
            {source.latestSnapshot ? (
              <>
                <Timestamp iso={source.latestSnapshot.fetchedAt} />{" "}
                <span className="font-mono text-muted-foreground" title={`Content hash ${source.latestSnapshot.contentHash}`}>
                  {source.latestSnapshot.contentHash.slice(0, 7)}
                </span>
              </>
            ) : (
              "no snapshot yet"
            )}
          </dd>
        </div>
      </dl>
      {source.lastError && (
        <p className="flex items-start gap-1.5 text-xs text-status-failed">
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            <span className="font-medium">Last check failed.</span> {source.lastError}
          </span>
        </p>
      )}
    </li>
  );
}

export function ProviderCards({ providers }: { providers: ApiProviderSummary[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {providers.map((provider) => (
        <section
          key={provider.slug}
          aria-labelledby={`provider-${provider.slug}`}
          className="corner-mark flex min-w-0 flex-col border bg-card"
        >
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
            <h3 id={`provider-${provider.slug}`} className="text-lg font-semibold tracking-tight">
              {PROVIDER_LABEL[provider.slug]}
            </h3>
            <dl className="flex gap-4 text-sm">
              {API_CHANGE_STATUSES.map((status) => (
                // The count reads first; the markup keeps the term first, as a list requires.
                <div key={status} className="flex flex-row-reverse items-baseline justify-end gap-1.5">
                  <dt className="text-muted-foreground">{CHANGE_STATUS_META[status].label.toLowerCase()}</dt>
                  <dd
                    className={cn(
                      "font-semibold tabular-nums",
                      provider.changeCounts[status] ? CHANGE_STATUS_META[status].text : "text-muted-foreground",
                    )}
                  >
                    {provider.changeCounts[status]}
                  </dd>
                </div>
              ))}
            </dl>
          </header>
          <ul aria-label={`Sources watched for ${PROVIDER_LABEL[provider.slug]}`}>
            {provider.sources.map((source) => (
              <SourceRow key={`${source.kind}-${source.url}`} source={source} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Builds the page's URL for a filter, dropping anything left empty. */
export function changesHref(filter: ApiChangeFilter): string {
  const search = new URLSearchParams();
  if (filter.provider) search.set("provider", filter.provider);
  if (filter.status) search.set("status", filter.status);
  if (filter.kind) search.set("kind", filter.kind);
  const query = search.toString();
  return query ? `/api-changes?${query}` : "/api-changes";
}

function FilterChip({ href, selected, children }: { href: string; selected: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 border px-3 text-sm transition-colors hover:bg-accent/60",
        selected ? "border-foreground/30 bg-accent font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function ChangeFilters({ filter }: { filter: ApiChangeFilter }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      <nav aria-label="Filter by provider" className="flex flex-wrap gap-1.5">
        <FilterChip href={changesHref({ ...filter, provider: undefined })} selected={!filter.provider}>
          All providers
        </FilterChip>
        {API_PROVIDERS.map((provider) => (
          <FilterChip
            key={provider}
            href={changesHref({ ...filter, provider })}
            selected={filter.provider === provider}
          >
            {PROVIDER_LABEL[provider]}
          </FilterChip>
        ))}
      </nav>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        <FilterChip href={changesHref({ ...filter, status: undefined })} selected={!filter.status}>
          Any status
        </FilterChip>
        {API_CHANGE_STATUSES.map((status) => {
          const Icon = CHANGE_STATUS_META[status].icon;
          return (
            <FilterChip key={status} href={changesHref({ ...filter, status })} selected={filter.status === status}>
              <Icon aria-hidden className={cn("size-3.5", CHANGE_STATUS_META[status].text)} />
              {CHANGE_STATUS_META[status].label}
            </FilterChip>
          );
        })}
      </nav>
      {filter.kind && (
        <Link
          href={changesHref({ ...filter, kind: undefined })}
          scroll={false}
          className="inline-flex h-8 w-fit items-center gap-1.5 border border-foreground/30 bg-accent px-3 text-sm font-medium"
        >
          {KIND_LABEL[filter.kind]}
          <X aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="sr-only">Remove the kind filter</span>
        </Link>
      )}
    </div>
  );
}

/** A dismissed change is not going to be migrated, so its date carries no urgency. */
function Effective({ date, dismissed, inline }: { date: string; dismissed: boolean; inline?: boolean }) {
  const { label, urgency } = effectiveCountdown(date);
  return (
    <div className={cn("flex gap-0.5", inline ? "flex-wrap items-baseline gap-x-1.5 text-xs" : "flex-col")}>
      <time dateTime={date} className="tabular-nums">
        {formatCalendarDate(date)}
      </time>
      <span
        className={cn(
          "text-xs",
          urgency === "later" || dismissed ? "text-muted-foreground" : "text-status-failed",
          urgency === "soon" && !dismissed && "font-medium",
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function ChangesTable({ changes, filter }: { changes: ApiChange[]; filter: ApiChangeFilter }) {
  return (
    <div className="corner-mark border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 w-full pl-4 label-mono text-muted-foreground">Change</TableHead>
            <TableHead className="h-10 label-mono text-muted-foreground max-lg:hidden">Provider</TableHead>
            <TableHead className="h-10 label-mono text-muted-foreground max-sm:hidden">Effective</TableHead>
            <TableHead className="h-10 label-mono text-muted-foreground max-sm:hidden">Status</TableHead>
            <TableHead className="h-10 pr-4 text-right label-mono text-muted-foreground max-md:hidden">
              Detected
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map((change) => {
            const { subject, context, replacement } = describeChange(change);
            return (
              <TableRow key={change.id} className="align-top">
                <TableCell className="min-w-64 py-3.5 pl-4 whitespace-normal">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={changesHref({ ...filter, kind: change.kind })}
                        scroll={false}
                        title={`Show only: ${KIND_LABEL[change.kind]}`}
                        className="label-mono border px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {KIND_LABEL[change.kind]}
                      </Link>
                      <span className="text-xs text-muted-foreground lg:hidden">{PROVIDER_LABEL[change.provider]}</span>
                      <span className="sm:hidden">
                        <ChangeStatusBadge status={change.status} />
                      </span>
                    </div>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-sm font-medium [overflow-wrap:anywhere]">
                      {subject}
                      {replacement && (
                        <>
                          <ArrowRight aria-label="replaced by" className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-status-completed">{replacement}</span>
                        </>
                      )}
                    </p>
                    {context && <p className="font-mono text-xs text-muted-foreground">on {context}</p>}
                    {change.effectiveAt && (
                      <div className="sm:hidden">
                        <Effective date={change.effectiveAt} dismissed={change.status === "dismissed"} inline />
                      </div>
                    )}
                    <figure className="flex flex-col gap-1">
                      <blockquote
                        title={change.evidence}
                        className="line-clamp-2 border-l-2 pl-2 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {change.evidence}
                      </blockquote>
                      <figcaption className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        {change.section && <span>{change.section}</span>}
                        {change.section && <span aria-hidden>·</span>}
                        <a
                          href={change.source.url}
                          target="_blank"
                          rel="noreferrer"
                          title={change.source.url}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {SOURCE_LABEL[change.source.kind]}
                          <ExternalLink aria-hidden className="size-3" />
                          <span className="sr-only">(opens the provider&apos;s page)</span>
                        </a>
                      </figcaption>
                    </figure>
                    <ReviewButtons
                      changeId={change.id}
                      subject={subject}
                      status={change.status}
                      canReview={change.canReview}
                    />
                  </div>
                </TableCell>
                <TableCell className="py-3.5 max-lg:hidden">{PROVIDER_LABEL[change.provider]}</TableCell>
                <TableCell className="py-3.5 max-sm:hidden">
                  {change.effectiveAt ? (
                    <Effective date={change.effectiveAt} dismissed={change.status === "dismissed"} />
                  ) : (
                    <span className="text-muted-foreground">No date</span>
                  )}
                </TableCell>
                <TableCell className="py-3.5 max-sm:hidden">
                  <ChangeStatusBadge status={change.status} />
                </TableCell>
                <TableCell className="py-3.5 pr-4 text-right text-muted-foreground tabular-nums max-md:hidden">
                  <Timestamp iso={change.detectedAt} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
