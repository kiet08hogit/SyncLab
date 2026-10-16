import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { GithubSignIn } from "@/components/github-sign-in";
import { NewMigrationForm } from "@/components/new-migration-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { signInConfigured } from "@/lib/auth";
import { getAccessibleRepositories, GithubUnauthorizedError, type InstalledRepository } from "@/lib/github";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "New migration" };

export default function NewMigrationPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Migrations
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">New migration</h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          Pick a repository, one of its dependencies, and the version to move to. SyncLab upgrades it in a sandbox,
          refactors what broke, runs the tests, and opens a pull request.
        </p>
      </header>
      <Suspense fallback={<FormSkeleton />}>
        <FormLoader />
      </Suspense>
    </div>
  );
}

async function FormLoader() {
  const session = await getSession();
  let repositories: InstalledRepository[] | null = null;
  if (session) {
    try {
      repositories = await getAccessibleRepositories(session.accessToken);
    } catch (error) {
      if (!(error instanceof GithubUnauthorizedError)) throw error;
    }
  }

  if (!repositories) {
    return (
      <Notice
        title={signInConfigured() ? "Sign in to start a migration" : "GitHub sign-in is not set up"}
        body="Migrations run against repositories where the SyncLab GitHub App is installed, so SyncLab needs to know who you are first."
      >
        {signInConfigured() ? (
          <GithubSignIn returnTo="/migrations/new" />
        ) : (
          <Button asChild variant="outline" size="lg" className="h-10 px-4">
            <Link href="/settings">Open settings</Link>
          </Button>
        )}
      </Notice>
    );
  }

  if (repositories.length === 0) {
    return (
      <Notice
        title="No repositories yet"
        body="SyncLab is not installed on any repository you can reach. Install it from Settings, then come back."
      >
        <Button asChild size="lg" className="h-10 px-4">
          <Link href="/settings">Go to installations</Link>
        </Button>
      </Notice>
    );
  }

  return <NewMigrationForm repositories={repositories} />;
}

function Notice({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="corner-mark flex flex-col items-start gap-4 border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        <p className="max-w-lg text-sm text-pretty text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading form"
      className="corner-mark flex flex-col gap-6 border bg-card p-5 sm:p-6"
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-40" />
    </div>
  );
}
