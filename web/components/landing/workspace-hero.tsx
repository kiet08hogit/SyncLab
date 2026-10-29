"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { heroCopyHidden, WORKSPACE_FPS, WORKSPACE_FRAMES, workspaceCamera } from "@/lib/workspace-camera";
import styles from "./workspace-hero.module.css";

const CAMERA_QUERY = "(min-width: 760px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";

/** Native scroll scrubs the supplied 0:02-0:06 segment, then the replacement monitor gleam. */
export function WorkspaceHero() {
  const root = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = root.current, video = film.current;
    const chapter = element?.closest<HTMLElement>("[data-hero-chapter]");
    const landing = element?.closest<HTMLElement>("[data-landing]");
    if (!element || !video || !chapter || !landing) return;
    const capable = window.matchMedia(CAMERA_QUERY);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, desiredTime = 0;
    const seek = () => {
      if (!capable.matches || video.readyState < 2 || video.seeking || !Number.isFinite(video.duration)) return;
      const time = Math.min(desiredTime, Math.max(0, video.duration - 1 / WORKSPACE_FPS));
      if (Math.abs(video.currentTime - time) >= 1 / WORKSPACE_FPS) video.currentTime = time;
    };
    const ready = () => { element.dataset.videoReady = "true"; seek(); };
    const error = () => { element.dataset.videoReady = "false"; };
    const update = () => {
      frame = 0;
      const box = chapter.getBoundingClientRect();
      const distance = Math.max(1, box.height - window.innerHeight);
      const progress = capable.matches ? Math.max(0, Math.min(1, -box.top / distance)) : 0;
      const state = workspaceCamera(progress);
      chapter.style.setProperty("--hero-copy", String(state.copy));
      chapter.style.setProperty("--hero-shade", String(state.copy));
      landing.style.setProperty("--hero-handoff", String(capable.matches ? state.handoff : 1));
      landing.style.setProperty("--hero-light", String(capable.matches ? state.paper : 0));
      element.style.setProperty("--hero-progress", String(progress));
      element.style.setProperty("--hero-gleam", String(state.gleam));
      element.dataset.motion = reduced.matches ? "reduced" : capable.matches ? "scroll" : "static";
      if (paper.current) paper.current.style.opacity = String(state.paper);
      if (capable.matches && !video.getAttribute("src")) { video.src = "/videos/hero-office-gleam-v2.mp4"; video.load(); }
      desiredTime = progress * (WORKSPACE_FRAMES - 1) / WORKSPACE_FPS;
      seek();
      for (const copy of chapter.querySelectorAll<HTMLElement>("[data-hero-copy], [data-hero-description]")) {
        const copyBox = copy.getBoundingClientRect();
        copy.inert = heroCopyHidden(capable.matches, state.copy, copyBox.top, copyBox.bottom, window.innerHeight);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(element); resize.observe(chapter);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    capable.addEventListener("change", schedule);
    reduced.addEventListener("change", schedule);
    video.addEventListener("loadeddata", ready);
    video.addEventListener("seeked", seek);
    video.addEventListener("error", error);
    schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      capable.removeEventListener("change", schedule);
      reduced.removeEventListener("change", schedule);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("seeked", seek);
      video.removeEventListener("error", error);
      landing.style.removeProperty("--hero-handoff");
      landing.style.removeProperty("--hero-light");
    };
  }, []);
  return (
    <div ref={root} className={styles.background} aria-hidden="true" data-workspace-hero>
      <div className={styles.fallback} data-hero-fallback>
        <Image src="/videos/hero-office-start.png" alt="" fill preload sizes="100vw" style={{ objectFit: "cover" }} />
        <div ref={paper} className={styles.paperFade} />
      </div>
      <video ref={film} className={styles.film} muted playsInline preload="auto" disablePictureInPicture tabIndex={-1} data-hero-film />
      <div className={styles.shade} />
    </div>
  );
}
