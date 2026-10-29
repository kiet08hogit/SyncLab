import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";

const STAGES: Record<PipelineStage, { label: string; detail: string }> = {
  CLONE: { label: "Clone", detail: "A fresh checkout in a volume of its own." },
  CHANGELOG: { label: "Changelog", detail: "What changed: the release notes, or the provider's change and its evidence." },
  INSTALL: { label: "Install", detail: "npm, pnpm or yarn, with your lockfile honoured exactly." },
  BASELINE: { label: "Baseline", detail: "Your tests on the current version. A suite that already fails stops here." },
  UPGRADE: { label: "Upgrade", detail: "The exact new version of a dependency. An API change has nothing to bump." },
  REFACTOR: { label: "Refactor", detail: "A model rewrites only the code that uses what changed." },
  TEST: { label: "Test", detail: "Your suite again, with no network and no secrets. Failures go back to the model." },
  PR: { label: "Pull request", detail: "A branch and a pull request, ready for your review." },
};

/** The two starts. Either one joins the same eight sandbox stages below. */
const ENTRIES = [
  {
    label: "A dependency breaks",
    body: "Dependabot or Renovate opens a pull request for a breaking npm release. SyncLab picks it up from there: the release notes, your usage of the package, and the code that has to change.",
  },
  {
    label: "An API breaks",
    body: "A provider retires a model or changes a parameter, often with no SDK release at all. SyncLab watches the provider, and its scanner already knows which of your calls the change reaches.",
  },
];

/**
 * Both triggers and the eight sandbox stages on one rail, so the pipeline
 * reads as a connected flow. A pulse runs the stage rail and lights each
 * stop in turn; the timing lives in globals.css (`landing-pulse`,
 * `landing-stop`), and reduced motion leaves it still.
 */
export function PipelineDiagram() {
  return (
    <div className="flex w-full max-w-3xl flex-col">
      <div className="relative">
        <span aria-hidden className="absolute top-5 bottom-0 left-[22px] w-px bg-white/12" />
        <ul className="flex flex-col gap-3">
          {ENTRIES.map((entry) => (
            <li key={entry.label} className="relative">
              <span aria-hidden className="absolute top-5 left-[18px] size-2 border border-[#6f93ff] bg-[#07090c]" />
              <span aria-hidden className="absolute top-6 left-[26px] h-px w-[22px] bg-white/15" />
              <div className="ml-12 flex flex-col gap-2 border border-white/10 bg-white/[0.02] p-5 sm:p-6">
                <h3 className="text-lg font-medium">{entry.label}</h3>
                <p className="text-sm leading-relaxed text-pretty text-white/55">{entry.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div aria-hidden className="relative h-8">
        <span className="absolute inset-y-0 left-[22px] w-px bg-white/12" />
      </div>

      <ol className="relative flex flex-col">
        <span aria-hidden className="absolute top-0 bottom-8 left-[22px] w-px bg-white/12">
          <span className="landing-pulse absolute size-2 -translate-1/2 rounded-full bg-[#6f93ff] shadow-[0_0_18px_4px_rgba(90,131,255,0.6)]" />
        </span>
        {PIPELINE_STAGES.map((stage, index) => (
          <li key={stage} className="relative py-1.5">
            <span
              className="landing-stop absolute top-1/2 left-[10px] z-10 grid size-6 -translate-y-1/2 place-items-center border border-white/15 bg-[#07090c] font-mono text-[10px] text-white/50"
              style={{ animationDelay: `${index * 0.9}s` }}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span aria-hidden className="absolute top-1/2 left-[34px] h-px w-3.5 bg-white/15" />
            <div className="ml-12 flex flex-col gap-1.5 border border-white/10 bg-white/[0.02] px-4 py-3 sm:px-5">
              <span className="text-sm font-medium text-white">{STAGES[stage].label}</span>
              <span className="text-[13px] leading-snug text-pretty text-white/50">{STAGES[stage].detail}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
