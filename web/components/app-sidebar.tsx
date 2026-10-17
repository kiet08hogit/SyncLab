"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { FolderGit2, GitPullRequestArrow, Plus, Settings } from "lucide-react";

import { Mascot } from "@/components/mascot";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Migrations", href: "/dashboard", icon: GitPullRequestArrow },
  { label: "New migration", href: "/migrations/new", icon: Plus },
  { label: "Repositories", href: "/repositories", icon: FolderGit2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sidebar open={open} setOpen={setOpen} animate={false}>
      <SidebarBody className="justify-between gap-8 border-r border-sidebar-border" mobileBar={<Brand />}>
        <div className="flex flex-col gap-8">
          <Brand />
          {/* The pathname is request-time on dynamic routes, so only the highlight streams in. */}
          <Suspense fallback={<NavLinks pathname={null} onNavigate={close} />}>
            <CurrentNavLinks onNavigate={close} />
          </Suspense>
        </div>
        <ThemeToggle />
      </SidebarBody>
    </Sidebar>
  );
}

function CurrentNavLinks({ onNavigate }: { onNavigate: () => void }) {
  return <NavLinks pathname={usePathname()} onNavigate={onNavigate} />;
}

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active =
          pathname !== null &&
          (item.href === "/dashboard" ? pathname === "/dashboard" || pathname.startsWith("/jobs") : pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <SidebarLink
            key={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            link={{ label: item.label, href: item.href, icon: <Icon aria-hidden className="size-4 shrink-0" /> }}
            className={cn(
              "relative min-h-10 px-3 text-xs font-medium tracking-[0.08em] text-sidebar-foreground/70 uppercase transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              active &&
                "bg-sidebar-accent text-sidebar-foreground before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-sidebar-primary",
            )}
          />
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-1">
      <Mascot className="size-11" />
      <span className="text-2xl font-semibold tracking-tight">SyncLab</span>
    </div>
  );
}
