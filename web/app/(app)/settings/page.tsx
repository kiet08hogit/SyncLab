import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { IconBrandGithub } from "@tabler/icons-react";
import { CircleAlert, ExternalLink, LogOut, Plus, Settings2 } from "lucide-react";

import { signOut } from "@/app/auth/actions";
import { GithubSignIn } from "@/components/github-sign-in";
import { Mascot } from "@/components/mascot";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { signInConfigured } from "@/lib/auth";
import { getUserInstallations, GithubUnauthorizedError, installUrl, type Installation } from "@/lib/github";
import { formatDate, timeAgo } from "@/lib/format";
import { getSession, type Session } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

const ERRORS: Record<string, string> = {
  "not-configured": "GitHub sign-in is not configured on this server yet.",
  denied: "Sign-in was cancelled on GitHub. Nothing was changed.",
  state: "The sign-in link expired or was opened in another browser. Try again.",
  github: "GitHub did not accept the sign-in. Try again in a moment.",
};

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">Settings</h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          Connect your GitHub account to see where SyncLab is installed and to start migrations by hand.
        </p>
      </header>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SettingsContent({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const { error } = await searchParams;
  const errorMessage = typeof error === "string" ? ERRORS[error] : undefined;
  const session = await getSession();

  let installations: Installation[] | null = null;
  let expired = false;
  if (session) {
    try {
      installations = await getUserInstallations(session.accessToken);
    } catch (cause) {
      if (!(cause instanceof GithubUnauthorizedError)) throw cause;
      expired = true;
    }
  }
  const signedIn = session && !expired ? session : null;

  return (
    <>
      <section aria-labelledby="account-heading" className="flex flex-col gap-3">
        <h2 id="account-heading" className="label-mono text-muted-foreground">
          GitHub account
        </h2>
        {(errorMessage || expired) && (
          <p
            role="alert"
            className="flex items-center gap-2.5 border border-status-failed/30 bg-status-failed/10 px-4 py-3 text-sm"
          >
            <CircleAlert aria-hidden className="size-4 shrink-0 text-status-failed" />
            {expired ? "Your GitHub session is no longer valid. Sign in again to continue." : errorMessage}
          </p>
        )}
        {signedIn ? <Account session={signedIn} /> : signInConfigured() ? <SignedOut /> : <NotConfigured />}
      </section>

      {signedIn && installations && (
        <section aria-labelledby="installations-heading" className="flex flex-col gap-3">
          <h2 id="installations-heading" className="label-mono text-muted-foreground">
            Installations
          </h2>
          {installations.length > 0 ? <InstallationList installations={installations} /> : <NoInstallations />}
        </section>
      )}
    </>
  );
}

function Account({ session }: { session: Session }) {
  const expires = new Date(session.expiresAt).toISOString();
  return (
    <div className="corner-mark flex flex-col gap-4 border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Image
          src={session.avatarUrl}
          alt=""
          width={48}
          height={48}
          className="size-12 shrink-0 border border-border"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate font-semibold">{session.name ?? session.login}</p>
          <p className="flex flex-col gap-x-2 gap-y-0.5 text-sm text-muted-foreground sm:flex-row sm:items-center">
            <span className="inline-flex items-center gap-1">
              <IconBrandGithub aria-hidden className="size-3.5" />@{session.login}
            </span>
            <span aria-hidden className="max-sm:hidden">
              ·
            </span>
            <span>
              Session ends{" "}
              <time dateTime={expires} title={formatDate(expires)}>
                {timeAgo(expires)}
              </time>
            </span>
          </p>
        </div>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="outline" size="lg" className="h-10 px-4">
          <LogOut aria-hidden />
          Sign out
        </Button>
      </form>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="corner-mark flex flex-col gap-5 border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center bg-foreground text-background">
          <IconBrandGithub aria-hidden className="size-7" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Sign in with GitHub</p>
          <p className="max-w-md text-sm text-pretty text-muted-foreground">
            SyncLab only sees the accounts and repositories where you and the SyncLab App both have access.
          </p>
        </div>
      </div>
      <GithubSignIn className="w-fit shrink-0" />
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="corner-mark flex flex-col gap-4 border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center border border-dashed text-muted-foreground">
          <IconBrandGithub aria-hidden className="size-7" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-semibold">GitHub sign-in is not set up</p>
          <p className="max-w-xl text-sm text-pretty text-muted-foreground">
            Add the SyncLab GitHub App&apos;s credentials to <code className="font-mono text-xs">web/.env.local</code>{" "}
            and restart the dashboard. <code className="font-mono text-xs">web/.env.example</code> lists every variable.
          </p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-2 sm:pl-16">
        {["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_APP_SLUG", "SESSION_SECRET"].map((name) => (
          <li key={name} className="bg-log px-2 py-1 font-mono text-xs text-foreground/85">
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InstallationList({ installations }: { installations: Installation[] }) {
  return (
    <ul className="corner-mark flex flex-col border bg-card">
      {installations.map((installation) => (
        <li
          key={installation.id}
          className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <Image
              src={installation.account.avatar_url}
              alt=""
              width={40}
              height={40}
              className="size-10 shrink-0 border border-border"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="flex flex-wrap items-center gap-2">
                <a
                  href={installation.account.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-medium hover:underline"
                >
                  {installation.account.login}
                </a>
                <span className="border px-1.5 py-0.5 label-mono text-[0.625rem] text-muted-foreground">
                  {installation.account.type === "Organization" ? "Organization" : "Personal"}
                </span>
                {installation.suspended_at && (
                  <span className="bg-status-failed/12 px-1.5 py-0.5 label-mono text-[0.625rem] text-status-failed">
                    Suspended
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {installation.repository_selection === "all" ? "All repositories" : "Selected repositories"} · installed{" "}
                <time dateTime={installation.created_at} title={formatDate(installation.created_at)}>
                  {timeAgo(installation.created_at)}
                </time>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="ghost" size="lg" className="h-9 px-3 max-sm:-ml-3">
              <a href={installation.html_url} target="_blank" rel="noreferrer">
                <Settings2 aria-hidden />
                Configure
                <ExternalLink aria-hidden className="size-3.5 text-muted-foreground" />
              </a>
            </Button>
            {!installation.suspended_at && (
              <Button asChild variant="outline" size="lg" className="h-9 px-3">
                <Link href="/migrations/new">
                  <Plus aria-hidden />
                  New migration
                </Link>
              </Button>
            )}
          </div>
        </li>
      ))}
      <li className="flex flex-col gap-3 bg-accent/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-sm text-muted-foreground">Missing an account or organization?</p>
        <InstallButton variant="outline" label="Install on another account" />
      </li>
    </ul>
  );
}

function NoInstallations() {
  return (
    <div className="corner-mark flex flex-col items-center gap-5 border bg-card px-6 py-14 text-center">
      <Mascot className="size-14" />
      <div className="flex flex-col gap-1.5">
        <p className="text-lg font-semibold">SyncLab is not installed anywhere you can reach</p>
        <p className="max-w-md text-sm text-pretty text-muted-foreground">
          Install the GitHub App on your account or an organization, then pick the repositories SyncLab should keep up
          to date.
        </p>
      </div>
      <InstallButton label="Install SyncLab" />
      <BorderBeam
        size={90}
        duration={8}
        colorFrom="var(--primary)"
        colorTo="#58cdff"
        className="motion-reduce:hidden"
      />
    </div>
  );
}

function InstallButton({ label, variant = "default" }: { label: string; variant?: "default" | "outline" }) {
  const href = installUrl();
  if (!href) {
    return (
      <p className="text-sm text-muted-foreground">
        Set <code className="font-mono text-xs">GITHUB_APP_SLUG</code> to show the install link.
      </p>
    );
  }
  return (
    <Button asChild variant={variant} size="lg" className="h-10 gap-2 px-4">
      <a href={href} target="_blank" rel="noreferrer">
        <IconBrandGithub aria-hidden className="size-4.5" />
        {label}
        <ExternalLink aria-hidden className="size-3.5 opacity-70" />
      </a>
    </Button>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings" className="flex flex-col gap-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-[98px] w-full" />
    </div>
  );
}
