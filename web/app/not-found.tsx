import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="text-muted-foreground">
          The job or page you followed may have been removed, or the link is mistyped.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to migrations</Link>
        </Button>
      </div>
    </AppShell>
  );
}
