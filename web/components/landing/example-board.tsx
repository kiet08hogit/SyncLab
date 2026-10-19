"use client";

import { useState } from "react";

import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGE_LABEL: Record<PipelineStage, string> = {
  CLONE: "Clone",
  CHANGELOG: "Changelog",
  INSTALL: "Install",
  BASELINE: "Baseline",
  UPGRADE: "Upgrade",
  REFACTOR: "Refactor",
  TEST: "Test",
  PR: "Pull request",
};

const EXAMPLES = [
  {
    label: "A dependency breaks",
    body: "Dependabot or Renovate opens a pull request for a breaking npm release. SyncLab picks it up from there: the release notes, your usage of the package, and the code that has to change.",
    file: "package.json",
    before: '"zod": "^3.23.8"',
    after: '"zod": "^4.1.0"',
    stages: {
      CLONE: "A fresh checkout, in a volume of its own.",
      CHANGELOG: "The release notes for zod 4.",
      INSTALL: "The lockfile moves to 4.1.0.",
      BASELINE: "The suite passes on zod 3.",
      UPGRADE: "The dependency is set to 4.1.0.",
      REFACTOR: "Call sites that used the old error map are rewritten.",
      TEST: "The suite runs again, with no network.",
      PR: "A pull request is opened.",
    },
  },
  {
    label: "An API breaks",
    body: "A provider retires a model or changes a parameter, often with no SDK release at all. SyncLab watches the provider, and its scanner already knows which of your calls the change reaches.",
    file: "lib/chat.ts",
    before: 'model: "chat-large-2024-06"',
    after: 'model: "chat-large-2026-04"',
    stages: {
      CLONE: "A fresh checkout, in a volume of its own.",
      CHANGELOG: "chat-large-2024-06 is retired.",
      INSTALL: "Nothing to install. The API changed, not a package.",
      BASELINE: "The suite passes on the current code.",
      UPGRADE: "No version to bump.",
      REFACTOR: "lib/chat.ts names chat-large-2026-04.",
      TEST: "The suite runs again, with no network.",
      PR: "A pull request is opened.",
    },
  },
] as const;

/** Pick a break, then a stage. One pipeline, and the line under it is that stage for the break you picked. */
export function ExampleBoard() {
  const [example, setExample] = useState(0);
  const [stage, setStage] = useState<PipelineStage>("PR");
  const current = EXAMPLES[example];
  const selected = PIPELINE_STAGES.indexOf(stage);

  return (
    <div className="mt-12 flex flex-col gap-8">
      <div role="tablist" aria-label="Examples" className="grid border-t border-l border-white/10 sm:grid-cols-2">
        {EXAMPLES.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={index === example}
            onClick={() => setExample(index)}
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
          <span className="block text-[#9db4ff]">+ {current.after}</span>
        </pre>
        <ol role="tablist" aria-label="Stages" className="relative grid gap-y-8 border-t border-white/10 px-4 py-6 min-[900px]:grid-cols-8 min-[900px]:gap-x-4">
          <span
            aria-hidden
            className="absolute top-9 bottom-9 left-7 w-px bg-white/12 min-[900px]:top-9 min-[900px]:right-[calc(100%/16)] min-[900px]:bottom-auto min-[900px]:left-[calc(100%/16)] min-[900px]:h-px min-[900px]:w-auto"
          />
          {PIPELINE_STAGES.map((item, index) => {
            const state = index < selected ? "done" : index === selected ? "current" : "upcoming";
            return (
              <li key={item}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={item === stage}
                  onClick={() => setStage(item)}
                  className="relative flex w-full gap-4 text-left min-[900px]:flex-col min-[900px]:items-center min-[900px]:text-center"
                >
                  <span
                    className={cn(
                      "relative grid size-6 shrink-0 place-items-center border bg-[#07090c] font-mono text-[10px]",
                      state === "current" && "border-[#6f93ff] bg-[#0e1a3d] text-white shadow-[0_0_22px_rgba(90,131,255,0.5)]",
                      state === "done" && "border-[#6f93ff]/60 text-white",
                      state === "upcoming" && "border-white/15 text-white/50",
                    )}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={cn("text-sm font-medium", state === "upcoming" ? "text-white/50" : "text-white")}>
                    {STAGE_LABEL[item]}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p aria-live="polite" className="border-t border-white/10 px-4 py-3 text-sm text-white/70">
          {current.stages[stage]}
        </p>
      </figure>
    </div>
  );
}
