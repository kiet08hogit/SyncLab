"use client";

import { useActionState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import { retryJob, type RetryJobState } from "@/app/(app)/jobs/[id]/actions";
import { Button } from "@/components/ui/button";

export function RetryButton({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState<RetryJobState>(retryJob.bind(null, jobId), { error: null });

  return (
    <form action={action} className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCcw aria-hidden />}
        {pending ? "Retrying…" : "Retry migration"}
      </Button>
      {state.error && (
        <p role="alert" className="max-w-xs text-sm text-status-failed sm:text-right">
          {state.error}
        </p>
      )}
    </form>
  );
}
