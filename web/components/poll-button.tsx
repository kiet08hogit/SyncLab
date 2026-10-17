"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { pollSources, type PollState } from "@/app/api-changes/actions";
import { LiveRefresh } from "@/components/live-refresh";
import { Button } from "@/components/ui/button";

// The worker fetches each source in turn, so give up watching for the
// result after a while rather than refreshing the page forever.
const WATCH_MS = 2 * 60_000;

/**
 * Queues a fetch of every watched source, then refreshes the page until each
 * source reports a check from after the request. `checkedAt` is the oldest
 * `lastCheckedAt` across the sources, or null when one was never checked.
 */
export function PollButton({
  checkedAt,
  disabledReason,
  showReason = true,
}: {
  checkedAt: string | null;
  disabledReason?: string;
  /** Whether the reason shows under the button, rather than only on hover. */
  showReason?: boolean;
}) {
  const [state, action, pending] = useActionState<PollState>(pollSources, { error: null, requestedAt: null });
  // The request that ran out of time, so a new request starts out watched again.
  const [expiredRequest, setExpiredRequest] = useState<string | null>(null);

  useEffect(() => {
    const { requestedAt } = state;
    if (!requestedAt) return;
    const timer = setTimeout(() => setExpiredRequest(requestedAt), WATCH_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const expired = state.requestedAt !== null && expiredRequest === state.requestedAt;

  const waiting = state.requestedAt !== null && (checkedAt === null || checkedAt < state.requestedAt);
  const checking = waiting && !expired;
  const busy = pending || checking;

  return (
    <form action={action} className="flex flex-col items-start gap-2 sm:items-end">
      <LiveRefresh active={checking} />
      <Button
        type="submit"
        variant="outline"
        size="lg"
        disabled={busy || disabledReason !== undefined}
        title={disabledReason}
        className="h-10 w-fit px-4"
      >
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
        {busy ? "Checking sources…" : "Check now"}
      </Button>
      {disabledReason && showReason && (
        <p className="max-w-xs text-xs text-muted-foreground sm:text-right">{disabledReason}</p>
      )}
      {state.error && (
        <p role="alert" className="max-w-xs text-sm text-status-failed sm:text-right">
          {state.error}
        </p>
      )}
      {waiting && expired && (
        <p role="status" className="max-w-xs text-sm text-muted-foreground sm:text-right">
          Still waiting for the worker. The results show up here once it has fetched every source.
        </p>
      )}
    </form>
  );
}
