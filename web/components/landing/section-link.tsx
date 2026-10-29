"use client";

import type { ComponentProps } from "react";
import { scrollLandingTo } from "@/lib/landing-scroll";

/**
 * A link to a section of the landing page that scrolls there without adding
 * a history entry, so Back from the dashboard returns to the page itself
 * rather than stepping through every section the visitor jumped to.
 */
export function SectionLink({ section, ...props }: { section: string } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      {...props}
      href={`#${section}`}
      onClick={(event) => {
        const target = document.getElementById(section);
        if (!target || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        scrollLandingTo(window.scrollY + target.getBoundingClientRect().top - 80, smooth);
      }}
    />
  );
}
