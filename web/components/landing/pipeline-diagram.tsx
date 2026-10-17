import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";

const STAGES: Record<PipelineStage, { label: string; detail: string }> = {
  CLONE: { label: "Clone", detail: "A fresh checkout in a volume of its own." },
  CHANGELOG: { label: "Changelog", detail: "Release notes between your version and the new one." },
  INSTALL: { label: "Install", detail: "npm, pnpm or yarn, with your lockfile honoured exactly." },
  BASELINE: { label: "Baseline", detail: "Your tests on the current version. A suite that already fails stops here." },
  UPGRADE: { label: "Upgrade", detail: "The exact new version, in the section it was declared in." },
  REFACTOR: { label: "Refactor", detail: "A model rewrites only the files that use the dependency." },
  TEST: { label: "Test", detail: "Your suite again, with no network and no secrets. Failures go back to the model." },
  PR: { label: "Pull request", detail: "A branch and a pull request, ready for your review." },
};

/**
 * The eight sandbox stages as a route line. A pulse runs along it and lights
 * each stop in turn; the timing lives in globals.css (`landing-pulse`,
 * `landing-stop`), and reduced motion leaves it still.
 */
export function PipelineDiagram() {
  return (
    <ol className="relative grid gap-y-8 min-[900px]:grid-cols-8 min-[900px]:gap-x-4">
      {/* The line joins the first stop's center to the last's: across on wide screens, down on narrow ones. */}
      <span
        aria-hidden
        className="absolute top-3 bottom-3 left-3 w-px bg-white/12 min-[900px]:top-3 min-[900px]:right-[calc(100%/16)] min-[900px]:bottom-auto min-[900px]:left-[calc(100%/16)] min-[900px]:h-px min-[900px]:w-auto"
      >
        <span className="landing-pulse absolute size-2 -translate-1/2 rounded-full bg-[#6f93ff] shadow-[0_0_18px_4px_rgba(90,131,255,0.6)]" />
      </span>
      {PIPELINE_STAGES.map((stage, index) => (
        <li
          key={stage}
          className="relative flex gap-4 min-[900px]:flex-col min-[900px]:items-center min-[900px]:text-center"
        >
          <span
            className="landing-stop relative grid size-6 shrink-0 place-items-center border border-white/15 bg-[#07090c] font-mono text-[10px] text-white/50"
            style={{ animationDelay: `${index * 0.9}s` }}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-white">{STAGES[stage].label}</span>
            <span className="text-[13px] leading-snug text-pretty text-white/50">{STAGES[stage].detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
