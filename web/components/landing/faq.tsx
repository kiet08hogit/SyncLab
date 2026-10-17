import { Plus } from "lucide-react";

const QUESTIONS = [
  {
    question: "What is SyncLab?",
    answer:
      "SyncLab keeps your code working through breaking changes. When a dependency ships a breaking release, or an API you call changes under you, it finds the code that breaks, rewrites it with a model, proves the fix with your own test suite, and opens a pull request for you to review.",
  },
  {
    question: "What kinds of breaking changes does it fix?",
    answer:
      "Two kinds. Breaking npm releases, which arrive as Dependabot or Renovate pull requests. And changes to an API you call: a retired model, a removed or renamed parameter, a parameter that becomes required, a removed enum value, or an endpoint replaced by a new one. A change in behavior for the same request is reported rather than rewritten.",
  },
  {
    question: "How does it know where my code calls an API?",
    answer:
      "A scanner reads your JavaScript and TypeScript and records every call to the APIs SyncLab watches, through their official SDKs or plain fetch and axios requests, with the operation, the request parameters, and any model IDs. It runs when the GitHub App is installed, on every push to your default branch, and on request.",
  },
  {
    question: "How does it find out a provider changed its API?",
    answer:
      "By watching each provider's own sources: its published API spec, its deprecation pages, and its release notes and SDK changelogs. A change read from prose has to quote its evidence word for word before it counts, so a model cannot invent one.",
  },
  {
    question: "Is it safe to run on my repository?",
    answer:
      "Your code only runs in short-lived Docker containers, never on the server that orchestrates them. The container that runs your tests has no network and no credentials, and SyncLab never calls a provider's live API to check a fix.",
  },
  {
    question: "Which languages, package managers, and models does it support?",
    answer:
      "JavaScript and TypeScript, with npm, pnpm, or yarn, and your lockfile is honoured exactly. Rewrites come from a local model by default, or from a hosted one.",
  },
  {
    question: "How do I get started?",
    answer:
      "Install the SyncLab GitHub App on your repositories and sign in with GitHub. Dependabot and Renovate pull requests start migrations on their own, and you can start one by hand from the dashboard.",
  },
];

/** Questions on the right, each one a native disclosure, so it works before hydration. */
export function Faq() {
  return (
    <div className="grid gap-12 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col items-start gap-6">
        <span className="label-mono bg-white/8 px-2.5 py-1.5 text-white/80">FAQ</span>
        <h2 className="font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">
          Frequently asked questions
        </h2>
      </div>
      <div className="border-t border-white/10">
        {QUESTIONS.map(({ question, answer }) => (
          <details key={question} className="group border-b border-white/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-lg text-white/85 transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
              {question}
              <Plus
                aria-hidden
                strokeWidth={1.5}
                className="size-5 shrink-0 text-white/60 transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
              />
            </summary>
            <p className="max-w-2xl pr-10 pb-6 leading-relaxed text-pretty text-white/60">{answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
