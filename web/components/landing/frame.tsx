import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A small crosshair where two frame lines meet. */
function Tick({ className }: { className: string }) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute z-10 size-[9px]", className)}>
      <span className="absolute top-1/2 left-0 h-px w-full bg-white/30" />
      <span className="absolute top-0 left-1/2 h-full w-px bg-white/30" />
    </span>
  );
}

/**
 * One band of the landing page: a hairline across the top with crosshairs at
 * the frame's edges, so the sections read as panels of one drawing.
 */
export function Band({
  id,
  label,
  children,
  className,
}: {
  id?: string;
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-label={label} className={cn("relative scroll-mt-16 border-t border-white/10", className)}>
      <Tick className="-top-[5px] -left-[5px]" />
      <Tick className="-top-[5px] -right-[5px]" />
      {children}
    </section>
  );
}

/** A section's tag line, in the dashboard's mono label style. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="label-mono flex items-center gap-2 text-white/50">
      <span aria-hidden className="size-1.5 bg-[#6f93ff]" />
      {children}
    </p>
  );
}
