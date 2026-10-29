import type Lenis from "lenis";

let activeScroll: Lenis | null = null;

export function registerLandingScroll(instance: Lenis | null) {
  activeScroll = instance;
}

/** Keep links and stage controls on the same scroll clock as the wheel. */
export function scrollLandingTo(top: number, smooth = true) {
  if (activeScroll) {
    activeScroll.scrollTo(top, { immediate: !smooth, duration: .9 });
  } else {
    window.scrollTo({ top, behavior: smooth ? "smooth" : "instant" });
  }
}
