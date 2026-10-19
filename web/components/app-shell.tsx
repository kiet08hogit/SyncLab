import { AppSidebar } from "@/components/app-sidebar";

/** The dashboard's frame: the sidebar beside a scrolling main column. */
export function AppShell({ account, children }: { account?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
      <AppSidebar account={account} />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none md:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
