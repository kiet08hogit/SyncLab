import type { Metadata } from "next";
import { Fragment, Suspense, type CSSProperties } from "react";
import Link from "next/link";

import { AccountMenu } from "@/components/account-menu";
import { GithubSignIn } from "@/components/github-sign-in";
import type { Viewer } from "@/components/signed-in";
import { LandingChrome } from "@/components/landing/landing-chrome";
import { LandingIntro } from "@/components/landing/landing-intro";
import { WorkspaceHero } from "@/components/landing/workspace-hero";
import hero from "@/components/landing/workspace-hero.module.css";
import { IllustratedBeforeAfter, IllustratedCapabilities, IllustratedWorkflow } from "@/components/landing/illustrated-story";
import story from "@/components/landing/illustrated-story.module.css";
import { ScrollChapter } from "@/components/landing/scroll-chapter";
import { SectionLink } from "@/components/landing/section-link";
import { SiteFooter } from "@/components/landing/site-footer";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { signInConfigured } from "@/lib/auth";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: "SyncLab: breaking changes that open their own pull requests" },
};

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

function viewerOf(session: { login: string; name: string | null; avatarUrl: string }): Viewer {
  return { login: session.login, name: session.name, avatarUrl: session.avatarUrl };
}

const HEADER_ACTION = "h-9 px-2.5 min-[360px]:px-3 max-sm:[&_svg]:hidden";

/** Login, or the signed-in person. The cookie read stays inside Suspense. */
async function HeaderAccount() {
  const session = await getSession();
  if (!session) return <PrimaryAction className={HEADER_ACTION} />;
  return <AccountMenu viewer={viewerOf(session)} />;
}

function FooterFrame({ action }: { action: { label: string; href: string } }) {
  return (
    <div className="mx-auto max-w-[1440px] border-x border-white/10">
      <SiteFooter action={action} />
    </div>
  );
}

async function Footer() {
  const session = await getSession();
  const action = session ? { label: "Open the dashboard", href: "/dashboard" } : primaryAction();
  return <FooterFrame action={action} />;
}

const HEADLINE = "Code breaks. You keep shipping.";

const NAV_LINK = "label-mono hidden text-white/60 hover:text-white md:block";

export default function LandingPage() {
  return (
    <LandingIntro data-landing className="dark min-h-dvh overflow-x-clip bg-[#07090c] text-white">
      <LandingChrome />
      <div className="w-full">
        <header className={`${story.scrollHeader} fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between gap-3 px-4 min-[360px]:px-5 sm:px-10`}>
          <Link href="/" className="intro-fade flex items-center gap-1.5 min-[360px]:gap-2 sm:gap-3">
            <Mascot className="size-7 min-[360px]:size-8 sm:size-10" />
            <span className="font-serif text-xl leading-none min-[360px]:text-2xl sm:text-[1.75rem]">SyncLab</span>
          </Link>
          <nav aria-label="Main" className="intro-stagger flex items-center gap-1 md:gap-7">
            <SectionLink section="how" className={NAV_LINK}>
              How it works
            </SectionLink>
            {/* Without sign-in, the button beside it already opens the dashboard. */}
            {signInConfigured() && (
              <Link href="/dashboard" className={NAV_LINK}>
                Dashboard
              </Link>
            )}
            {/* On phones the label alone fits beside the wordmark. */}
            <Suspense fallback={<PrimaryAction className={HEADER_ACTION} />}>
              <HeaderAccount />
            </Suspense>
          </nav>
        </header>

        <main id="main" tabIndex={-1} className="outline-none">
          <section aria-labelledby="hero-heading" className={hero.chapter} data-hero-chapter>
            <div className={hero.stage}>
            <WorkspaceHero />
            <div className={hero.copy} data-hero-copy>
                <h1 id="hero-heading" className={`${hero.headline} font-serif`}>
                  {HEADLINE.split(" ").map((word, index, words) => (
                    <Fragment key={index}>
                      <span className="intro-word" style={{ "--word": index } as CSSProperties}>
                        {word}
                      </span>
                      {index < words.length - 1 && " "}
                    </Fragment>
                  ))}
                </h1>
            </div>
                <p className={hero.description} data-hero-description>
                  When a model retires, SyncLab finds the broken call, upgrades it, runs your tests, and opens a pull request for review.
                </p>
            </div>
          </section>

          <div className={`${story.paper} ${hero.story} mx-auto max-w-[1440px] border-x border-[#dfe1e6]`} data-story-paper>
            <ScrollChapter id="how" label="How it works" steps={5} length={230} kind="workflow">
              <div className={story.intro}>
                <div><span className={story.label}>How it works</span><h2>Understand the change.<br />Keep the code working.</h2></div>
                <p>SyncLab connects what changed outside your repository to the code inside it. Follow the evidence through a focused migration, your test suite, and a pull request for review.</p>
              </div>
              <IllustratedWorkflow />
            </ScrollChapter>

            <ScrollChapter label="Find and fix" steps={4} length={205} kind="capabilities">
              <div className={story.intro}>
                <div><span className={story.label}>Every step, connected</span><h2>From the first signal<br />to the final review.</h2></div>
                <p>Follow one change from signal to review. See the provider notice, affected calls, proposed edit, and test result together, right where your team works.</p>
              </div>
              <IllustratedCapabilities />
            </ScrollChapter>

            <ScrollChapter id="fix" label="A verified fix" steps={2} length={185} kind="proof">
              <div className={story.intro}>
                <div><span className={story.label}>The code stays. The API changes.</span><h2>The change arrives.<br />The fix has a path.</h2></div>
                <p>A breaking API can turn a quiet afternoon into hours of manual debugging. Follow the same engineer from chasing failed calls to calmly reviewing a focused, tested proposal from SyncLab.</p>
              </div>
              <IllustratedBeforeAfter />
            </ScrollChapter>
          </div>

        </main>

        <Suspense fallback={<FooterFrame action={primaryAction()} />}>
          <Footer />
        </Suspense>
      </div>
    </LandingIntro>
  );
}
