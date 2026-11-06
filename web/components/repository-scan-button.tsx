"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { requestRepositoryScan } from "@/app/(app)/repositories/[id]/actions";
import { Button } from "@/components/ui/button";

export function RepositoryScanButton({ githubRepoId }: { githubRepoId: string }) {
  const [state, action, pending] = useActionState(
    requestRepositoryScan.bind(null, githubRepoId),
    { error: null as string | null, queued: false },
  );
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <RefreshCw aria-hidden className={pending ? "size-4 animate-spin" : "size-4"} />
        {pending ? "Starting scan" : "Scan now"}
      </Button>
      {state.error && <p role="alert" className="text-sm text-status-failed">{state.error}</p>}
      {!state.error && state.queued && <p role="status" className="text-sm text-muted-foreground">Scan queued.</p>}
    </form>
  );
}
