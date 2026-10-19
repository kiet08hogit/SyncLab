import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** The public part of a session. The access token never leaves the server. */
export type Viewer = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

/** The GitHub login. Settings is where they can sign out from the app. */
export function SignedIn({ viewer, className }: { viewer: Viewer; className?: string }) {
  return (
    <Link href="/settings" className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Image src={viewer.avatarUrl} alt="" width={28} height={28} className="size-7 shrink-0 border border-current/15" />
      <span className="truncate">{viewer.login}</span>
    </Link>
  );
}
