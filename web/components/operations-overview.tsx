import { Activity, Box, Coins, Layers, Pause, TriangleAlert } from "lucide-react";
import type { OperationsSnapshot } from "@/lib/operations-types";

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const queueNames: Record<string, string> = {
  "migration-queue": "Migrations",
  "scan-queue": "Repository scans",
  "api-monitor-queue": "API monitor",
};

export function OperationsOverview({ snapshot }: { snapshot: OperationsSnapshot }) {
  const { queues, sandbox, tokens } = snapshot;
  const waiting = queues.reduce((sum, q) => sum + q.waiting + q.pausedJobs + q.waitingChildren, 0);
  const active = queues.reduce((sum, q) => sum + q.active, 0);
  const needsAttention = queues.some((q) => q.paused || q.failed > 0) || sandbox.failed > 0;
  const average = sandbox.count ? `${(sandbox.totalSeconds / sandbox.count).toFixed(2)}s` : "No samples";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3 text-sm">
        <p className="flex items-center gap-2">
          {needsAttention ? <TriangleAlert aria-hidden className="size-4 text-amber-700 dark:text-amber-400" /> : <Activity aria-hidden className="size-4 text-emerald-700 dark:text-emerald-400" />}
          {needsAttention ? "Review paused queues and recorded failures" : "Queues accepting work"}
        </p>
        <p className="text-xs text-muted-foreground">
          Updated <time dateTime={snapshot.collectedAt}>{new Date(snapshot.collectedAt).toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false })} UTC</time>
          <span className="ml-2">/ Refreshes every 5s</span>
        </p>
      </div>
      <section aria-label="Operations metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Queue depth", value: number(waiting), detail: "Waiting, paused, or blocked jobs", icon: Layers },
          { title: "Active jobs", value: number(active), detail: "Currently claimed by workers", icon: Activity },
          { title: "Sandbox creation", value: average, detail: `Mean across ${number(sandbox.count)} container attempts`, icon: Box },
          { title: "LLM tokens", value: number(tokens.input + tokens.output), detail: "Provider-reported input + output", icon: Coins },
        ].map(({ title, value, detail, icon: Icon }) => (
          <div key={title} className="flex min-w-0 flex-col gap-4 border bg-card p-5">
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><h2>{title}</h2><Icon aria-hidden className="size-4 shrink-0" /></div>
            <p className="font-mono text-3xl tracking-tight tabular-nums">{value}</p>
            <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
          </div>
        ))}
      </section>
      <section aria-labelledby="queue-heading" className="flex flex-col gap-4">
        <div><h2 id="queue-heading" className="text-lg font-medium">Work queues</h2><p className="mt-1 text-sm text-muted-foreground">Live BullMQ state across all installations. Delayed jobs include scheduled work and retries.</p></div>
        <div className="grid gap-4 lg:grid-cols-3">
          {queues.map((queue) => (
            <article key={queue.name} aria-label={queueNames[queue.name] ?? queue.name} className="min-w-0 border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium">{queueNames[queue.name] ?? queue.name}</h3>
                <span className="flex items-center gap-1.5 border px-2 py-1 text-xs">{queue.paused && <Pause aria-hidden className="size-3" />}{queue.paused ? "Paused" : "Accepting work"}</span>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
                {[["Waiting", queue.waiting], ["Active", queue.active], ["Delayed", queue.delayed], ["Retained failures", queue.failed], ["Paused jobs", queue.pausedJobs], ["Blocked on children", queue.waitingChildren]].map(([label, value]) => (
                  <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-mono text-xl tabular-nums">{number(Number(value))}</dd></div>
                ))}
              </dl>
            </article>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Retained failures reflect BullMQ retention limits, not lifetime totals. Queue counts do not measure worker health.</p>
      </section>
      <section aria-label="Resource usage" className="grid gap-4 lg:grid-cols-2">
        <div className="border bg-card p-5">
          <h2 className="text-lg font-medium">Sandbox startup</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Docker container creation latency, including failed attempts. Image checks and process startup are excluded.</p>
          <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
            <div><dt className="text-xs text-muted-foreground">Container attempts</dt><dd className="mt-1 font-mono text-xl">{number(sandbox.count)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Creation failures</dt><dd className="mt-1 font-mono text-xl">{number(sandbox.failed)}</dd></div>
          </dl>
        </div>
        <div className="border bg-card p-5">
          <h2 className="text-lg font-medium">Model consumption</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Reported by refactor and classification replies, including replies later rejected by validation.</p>
          <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
            <div><dt className="text-xs text-muted-foreground">Input tokens</dt><dd className="mt-1 font-mono text-xl">{number(tokens.input)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Output tokens</dt><dd className="mt-1 font-mono text-xl">{number(tokens.output)}</dd></div>
          </dl>
        </div>
      </section>
      <p className="max-w-3xl text-xs leading-6 text-muted-foreground">Resource counters accumulate in Redis across workers and reset if their Redis data is cleared. Usage from terminated containers or requests without provider usage is unavailable. Zero means no usage has been recorded.</p>
    </>
  );
}
