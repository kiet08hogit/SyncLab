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

/** The two breaks, and the fix for the one you pick. The code sits under the cards, not inside them. */
export function ExampleBoard() {
  const [example, setExample] = useState(0);
  const [stage, setStage] = useState<PipelineStage>("REFACTOR");
  const current = EXAMPLES[example];

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

      <figure className="border border-white/10" aria-live="polite">
        <figcaption className="border-b border-white/10 px-4 py-2 font-mono text-[11px] text-white/45">{current.file}</figcaption>
        <pre className="px-4 py-3 font-mono text-sm leading-7">
          <span className="block text-white/40">- {current.before}</span>
          <span className="block text-[#9db4ff]">+ {current.after}</span>
        </pre>
        <div role="tablist" aria-label="Stages" className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-3">
          {PIPELINE_STAGES.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === stage}
              onClick={() => setStage(item)}
              className={cn(
                "border border-white/15 px-2.5 py-1 font-mono text-[11px] text-white/50 transition-colors hover:text-white",
                item === stage && "border-white/40 text-white",
              )}
            >
              {STAGE_LABEL[item]}
            </button>
          ))}
        </div>
        <p className="border-t border-white/10 px-4 py-3 text-sm text-white/70">{current.stages[stage]}</p>
      </figure>
    </div>
  );
}
