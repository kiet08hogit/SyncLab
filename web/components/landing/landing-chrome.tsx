"use client";

import { useLayoutEffect } from "react";

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
    const previous = { background: root.style.backgroundColor, scheme: root.style.colorScheme };
    root.style.backgroundColor = BACKGROUND;
    root.style.colorScheme = "dark";
    return () => {
      root.style.backgroundColor = previous.background;
      root.style.colorScheme = previous.scheme;
    };
  }, []);
  return null;
}
