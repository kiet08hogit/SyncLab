"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Hourglass } from "lucide-react";

import { LogOutput } from "@/components/log-output";
import { Terminal } from "@/components/ui/terminal";
import { formatClock, formatDate, splitExitCode, tailLines } from "@/lib/format";
import type { ExecutionLog } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Recent output is useful at a glance; the timeline retains every line and its copy controls. */
export function ExecutionLogView({
  logs,
  initiallyTerminal,
}: {
  logs: ExecutionLog[];
  initiallyTerminal: boolean;
}) {
  const [chosen, setChosen] = useState<"terminal" | "timeline" | null>(null);
  const view = chosen ?? (initiallyTerminal ? "terminal" : "timeline");
  const pane = useRef<HTMLElement>(null);
  const recent = logs.slice(-5);
  const recentSignature = recent.map((log) => `${log.id}:${log.output ?? ""}`).join("\n");

  useLayoutEffect(() => {
    const root = pane.current;
    if (!root || view !== "terminal") return;
    for (const port of root.querySelectorAll<HTMLElement>("pre, code")) {
      port.scrollTop = port.scrollHeight;
    }
  }, [recentSignature, view]);

  return (
    <section ref={pane} aria-labelledby="log-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="log-heading" className="label-mono text-muted-foreground">Execution log</h2>
        {logs.length > 0 && (
          <div role="group" aria-label="Execution log view" className="flex border border-border bg-card text-xs">
            <button
              type="button"
              aria-pressed={view === "terminal"}
              onClick={() => setChosen("terminal")}
              className="px-3 py-1.5 text-muted-foreground hover:text-foreground focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-accent aria-pressed:text-foreground"
            >
              Recent output
            </button>
            <button
              type="button"
              aria-pressed={view === "timeline"}
              onClick={() => setChosen("timeline")}
              className="border-l border-border px-3 py-1.5 text-muted-foreground hover:text-foreground focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-accent aria-pressed:text-foreground"
            >
              Full timeline
            </button>
          </div>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="flex items-center gap-3 border border-dashed px-5 py-8 text-sm text-muted-foreground">
          <Hourglass aria-hidden className="size-5 shrink-0" />
          Waiting for a worker to claim this job. Log entries appear here as each stage starts.
        </div>
      ) : view === "terminal" ? (
        <Terminal className="max-w-none rounded-none border-[#293348] bg-[#111827] text-[#e8eef9] shadow-sm [&>div:first-child]:border-[#293348] [&>pre]:max-h-80 [&>pre]:overflow-auto [&>pre]:font-mono">
          {recent.map((log) => {
            const { exitCode, body } = splitExitCode(log.output);
            const { hidden, text } = tailLines(body, 6);
            const failed = log.step === "FAILED" || (exitCode !== null && exitCode !== 0);
            return (
              <span key={log.id} className="block border-b border-white/10 py-1 last:border-b-0" data-terminal-log>
                <span className={cn("block text-xs", failed ? "text-[#ff9c9c]" : "text-[#8fd7b1]")}>
                  {formatClock(log.createdAt)} UTC  {log.step}{exitCode !== null ? `  ·  exit ${exitCode}` : ""}
                </span>
                {hidden > 0 && <span className="block text-xs text-[#8c99ad]">… {hidden} earlier lines in Full timeline</span>}
                {text && <span className="block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#d8e2f0]">{text}</span>}
              </span>
            );
          })}
        </Terminal>
      ) : (
        <ol className="corner-mark flex flex-col border bg-card">
          {logs.map((log) => {
            const { exitCode, body } = splitExitCode(log.output);
            const failed = log.step === "FAILED" || (exitCode !== null && exitCode !== 0);
            return (
              <li key={log.id} className="flex flex-col gap-2 border-b px-4 py-3.5 last:border-b-0 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={cn("text-sm font-semibold", failed ? "text-status-failed" : "text-foreground")}>{log.step}</span>
                  <time dateTime={log.createdAt} title={formatDate(log.createdAt)} className="font-mono text-xs text-muted-foreground">
                    {formatClock(log.createdAt)}
                  </time>
                  {exitCode !== null && (
                    <span className={cn("px-1.5 py-0.5 font-mono text-xs", exitCode === 0 ? "bg-status-completed/12 text-status-completed" : "bg-status-failed/12 text-status-failed")}>
                      exit {exitCode}
                    </span>
                  )}
                </div>
                {body && <LogOutput body={body} failed={failed} />}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
