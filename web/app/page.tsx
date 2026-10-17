import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { GithubSignIn } from "@/components/github-sign-in";
import { Faq } from "@/components/landing/faq";
import { Band, Eyebrow } from "@/components/landing/frame";
import { HeroField } from "@/components/landing/hero-field";
import { LandingChrome } from "@/components/landing/landing-chrome";
import { PipelineDiagram } from "@/components/landing/pipeline-diagram";
import { SectionLink } from "@/components/landing/section-link";
import { SiteFooter } from "@/components/landing/site-footer";
import { Mascot } from "@/components/mascot";
import { RunningJobs } from "@/components/running-jobs";
import { Button } from "@/components/ui/button";
import { signInConfigured } from "@/lib/auth";
import { getJobs } from "@/lib/data";

export const metadata: Metadata = {
  title: { absolute: "SyncLab: breaking changes that open their own pull requests" },
};

/** The two ways code breaks without anyone touching it, and what sets SyncLab off for each. */
const TRIGGERS = [
  {
    label: "A dependency breaks",
    body: "Dependabot or Renovate opens a pull request for a breaking npm release. SyncLab picks it up from there: the release notes, your usage of the package, and the code that has to change.",
  },
  {
    label: "An API breaks",
    body: "A provider retires a model or changes a parameter, often with no SDK release at all. SyncLab watches the provider, and its scanner already knows which of your calls the change reaches.",
  },
];

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
    title: "Knows where you call each API",
    body: "A scanner records every call your code makes to the APIs SyncLab watches: SDK methods and raw fetch or axios requests, with their parameters and model IDs.",
  },
  {
    title: "Watches the providers",
    body: "Spec diffs, deprecation tables, and changelogs, with evidence quoted word for word, so a retired model is fixed before its date arrives.",
  },
  {
    title: "Your model, your call",
    body: "Rewrites come from a local model by default, or from a hosted one when you want it.",
  },
  {
    title: "Every step on the record",
    body: "The dashboard follows each job through the pipeline live, with the full output of every step and a retry for failures.",
  },
];

/** Sign-in when the GitHub App is configured, otherwise the sample dashboard. */
function primaryAction() {
  return signInConfigured()
    ? { label: "Sign in with GitHub", href: "/auth/github?returnTo=%2Fdashboard" }
    : { label: "Open the dashboard", href: "/dashboard" };
}

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

const NAV_LINK = "label-mono hidden text-white/60 transition-colors hover:text-white md:block";

export default function LandingPage() {
  return (
    <div data-landing className="dark min-h-dvh overflow-x-clip bg-[#07090c] text-white">
      <LandingChrome />
      <div className="mx-auto max-w-[1440px] border-x border-white/10">
        <header className="sticky top-0 z-50 flex h-20 items-center justify-between border-b border-white/10 bg-[#07090c]/75 px-5 backdrop-blur-md sm:px-10">
          <Link href="/" className="flex items-center gap-3">
            <Mascot className="size-10" />
            <span className="font-serif text-[1.75rem] leading-none">SyncLab</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 md:gap-7">
            <SectionLink section="how" className={NAV_LINK}>
              How it works
            </SectionLink>
            <SectionLink section="faq" className={NAV_LINK}>
              FAQ
            </SectionLink>
            {/* Without sign-in, the button beside it already opens the dashboard. */}
            {signInConfigured() && (
              <Link href="/dashboard" className={NAV_LINK}>
                Dashboard
              </Link>
            )}
            <PrimaryAction className="h-9 px-3" />
          </nav>
        </header>

        <main id="main" tabIndex={-1} className="outline-none">
          <HeroField>
            <div className="flex flex-col gap-6">
              <Eyebrow>Dependency and API migrations</Eyebrow>
              <h1 id="hero-heading" className="font-serif text-[2.6rem] leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-7xl">
                Breaking changes that open their own pull requests.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-pretty text-white/65 sm:text-lg">
                When a dependency ships a breaking release, or an API you call changes under you, SyncLab finds the code
                that breaks, rewrites it, proves the fix with your own tests in a locked-down sandbox, and hands you a
                pull request to merge.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryAction />
                <Button asChild variant="ghost" size="lg" className="h-10 px-4 text-white/80 hover:bg-white/5 hover:text-white">
                  <SectionLink section="how">
                    How it works
                    <ArrowRight aria-hidden />
                  </SectionLink>
                </Button>
              </div>
            </div>
          </HeroField>

          <Band id="how" label="How it works" className="px-5 py-20 sm:px-10 sm:py-28">
            <div className="flex max-w-2xl flex-col gap-5">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">
                Two ways things break. One way they get fixed.
              </h2>
            </div>
            <ul className="mt-12 grid border-t border-l border-white/10 sm:grid-cols-2">
              {TRIGGERS.map((trigger) => (
                <li key={trigger.label} className="flex flex-col gap-3 border-r border-b border-white/10 p-6 sm:p-8">
                  <h3 className="text-lg font-medium">{trigger.label}</h3>
                  <p className="text-sm leading-relaxed text-pretty text-white/55">{trigger.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-12 max-w-2xl text-pretty text-white/60">
              Either way, the fix runs through the same stages in throwaway containers, and the repository&apos;s code
              never runs on the server that orchestrates them.
            </p>
            <div className="mt-14">
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

          <Band id="faq" label="FAQ" className="px-5 py-20 sm:px-10 sm:py-28">
            <Faq />
          </Band>
        </main>

        <SiteFooter action={primaryAction()} />
      </div>
    </div>
  );
}
