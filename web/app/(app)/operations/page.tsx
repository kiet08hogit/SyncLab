import { Suspense } from "react";
import Link from "next/link";
import { LockKeyhole, ServerOff } from "lucide-react";
import { LiveRefresh } from "@/components/live-refresh";
import { OperationsOverview } from "@/components/operations-overview";
import { OverviewSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { getOperations } from "@/lib/operations";

export default function OperationsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-2">
        <p className="label-mono text-muted-foreground">Infrastructure / Operations</p>
        <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">Operations</h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">Queue pressure, sandbox startup, and model consumption across SyncLab.</p>
      </header>
      <Suspense fallback={<OverviewSkeleton />}><Overview /></Suspense>
    </div>
  );
}

async function Overview() {
  const result = await getOperations();
  if (result.status === "live") return <><LiveRefresh active /><OperationsOverview snapshot={result.snapshot} /></>;
  const unavailable = result.status === "unavailable";
  const Icon = unavailable ? ServerOff : LockKeyhole;
  return (
    <section className="flex flex-col items-start gap-4 border border-dashed p-6 sm:p-10">
      <Icon aria-hidden className="size-6 text-muted-foreground" />
      <h2 className="text-lg font-medium">{unavailable ? "Operations data is unavailable" : result.status === "signed-out" ? "Sign in to view operations" : "Operations access required"}</h2>
      <p className="max-w-xl text-sm leading-6 text-muted-foreground">
        {unavailable ? "The gateway could not read the operations metrics. Check the API and Redis connection, then try again." : result.status === "signed-out" ? "This view contains system-wide infrastructure metrics and is available to operations admins." : "Your account is not an operations admin. Ask your administrator for access."}
      </p>
      <Button asChild variant="outline"><Link href={unavailable ? "/operations" : "/settings"}>{unavailable ? "Try again" : "Open settings"}</Link></Button>
    </section>
  );
}
