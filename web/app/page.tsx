import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { GithubSignIn } from "@/components/github-sign-in";
import { Band, Eyebrow } from "@/components/landing/frame";
import { HeroField } from "@/components/landing/hero-field";
import { PipelineDiagram } from "@/components/landing/pipeline-diagram";
import { Mascot } from "@/components/mascot";
import { RunningJobs } from "@/components/running-jobs";
import { Button } from "@/components/ui/button";
import { signInConfigured } from "@/lib/auth";
import { getJobs } from "@/lib/data";

export const metadata: Metadata = {
  title: { absolute: "SyncLab: dependency upgrades that open their own pull requests" },
};

const FEATURES = [
  {
    title: "Sandboxed by default",
    body: "Repository code only runs in short-lived Docker containers, and the one that executes it has no network and no credentials.",
  },
  {
    title: "Tested before and after",
    body: "Your suite runs on the current version first, then after every rewrite. Failing output goes back to the model for another try.",
  },
  {
    title: "Started by your bots",
    body: "A Dependabot or Renovate pull request for an npm update starts a migration on its own. You can also start one by hand.",
  },
  {
    title: "Your model, your call",
    body: "A local model through Ollama by default, or Gemini or Claude when you want a hosted one.",
  },
  {
    title: "npm, pnpm and yarn",
    body: "The package manager comes from packageManager or your lockfile, and the lockfile is honoured exactly.",
  },
  {
    title: "Every step on the record",
    body: "The dashboard follows each job through the pipeline live, with the full output of every step and a retry for failures.",
  },
];

/** Sign-in when the GitHub App is configured, otherwise the sample dashboard. */
function PrimaryAction({ className }: { className?: string }) {
  return signInConfigured() ? (
    <GithubSignIn returnTo="/dashboard" className={className} />
  ) : (
    <Button asChild size="lg" className={className}>
      <Link href="/dashboard">Open the dashboard</Link>
    </Button>
  );
}

async function ProductPreview() {
  const running = await getJobs({ status: "IN_PROGRESS" });
  return <RunningJobs jobs={running.slice(0, 2)} />;
}

export default function LandingPage() {
  return (
    <div data-landing className="dark min-h-dvh overflow-x-clip bg-[#07090c] text-white">
      <div className="mx-auto max-w-[1440px] border-x border-white/10">
        <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-[#07090c]/75 px-5 backdrop-blur-md sm:px-10">
          <Link href="/" className="flex items-center gap-2.5">
            <Mascot className="size-7" />
            <span className="font-serif text-xl">SyncLab</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-6">
            <a href="#how" className="label-mono hidden text-white/60 transition-colors hover:text-white sm:block">
              How it works
            </a>
            <Link href="/dashboard" className="label-mono hidden text-white/60 transition-colors hover:text-white sm:block">
              Dashboard
            </Link>
            <PrimaryAction className="h-9 px-3" />
          </nav>
        </header>

        <main id="main" tabIndex={-1} className="outline-none">
          <HeroField>
            <div className="flex flex-col gap-6">
              <Eyebrow>Dependency migrations</Eyebrow>
              <h1 id="hero-heading" className="font-serif text-[2.6rem] leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-7xl">
                Upgrades that open their own pull requests.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-pretty text-white/65 sm:text-lg">
                SyncLab takes a breaking npm release, rewrites the code it breaks, proves the change with your own test
                suite in a locked-down sandbox, and hands you a pull request to merge.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryAction />
                <Button asChild variant="ghost" size="lg" className="h-10 px-4 text-white/80 hover:bg-white/5 hover:text-white">
                  <a href="#how">
                    How it works
                    <ArrowRight aria-hidden />
                  </a>
                </Button>
              </div>
            </div>
          </HeroField>

          <Band label="Works with">
            <ul className="label-mono flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-6 text-white/40 sm:px-10">
              {["Dependabot", "Renovate", "npm", "pnpm", "yarn", "Ollama", "Gemini", "Claude", "GitHub App"].map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </Band>

          <Band id="how" label="How it works" className="px-5 py-20 sm:px-10 sm:py-28">
            <div className="flex max-w-2xl flex-col gap-5">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">
                From a bot&apos;s pull request to one you can merge.
              </h2>
              <p className="text-pretty text-white/60">
                Every migration runs the same eight stages in throwaway containers. The repository&apos;s code never runs on
                the server that orchestrates them.
              </p>
            </div>
            <div className="mt-16">
              <PipelineDiagram />
            </div>
          </Band>

          <Band label="The dashboard" className="grid gap-12 px-5 py-20 sm:px-10 sm:py-28 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[900px]:items-center">
            <div className="flex flex-col gap-5">
              <Eyebrow>The dashboard</Eyebrow>
              <h2 className="font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">Watch it work.</h2>
              <p className="text-pretty text-white/60">
                Every job, live: which stage it is on, the output of each step, and the pull request when it lands. A
                failed job is one click from another try.
              </p>
              <Button asChild variant="outline" className="w-fit border-white/15 bg-transparent text-white hover:bg-white/5">
                <Link href="/dashboard">
                  Open the sample dashboard
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
            <figure className="overflow-hidden border border-white/10 bg-background shadow-[0_40px_120px_-40px_rgba(44,99,255,0.45)]">
              <div aria-hidden className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="ml-3 font-mono text-[11px] text-white/40">synclab / migrations</span>
              </div>
              <div className="p-4 sm:p-6">
                <Suspense fallback={<div className="h-72" />}>
                  <ProductPreview />
                </Suspense>
              </div>
              <figcaption className="sr-only">The dashboard&apos;s Running now cards, with sample jobs.</figcaption>
            </figure>
          </Band>

          <Band label="Why SyncLab" className="px-5 py-20 sm:px-10 sm:py-28">
            <div className="flex max-w-2xl flex-col gap-5">
              <Eyebrow>Built to be trusted with your repository</Eyebrow>
              <h2 className="font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">
                Careful where it counts.
              </h2>
            </div>
            <ul className="mt-14 grid border-t border-l border-white/10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature, index) => (
                <li key={feature.title} className="flex flex-col gap-3 border-r border-b border-white/10 p-6 sm:p-8">
                  <span className="font-mono text-[11px] text-[#6f93ff]">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="text-lg font-medium">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-pretty text-white/55">{feature.body}</p>
                </li>
              ))}
            </ul>
          </Band>

          <Band label="Get started" className="flex flex-col items-center gap-8 px-5 py-24 text-center sm:px-10 sm:py-32">
            <Mascot className="size-14" />
            <h2 className="max-w-3xl font-serif text-4xl leading-tight tracking-tight text-balance sm:text-6xl">
              Let the next breaking release fix itself.
            </h2>
            <div className="flex flex-wrap justify-center gap-3">
              <PrimaryAction />
              {/* Without sign-in, the primary action already opens the dashboard. */}
              {signInConfigured() && (
                <Button asChild variant="ghost" size="lg" className="h-10 px-4 text-white/80 hover:bg-white/5 hover:text-white">
                  <Link href="/dashboard">See the dashboard</Link>
                </Button>
              )}
            </div>
          </Band>
        </main>

        <footer className="flex flex-col gap-4 border-t border-white/10 px-5 py-8 text-sm text-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <span className="flex items-center gap-2">
            <Mascot className="size-5" />
            SyncLab
          </span>
          <span className="label-mono">Dependency migrations, opened as pull requests</span>
        </footer>
      </div>
    </div>
  );
}
