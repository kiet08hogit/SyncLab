"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

// Signed in, every page reads the SyncLab API. When it is down or no longer
// accepts the session, this is what the page shows instead of a blank screen.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">This page could not load</h1>
      <p className="text-pretty text-muted-foreground">
        The SyncLab API did not answer, or it no longer accepts your GitHub session. Check that the gateway is running,
        or sign in again from Settings.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => retry()} size="lg" className="h-10 px-4">
          <RotateCw aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline" size="lg" className="h-10 px-4">
          <Link href="/settings">Open settings</Link>
        </Button>
      </div>
    </div>
  );
}
