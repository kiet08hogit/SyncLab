"use client";

import { useLayoutEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { registerLandingScroll } from "@/lib/landing-scroll";

const BACKGROUND = "#07090c";

/**
 * Paints the whole document dark while the landing page shows, so overscroll
 * matches it. An effect rather than a CSS rule on the page's markup: after a
 * client-side navigation Next keeps this page mounted but hidden, and the
 * cleanup runs as it hides, handing the dashboard back its own colors.
 */
export function LandingChrome() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = {
      background: root.style.backgroundColor,
      scheme: root.style.colorScheme,
    };
    root.style.backgroundColor = BACKGROUND;
    root.style.colorScheme = "dark";
    const header = document.querySelector<HTMLElement>("[data-landing] header");
    const landing = document.querySelector<HTMLElement>("[data-landing]");
    const paper = document.querySelector<HTMLElement>("[data-story-paper]");
    const hero = document.querySelector<HTMLElement>("[data-hero-chapter]");
    const motion = window.matchMedia("(min-width: 760px) and (prefers-reduced-motion: no-preference)");
    let smooth: Lenis | null = null;
    const configureScroll = () => {
      smooth?.destroy();
      smooth = motion.matches ? new Lenis({ autoRaf: true, lerp: .12, smoothWheel: true, syncTouch: false, stopInertiaOnNavigate: true }) : null;
      registerLandingScroll(smooth);
      if (landing) landing.dataset.smoothScroll = smooth ? "true" : "false";
    };
    configureScroll();
    motion.addEventListener("change", configureScroll);
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = paper?.getBoundingClientRect();
      if (header) {
        const onPaper = !!box && box.top <= 80 && box.bottom > 80;
        const heroLight = hero && hero.getBoundingClientRect().bottom > 80 ? Number(landing?.style.getPropertyValue("--hero-light") || 0) : 0;
        const light = onPaper ? Math.max(0, Math.min(1, (box!.bottom - 20) / 60)) : heroLight;
        header.dataset.surface = onPaper ? "paper" : "dark";
        header.style.setProperty("--nav-light", String(light));
        header.style.setProperty("--nav-fill", String(onPaper ? light : 0));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    if (paper) observer.observe(paper);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      motion.removeEventListener("change", configureScroll);
      smooth?.destroy();
      registerLandingScroll(null);
      if (header) { delete header.dataset.surface; header.style.removeProperty("--nav-light"); header.style.removeProperty("--nav-fill"); }
      if (landing) delete landing.dataset.smoothScroll;
      root.style.backgroundColor = previous.background;
      root.style.colorScheme = previous.scheme;
    };
  }, []);
  return null;
}
