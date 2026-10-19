"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { PIPELINE_STAGES } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGE_LABEL = ["Clone", "Changelog", "Install", "Baseline", "Upgrade", "Refactor", "Test", "Pull request"];

/** The stage whose output is the rewrite, so the fixed line lands with it. */
const REFACTOR = 5;

const EXAMPLES = [
  {
    label: "A dependency breaks",
    body: "Dependabot or Renovate opens a pull request for a breaking npm release. SyncLab picks it up from there: the release notes, your usage of the package, and the code that has to change.",
    file: "package.json",
    before: '"zod": "^3.23.8"',
    after: '"zod": "^4.1.0"',
    trigger: "zod 4.1.0 is a breaking release, and 14 files use it.",
    lines: [
      "Cloned northwind/storefront into a container of its own.",
      "Read the release notes: the error map moved to a new option.",
      "Installed with your lockfile, now on 4.1.0.",
      "Your suite passes on 3.23.8, so the baseline is sound.",
      "Set the dependency to 4.1.0.",
      "Rewrote 14 files that used the old error map.",
      "Ran your suite again, with no network and no secrets.",
      "Opened a pull request on synclab/zod-v4-1-0.",
    ],
  },
  {
    label: "An API breaks",
    body: "A provider retires a model or changes a parameter, often with no SDK release at all. SyncLab watches the provider, and its scanner already knows which of your calls the change reaches.",
    file: "lib/chat.ts",
    before: 'model: "chat-large-2024-06"',
    after: 'model: "chat-large-2026-04"',
    trigger: "chat-large-2024-06 is retired, and lib/chat.ts still asks for it.",
    lines: [
      "Cloned northwind/storefront into a container of its own.",
      "Quoted the retirement notice, word for word, from the provider.",
      "Nothing to install. The API changed, not a package.",
      "Your suite passes on the current code, so the baseline is sound.",
      "No version to bump. The code is what has to change.",
      "Rewrote the one call that named the retired model.",
      "Ran your suite again, with no network and no secrets.",
      "Opened a pull request on synclab/api-chat-large.",
    ],
  },
] as const;

/** Steps are the trigger line, then the eight stages, then two beats on the pull request. */
const LAST = PIPELINE_STAGES.length;
const STEPS = LAST + 2;

const subscribe = (notify: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

/**
 * Pick a break, then watch SyncLab work through it: the trigger, then each
 * stage logging what it did, and the fixed line landing at the rewrite.
 */
export function ExampleBoard() {
  const [example, setExample] = useState(0);
  const [step, setStep] = useState(0);
  const still = useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setStep((value) => (value + 1) % STEPS), 1400);
    return () => clearInterval(id);
  }, [still, example]);

  const current = EXAMPLES[example];
  // Reduced motion gets the finished run rather than a frozen first frame.
  const done = still ? LAST : Math.min(step, LAST);

  return (
    <div className="mt-12 flex flex-col gap-8">
      <div role="tablist" aria-label="Examples" className="grid border-t border-l border-white/10 sm:grid-cols-2">
        {EXAMPLES.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={index === example}
            onClick={() => {
              setExample(index);
              setStep(0);
            }}
            className={cn(
              "flex flex-col gap-3 border-r border-b border-white/10 p-6 text-left transition-colors hover:bg-white/[0.03] sm:p-8",
              index === example && "bg-white/[0.04]",
            )}
          >
            <span className="text-lg font-medium text-white">{item.label}</span>
            <span className="text-sm leading-relaxed text-pretty text-white/55">{item.body}</span>
          </button>
        ))}
      </div>

      <figure className="border border-white/10">
        <figcaption className="border-b border-white/10 px-4 py-2 font-mono text-[11px] text-white/45">{current.file}</figcaption>
        <pre className="px-4 py-3 font-mono text-sm leading-7">
          <span className="block text-white/40">- {current.before}</span>
          <span className={cn("block text-[#9db4ff] transition-opacity", done > REFACTOR ? "opacity-100" : "opacity-0")}>
            + {current.after}
          </span>
        </pre>

        <ol className="relative grid gap-y-8 border-t border-white/10 px-4 py-6 min-[900px]:grid-cols-8 min-[900px]:gap-x-4">
          <span
            aria-hidden
            className="absolute top-9 bottom-9 left-7 w-px bg-white/12 min-[900px]:top-9 min-[900px]:right-[calc(100%/16)] min-[900px]:bottom-auto min-[900px]:left-[calc(100%/16)] min-[900px]:h-px min-[900px]:w-auto"
          />
          {PIPELINE_STAGES.map((stage, index) => {
            const reached = index < done;
            const running = index === done - 1;
            return (
              <li
                key={stage}
                aria-current={running ? "step" : undefined}
                className="relative flex gap-4 min-[900px]:flex-col min-[900px]:items-center min-[900px]:text-center"
              >
                <span
                  className={cn(
                    "relative grid size-6 shrink-0 place-items-center border bg-[#07090c] font-mono text-[10px] transition-colors",
                    running && "border-[#6f93ff] bg-[#0e1a3d] text-white shadow-[0_0_22px_rgba(90,131,255,0.5)]",
                    reached && !running && "border-[#6f93ff]/60 text-white",
                    !reached && "border-white/15 text-white/50",
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={cn("text-sm font-medium transition-colors", reached ? "text-white" : "text-white/50")}>
                  {STAGE_LABEL[index]}
                </span>
              </li>
            );
          })}
        </ol>

        <p aria-live="polite" className="border-t border-white/10 px-4 py-3 text-sm text-white/70">
          {done === 0 ? current.trigger : current.lines[done - 1]}
        </p>
      </figure>
    </div>
  );
}
