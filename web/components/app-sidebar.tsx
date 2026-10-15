"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { FolderGit2, GitPullRequestArrow } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Migrations", href: "/", icon: GitPullRequestArrow },
  { label: "Repositories", href: "/repositories", icon: FolderGit2 },
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
        <div className="flex flex-col gap-3">
          <ThemeToggle />
          <p className="border border-sidebar-border px-3 py-2.5 text-xs leading-relaxed text-sidebar-foreground/70">
            Showing sample data. The API has no read endpoints yet.
          </p>
        </div>
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
          (item.href === "/" ? pathname === "/" || pathname.startsWith("/jobs") : pathname.startsWith(item.href));
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
    <div className="flex items-center gap-2.5 px-1">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-6 text-sidebar-primary"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
      >
        <path d="M4 8h11a4 4 0 0 1 0 8H9" />
        <path d="M7 5 4 8l3 3" />
        <path d="m12 13-3 3 3 3" />
      </svg>
      <span className="text-base font-semibold tracking-tight">SyncLab</span>
    </div>
  );
}
