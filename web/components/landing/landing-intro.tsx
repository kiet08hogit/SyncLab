"use client";

import { useEffect, useState, type ComponentProps } from "react";

/** Long enough for the last piece of the intro (the migration card) to land. */
const INTRO_MS = 2_000;

/**
 * Plays the landing intro (the `intro-*` classes in globals.css) once. Next
 * keeps this page mounted but hidden after a client-side navigation, and CSS
 * animations restart when a hidden element shows again, so the trigger comes
 * off once the intro has played and Back does not replay it.
 */
export function LandingIntro(props: ComponentProps<"div">) {
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setPlaying(false), INTRO_MS);
    return () => clearTimeout(timer);
  }, []);
  return <div {...props} data-intro={playing ? "playing" : "done"} />;
}
