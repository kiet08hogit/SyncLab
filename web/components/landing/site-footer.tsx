import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Tick } from "@/components/landing/frame";
import { SectionLink } from "@/components/landing/section-link";

const REPOSITORY = "https://github.com/kiet08hogit/SyncLab";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "New migration", href: "/migrations/new" },
      { label: "Repositories", href: "/repositories" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "How it works", section: "how" },
      { label: "FAQ", section: "faq" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source on GitHub", href: REPOSITORY, external: true },
      { label: "Architecture", href: `${REPOSITORY}#readme`, external: true },
    ],
  },
];

/** The closing panel: one line, a framed action, and the site's links. */
export function SiteFooter({ action }: { action: { label: string; href: string } }) {
  return (
    <footer className="border-t border-white/10">
      <div className="grid gap-16 px-5 pt-20 pb-16 sm:px-10 min-[900px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col items-start gap-8">
          <p className="max-w-2xl font-serif text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl">
            Breaking changes, fixed in a pull request.
          </p>
          {/* Framed like the page: a hairline box with a crosshair at each corner. */}
          <a
            href={action.href}
            className="label-mono relative inline-flex items-center gap-2 border border-white/25 px-6 py-3.5 text-white transition-colors hover:bg-white/5"
          >
            <Tick className="-top-[5px] -left-[5px]" />
            <Tick className="-top-[5px] -right-[5px]" />
            <Tick className="-bottom-[5px] -left-[5px]" />
            <Tick className="-right-[5px] -bottom-[5px]" />
            {action.label}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-4">
              <h2 className="text-white/45">{column.title}</h2>
              <ul className="flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {"section" in link ? (
                      <SectionLink section={link.section} className="text-white/80 transition-colors hover:text-white">
                        {link.label}
                      </SectionLink>
                    ) : "external" in link ? (
                      <a href={link.href} className="text-white/80 transition-colors hover:text-white">
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className="text-white/80 transition-colors hover:text-white">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="label-mono flex flex-col gap-2 border-t border-white/10 px-5 py-6 text-white/35 sm:flex-row sm:justify-between sm:px-10">
        <span>SyncLab</span>
        <span>Dependency and API migrations, opened as pull requests</span>
      </div>
    </footer>
  );
}
