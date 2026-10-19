import type { ReactNode } from "react";
import { IconBrandGithub } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A plain link rather than a client handler: /auth/github answers with a
 * redirect to GitHub, so it works before hydration and without JavaScript.
 */
export function GithubSignIn({
  returnTo,
  className,
  label = "Continue with GitHub",
}: {
  returnTo?: string;
  className?: string;
  label?: ReactNode;
}) {
  const href = returnTo ? `/auth/github?returnTo=${encodeURIComponent(returnTo)}` : "/auth/github";
  return (
    <Button
      asChild
      size="lg"
      className={cn("h-10 gap-2 bg-foreground px-4 text-background hover:bg-foreground/85", className)}
    >
      <a href={href}>
        <IconBrandGithub aria-hidden className="size-5" />
        {label}
      </a>
    </Button>
  );
}
