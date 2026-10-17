import { mascotSvg } from "@/lib/mascot";
import { cn } from "@/lib/utils";

// Static artwork from lib/mascot.ts, the same markup the favicon is built from.
const SVG = mascotSvg();

/** The SyncLab pup on its brand-blue tile. Decorative: it always sits next to the product name. */
export function Mascot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block shrink-0 [&>svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: SVG }}
    />
  );
}
