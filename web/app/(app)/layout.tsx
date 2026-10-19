import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { SignedIn, type Viewer } from "@/components/signed-in";
import { getSession } from "@/lib/session";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      account={
        <Suspense fallback={null}>
          <Account />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}

async function Account() {
  const session = await getSession();
  if (!session) return null;
  const viewer: Viewer = { login: session.login, name: session.name, avatarUrl: session.avatarUrl };
  return <SignedIn viewer={viewer} className="h-10 px-1 text-sm text-sidebar-foreground" />;
}
