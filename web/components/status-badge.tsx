import { CircleCheck, CircleDashed, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/types";

export const STATUS_META: Record<JobStatus, { label: string; icon: LucideIcon; text: string; className: string }> = {
  QUEUED: {
    label: "Queued",
    icon: CircleDashed,
    text: "text-status-queued",
    className: "text-status-queued bg-status-queued/12",
  },
  IN_PROGRESS: {
    label: "Running",
    icon: LoaderCircle,
    text: "text-status-running",
    className: "text-status-running bg-status-running/12 [&>svg]:motion-safe:animate-spin",
  },
  COMPLETED: {
    label: "Completed",
    icon: CircleCheck,
    text: "text-status-completed",
    className: "text-status-completed bg-status-completed/12",
  },
  FAILED: {
    label: "Failed",
    icon: CircleX,
    text: "text-status-failed",
    className: "text-status-failed bg-status-failed/12",
  },
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={cn("h-6 gap-1.5 px-2.5", meta.className, className)}>
      <Icon aria-hidden data-icon="inline-start" />
      {meta.label}
    </Badge>
  );
}
