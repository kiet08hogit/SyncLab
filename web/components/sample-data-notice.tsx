import { FlaskConical } from "lucide-react";

import { GithubSignIn } from "@/components/github-sign-in";
import { isLive } from "@/lib/data";

/** Tells a signed-out visitor that what they see is sample data, and how to see their own. */
export async function SampleDataNotice({ returnTo }: { returnTo: string }) {
  if (await isLive()) return null;
  return (
    <div className="flex flex-col gap-3 border border-dashed bg-accent/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
        <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-medium text-foreground">Sample data.</span> Sign in with GitHub to see the migrations on
          your own repositories.
        </span>
      </p>
      <GithubSignIn returnTo={returnTo} className="h-9 w-fit shrink-0 px-3" />
    </div>
  );
}
