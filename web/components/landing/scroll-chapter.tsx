"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowDown } from "lucide-react";
import styles from "./illustrated-story.module.css";
import { scrollLandingTo } from "@/lib/landing-scroll";

const PIN_QUERY =
  "(min-width: 520px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";
const HEADER_HEIGHT = 80;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function subscribeCapability(listener: () => void) {
  const query = window.matchMedia(PIN_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const canPin = () => window.matchMedia(PIN_QUERY).matches;

type Sequence = {
  step: number;
  pinned: boolean;
  selectStep: (index: number) => void;
};
const SequenceContext = createContext<Sequence | null>(null);
export const useScrollChapter = () => useContext(SequenceContext);

/** Native scrolling advances the story; phones and reduced-motion views keep manual controls. */
export function ScrollChapter({
  id,
  label,
  steps,
  length,
  kind,
  children,
}: {
  id?: string;
  label: string;
  steps: number;
  length: number;
  kind: "workflow" | "capabilities" | "repositories" | "proof";
  children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const perimeter = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);
  const pinned = useSyncExternalStore(subscribeCapability, canPin, () => false);

  useEffect(() => {
    const element = root.current;
    const surface = sticky.current;
    if (!element || !surface || !pinned) return;
    let frame = 0;
    let width = perimeter.current?.offsetWidth ?? 0;
    let height = perimeter.current?.offsetHeight ?? 0;
    const update = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const distance = Math.max(1, box.height - surface.offsetHeight);
      const progress = clamp((HEADER_HEIGHT - box.top) / distance);
      const entering = clamp(
        (window.innerHeight - box.top) / (window.innerHeight - HEADER_HEIGHT),
      );
      element.style.setProperty("--chapter-progress", `${progress}`);
      element.style.setProperty("--chapter-entry", `${(1 - entering) * 18}px`);
      if (kind === "proof") {
        const mix = clamp((progress - 0.18) / 0.64);
        element.style.setProperty(
          "--proof-mix",
          `${mix * mix * (3 - 2 * mix)}`,
        );
      }
      const distanceAround = progress * (width + height) * 2;
      let x = 0,
        y = 0;
      if (distanceAround <= width) x = distanceAround;
      else if (distanceAround <= width + height) {
        x = width;
        y = distanceAround - width;
      } else if (distanceAround <= width * 2 + height) {
        x = width * 2 + height - distanceAround;
        y = height;
      } else y = (width + height) * 2 - distanceAround;
      if (marker.current)
        marker.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      setStep((current) => {
        const next = Math.min(steps - 1, Math.floor(progress * steps));
        return next === current ? current : next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === perimeter.current) {
          width = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width;
          height =
            entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
        }
      }
      schedule();
    });
    observer.observe(element);
    observer.observe(surface);
    if (perimeter.current) observer.observe(perimeter.current);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      element.style.removeProperty("--chapter-entry");
    };
  }, [pinned, steps, kind]);

  const selectStep = useCallback(
    (index: number) => {
      setStep(index);
      if (!pinned || !root.current || !sticky.current) return;
      const box = root.current.getBoundingClientRect();
      const start = window.scrollY + box.top - HEADER_HEIGHT;
      const distance = box.height - sticky.current.offsetHeight;
      // Keep explicit selection in the chosen scroll segment without a camera jump.
      const progress =
        index === 0 ? 0 : (index + (index === steps - 1 ? 0.8 : 0.15)) / steps;
      scrollLandingTo(start + distance * progress, false);
    },
    [pinned, steps],
  );

  const context = useMemo(
    () => ({ step, pinned, selectStep }),
    [step, pinned, selectStep],
  );
  return (
    <SequenceContext.Provider value={context}>
      <section
        ref={root}
        id={id}
        aria-label={label}
        className={`${styles.section} ${styles.scrollChapter}`}
        data-scroll-chapter={kind}
        data-pinned={pinned ? "true" : "false"}
        style={{ "--chapter-length": `${length}svh` } as CSSProperties}
      >
        <div ref={sticky} className={styles.chapterSticky}>
          <div
            ref={perimeter}
            className={styles.chapterFrame}
            aria-hidden="true"
            data-chapter-frame
          >
            <span
              ref={marker}
              className={styles.frameMarker}
              data-frame-marker
            />
          </div>
          {children}
          <div className={styles.scrollHint} aria-hidden="true">
            <span>
              <ArrowDown size={13} /> Scroll to explore
            </span>
            <span>
              {String(step + 1).padStart(2, "0")} /{" "}
              {String(steps).padStart(2, "0")}
            </span>
          </div>
        </div>
      </section>
    </SequenceContext.Provider>
  );
}
