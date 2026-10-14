import Link from "next/link";

import { NumberTicker } from "@/components/ui/number-ticker";
import { STATUS_META } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/types";

const ORDER: JobStatus[] = ["IN_PROGRESS", "QUEUED", "COMPLETED", "FAILED"];

/**
 * Counts per status that double as the table filter, so the numbers and the
 * list below them can never disagree about what is being shown.
 */
export function StatusFilter({
  counts,
  active,
  hrefFor,
}: {
  counts: Record<JobStatus, number>;
  active?: JobStatus;
  hrefFor: (status?: JobStatus) => string;
}) {
  const total = ORDER.reduce((sum, status) => sum + counts[status], 0);
  const items = [
    {
      key: "ALL",
      label: "All jobs",
      count: total,
      href: hrefFor(),
      selected: !active,
      tone: "text-foreground",
      icon: null,
    },
    ...ORDER.map((status) => ({
      key: status,
      label: STATUS_META[status].label,
      count: counts[status],
      href: hrefFor(status),
      selected: active === status,
      tone: STATUS_META[status].text,
      icon: STATUS_META[status].icon,
    })),
  ];

  return (
    <nav
      aria-label="Filter by status"
      className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-5"
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            scroll={false}
            aria-current={item.selected ? "true" : undefined}
            className={cn(
              "group relative flex flex-col gap-1 border-border px-4 py-3.5 transition-colors hover:bg-accent/60",
              index === 0 && "col-span-2 border-b sm:col-span-1 sm:border-b-0",
              index > 0 && "sm:border-l",
              index > 0 && index % 2 === 0 && "border-l",
              index > 2 && "border-t sm:border-t-0",
              item.selected && "bg-accent",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground group-aria-[current]:text-foreground">
              {Icon && <Icon aria-hidden className={cn("size-3.5", item.tone)} />}
              {item.label}
            </span>
            <NumberTicker
              value={item.count}
              className="text-2xl font-semibold tracking-tight text-foreground tabular-nums dark:text-foreground"
            />
            {item.selected && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}
