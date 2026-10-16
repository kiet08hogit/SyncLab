"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 5_000;

/**
 * Re-renders the page's server components every few seconds while `active`.
 * The worker writes log rows as each phase ends, so polling picks them up
 * without a streaming endpoint. Pauses while the tab is hidden and catches up
 * as soon as it is shown again. The page stops it by rendering `active={false}`
 * once the job reaches a final status.
 */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => router.refresh(), INTERVAL_MS);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(timer);
      } else {
        router.refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, router]);

  return null;
}
