import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="h-10 border-b" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-6 border-b px-4 py-4 last:border-b-0">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-1.5 w-36" />
          <Skeleton className="ml-auto h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading migrations" className="flex flex-col gap-8">
      <Skeleton className="h-[86px] w-full rounded-lg" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <TableSkeleton />
      </div>
    </div>
  );
}

export function JobSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading job" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
