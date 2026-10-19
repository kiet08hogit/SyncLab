"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { cellPart, depth, DUST, GLYPHS, hash, pick, pupPart, RIPPLE_GLYPHS, rippleEnergy, scramble, type PupPart } from "@/lib/ascii";
import { mascotSvg } from "@/lib/mascot";

const DIGITS = "0123456789.";
const IDENTIFIER = "abcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * The two kinds of break SyncLab fixes, taking turns: a dependency's breaking
 * release, and a provider changing its API under code that did not change.
 */
const MIGRATIONS = [
  {
    file: "package.json",
    open: '"dependencies": {',
    from: '"zod": "^3.23.8"',
    to: '"zod": "^4.1.0"',
    close: "}",
    found: "breaking release",
    noise: DIGITS,
  },
  {
    file: "src/summarize.ts",
    open: "client.messages.create({",
    from: 'model: "chat-large-2024-06",',
    to: 'model: "chat-large-2026-04",',
    close: "})",
    found: "model retired",
    noise: IDENTIFIER,
  },
  {
    file: "package.json",
    open: '"dependencies": {',
    from: '"next": "^14.2.5"',
    to: '"next": "^15.1.0"',
    close: "}",
    found: "breaking release",
    noise: DIGITS,
  },
  {
    file: "src/chat.ts",
    open: "client.completions.create({",
    from: "max_tokens: 1024,",
    to: "max_output_tokens: 1024,",
    close: "})",
    found: "parameter renamed",
    noise: IDENTIFIER,
  },
];

const FONT_PX = 11;
const LINE = 1.25;
const CYCLE_MS = 5200;
const SCRAMBLE_MS = 1100;
const RIPPLE = { speed: 0.42, band: 70, life: 3600 };
const POINTER_RADIUS = 110;
/** Where the face sits in the 64x64 mascot art, as a share of its height. */
const FACE_Y = 0.52;
/** The art is a bust: below this share of its height the pup fades out instead of ending in a hard edge. */
const FADE_FROM = 0.9;
/** The intro: cells appear over this long, each showing a blue digit briefly before its own glyph. */
const INTRO = { pupSpread: 900, dustSpread: 1500, decode: 320, start: 250 };

const BLUE = [90, 131, 255] as const;
const COLORS: Record<PupPart | "dust", readonly [number, number, number]> = {
  fur: [244, 240, 232],
  patch: [214, 206, 196],
  ear: [200, 196, 190],
  face: [111, 147, 255],
  collar: [120, 128, 148],
  tag: [255, 255, 255],
  arrow: BLUE,
  dust: [237, 239, 247],
};
const ALPHA: Record<PupPart | "dust", number> = { fur: 0.92, patch: 0.6, ear: 0.5, face: 1, collar: 0.45, tag: 0.95, arrow: 1, dust: 0.1 };

interface Cell {
  x: number;
  y: number;
  part: PupPart | "dust";
  /** Stable per-cell noise, for glyph choice and twinkle. */
  seed: number;
  /** For fur, how far inside the outline the cell sits, which picks its density. */
  shade: number;
  /** When, in ms after the intro starts, the cell appears. */
  delay: number;
  /** 1, falling to 0 across the bottom of the bust. */
  fade: number;
}

/** Samples the pup into character cells that sit at `left`, `top`, `size` (in cells). */
async function sampleMascot(cols: number, rows: number, cellW: number, cellH: number): Promise<Array<[number, number, PupPart]>> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mascotSvg({ tile: false }))}`;
  await image.decode();
  // Rendered at 4x, so each cell votes over 16 pixels (see cellPart).
  const scale = 4;
  const canvas = document.createElement("canvas");
  canvas.width = cols * scale;
  canvas.height = rows * scale;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // Cells are taller than wide, so squash the art vertically to keep the pup's proportions.
  ctx.drawImage(image, 0, 0, cols * scale, ((cols * cellW) / cellH) * scale);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out: Array<[number, number, PupPart]> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const samples: PupPart[] = [];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((y * scale + sy) * canvas.width + x * scale + sx) * 4;
          if (data[i + 3] >= 140) samples.push(pupPart(data[i], data[i + 1], data[i + 2]));
        }
      }
      // A cell needs half its area covered to be drawn at all.
      const part = samples.length >= (scale * scale) / 2 ? cellPart(samples) : null;
      if (part) out.push([x, y, part]);
    }
  }
  return out;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The landing hero's backdrop: the SyncLab pup in characters, and a line of
 * code that keeps getting migrated, from a dependency bump to an API change.
 * Each rewrite sends a ripple of version digits out through the field. The
 * pointer stirs the characters near it. With reduced motion it draws one
 * still frame.
 */
export function HeroField({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  // Set once, so neither a resize nor showing the page again replays the intro.
  const introStart = useRef<number | null>(null);
  const [step, setStep] = useState(0);
  const [line, setLine] = useState(MIGRATIONS[0].from);
  const [phase, setPhase] = useState<"idle" | "migrating" | "done">("idle");
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  const migration = reduced ? MIGRATIONS[0] : MIGRATIONS[step % MIGRATIONS.length];
  // Still, the card shows the first migration already done.
  const shown = reduced ? { line: MIGRATIONS[0].to, phase: "done" as const } : { line, phase };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cells: Cell[] = [];
    let cellW = 7;
    let cellH = FONT_PX * LINE;
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let disposed = false;
    let generation = 0;
    const ripples: Array<{ x: number; y: number; start: number }> = [];
    const pointer = { x: -1e4, y: -1e4, energy: 0 };

    async function layout() {
      const current = ++generation;
      // Measure the cell only once JetBrains Mono has loaded, or the grid is sized for the fallback font.
      await document.fonts.ready;
      // Navigating away hides this page (Next keeps it mounted in an Activity) and detaches the refs.
      const slotElement = slotRef.current;
      if (disposed || current !== generation || !slotElement) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `500 ${FONT_PX}px ${getComputedStyle(canvas).getPropertyValue("--font-jetbrains") || "monospace"}, ui-monospace, monospace`;
      ctx.textBaseline = "top";
      cellW = Math.ceil(ctx.measureText("M").width) + 1;
      cellH = Math.round(FONT_PX * LINE);
      const cols = Math.ceil(width / cellW);
      const rows = Math.ceil(height / cellH);

      // The pup fills the slot the layout leaves for it. Beside the copy, its face lines
      // up with the headline; above the copy on narrow screens, it sits on the slot's
      // bottom edge.
      const slot = slotElement.getBoundingClientRect();
      const side = Math.min(slot.width, slot.height * 0.97);
      const pupRows = Math.max(8, Math.floor(side / cellH));
      const pupCols = Math.round((pupRows * cellH) / cellW);
      const left = Math.round((slot.left - rect.left + slot.width / 2) / cellW - pupCols / 2);
      const heading = canvas.closest("section")?.querySelector("h1")?.getBoundingClientRect();
      const beside = slot.left - rect.left > rect.width * 0.3;
      const top =
        beside && heading
          ? Math.min(
              rows - Math.round(pupRows * FADE_FROM),
              Math.max(1, Math.round((heading.top + heading.height / 2 - rect.top) / cellH - pupRows * FACE_Y)),
            )
          : Math.round((slot.bottom - rect.top) / cellH) - pupRows;
      const pup = await sampleMascot(pupCols, pupRows, cellW, cellH);
      if (disposed || current !== generation) return;

      // Fur shades against everything that is not fur, so the ears outline the face.
      const fur = new Set(pup.filter(([, , part]) => part !== "ear").map(([x, y]) => y * pupCols + x));
      const isFur = (x: number, y: number) => fur.has(y * pupCols + x) || y >= pupRows;
      // The pup decodes outward from its middle.
      const reach = Math.hypot(pupCols, pupRows) / 2;
      const taken = new Set<number>();
      const next: Cell[] = [];
      for (const [x, y, part] of pup) {
        const cx = left + x;
        const cy = top + y;
        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
        taken.add(cy * cols + cx);
        const seed = hash(cx, cy);
        const fromMiddle = Math.hypot(x - pupCols / 2, y - pupRows / 2) / reach;
        next.push({
          x: cx,
          y: cy,
          part,
          seed,
          shade: part === "fur" || part === "patch" ? depth(isFur, x, y, 3) : 0,
          delay: INTRO.start + fromMiddle * INTRO.pupSpread + seed * 200,
          fade: Math.min(1, Math.max(0, (1 - y / pupRows) / (1 - FADE_FROM))),
        });
      }
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (taken.has(y * cols + x) || hash(x, y, 7) >= 0.07) continue;
          const seed = hash(x, y, 3);
          next.push({ x, y, part: "dust", seed, shade: 0, delay: INTRO.start + hash(x, y, 9) * INTRO.dustSpread, fade: 1 });
        }
      }
      if (!reduced && introStart.current === null) introStart.current = performance.now();
      cells = next;
      draw(performance.now());
    }

    function draw(now: number) {
      ctx.clearRect(0, 0, width, height);
      while (ripples.length && now - ripples[0].start > RIPPLE.life) ripples.shift();
      pointer.energy *= 0.94;
      const tick = Math.floor(now / 140);
      const sinceIntro = introStart.current === null ? Infinity : now - introStart.current;

      for (const cell of cells) {
        if (sinceIntro < cell.delay) continue;
        // Freshly revealed: a blue digit for a moment, then the cell's own glyph.
        const decoding = Math.max(0, 1 - (sinceIntro - cell.delay) / INTRO.decode);
        const px = cell.x * cellW;
        const py = cell.y * cellH;
        let energy = 0;
        for (const ripple of ripples) {
          const age = now - ripple.start;
          energy = Math.max(energy, rippleEnergy(Math.hypot(px - ripple.x, py - ripple.y), age * RIPPLE.speed, RIPPLE.band, age, RIPPLE.life));
        }
        const near = Math.max(0, 1 - Math.hypot(px - pointer.x, py - pointer.y) / POINTER_RADIUS);
        energy = Math.max(energy, near * near * 0.55 * pointer.energy);

        const base = COLORS[cell.part];
        let alpha = ALPHA[cell.part] * cell.fade;
        // Fur takes its density from its depth, with a little grain; a few cells flicker now and then.
        const flicker = hash(cell.x, cell.y, Math.floor(now / 2400)) < 0.03 ? 0.12 : 0;
        let glyph =
          cell.part === "dust"
            ? pick(DUST, cell.seed)
            : cell.part === "fur" || cell.part === "patch"
              ? pick(GLYPHS[cell.part], Math.min(0.999, Math.max(0, cell.shade ** 2.2 * 0.82 + (cell.seed - 0.5) * 0.34 + flicker)))
              : pick(GLYPHS[cell.part], cell.seed);
        if (cell.part === "dust") alpha *= 0.55 + 0.45 * Math.sin(now / 1700 + cell.seed * 40);

        if (energy > 0.02) {
          if (hash(cell.x, cell.y, tick) < energy) glyph = pick(RIPPLE_GLYPHS, hash(cell.y, cell.x, tick));
          alpha = Math.min(1, alpha + energy * (cell.part === "dust" ? 0.9 : 0.4));
        }
        if (decoding > 0) {
          // Offset from the small seeds above: tick passes 7 (the dust seed) during the intro.
          glyph = pick(RIPPLE_GLYPHS, hash(cell.x, cell.y, tick + 10_000));
          alpha = Math.min(1, alpha + decoding * 0.4);
        }
        const mix = cell.part === "arrow" ? 1 : Math.min(1, Math.max(energy * 1.3, decoding));
        const r = base[0] + (BLUE[0] - base[0]) * mix;
        const g = base[1] + (BLUE[1] - base[1]) * mix;
        const b = base[2] + (BLUE[2] - base[2]) * mix;
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
        ctx.fillText(glyph, px, py);
      }
    }

    function loop(now: number) {
      if (visible && !document.hidden) draw(now);
      frame = requestAnimationFrame(loop);
    }

    // Each rewrite ends with a ripple from where the changing line sits.
    const onRipple = () => {
      const line = lineRef.current?.getBoundingClientRect();
      const box = canvas.getBoundingClientRect();
      if (!line) return;
      ripples.push({ x: line.left + line.width / 2 - box.left, y: line.top + line.height / 2 - box.top, start: performance.now() });
    };
    const onPointer = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.energy = 1;
    };

    const resize = new ResizeObserver(() => void layout());
    resize.observe(canvas);
    resize.observe(slotRef.current!);
    const seen = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    seen.observe(canvas);
    canvas.addEventListener("synclab:ripple", onRipple);
    if (!reduced) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      frame = requestAnimationFrame(loop);
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      canvas.removeEventListener("synclab:ripple", onRipple);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  // The changing line: wait, rewrite it, ripple, then move on to the next migration.
  useEffect(() => {
    if (reduced) return;
    const current = MIGRATIONS[step % MIGRATIONS.length];
    let raf = 0;
    const timers = [
      setTimeout(() => {
        setPhase("migrating");
        const start = performance.now();
        const run = (now: number) => {
          const progress = Math.min(1, (now - start) / SCRAMBLE_MS);
          setLine(scramble(current.from, current.to, progress, (i) => hash(i, Math.floor(now / 60), 11), current.noise));
          if (progress < 1) {
            raf = requestAnimationFrame(run);
          } else {
            setPhase("done");
            canvasRef.current?.dispatchEvent(new Event("synclab:ripple"));
          }
        };
        raf = requestAnimationFrame(run);
      }, 1400),
      setTimeout(() => {
        const next = MIGRATIONS[(step + 1) % MIGRATIONS.length];
        setStep(step + 1);
        setLine(next.from);
        setPhase("idle");
      }, CYCLE_MS),
    ];
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
    };
  }, [step, reduced]);

  return (
    <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden">
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 -z-10 size-full" />
      {/* Keeps ripples and specks from crossing the copy: under it on narrow screens, beside it on wide ones. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_top,#07090c_40%,transparent_62%)] min-[900px]:bg-[linear-gradient(to_right,#07090c_32%,rgba(7,9,12,0.55)_48%,transparent_60%)]"
      />
      <div className="grid min-h-[calc(100dvh-12rem)] min-[900px]:grid-cols-[minmax(0,56%)_minmax(0,1fr)]">
        {/* Empty: the canvas draws the pup into this box. */}
        <div ref={slotRef} data-pup-slot aria-hidden className="h-[38svh] min-[900px]:order-last min-[900px]:h-auto" />
        <div className="flex flex-col justify-end gap-10 px-5 pb-14 sm:px-10 min-[900px]:justify-center min-[900px]:py-16">
          {children}
          <figure style={{ "--delay": "950ms" } as CSSProperties} className="intro-fade relative w-full max-w-sm border border-white/10 bg-[#07090c]/80 font-mono text-[13px] leading-relaxed backdrop-blur-sm">
            <figcaption className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-2 text-[11px] text-white/45">
              <span>{migration.file}</span>
              <span aria-hidden className={shown.phase === "done" ? "text-[#6f93ff]" : undefined}>
                {shown.phase === "idle" ? migration.found : shown.phase === "migrating" ? "migrating…" : "pull request opened"}
              </span>
            </figcaption>
            <pre aria-hidden className="overflow-hidden px-4 py-3 text-white/55">
              {`${migration.open}\n  `}
              <span ref={lineRef} className={shown.phase === "idle" ? "text-white/85" : "text-[#6f93ff]"}>
                {shown.line}
              </span>
              {`\n${migration.close}`}
            </pre>
            <p className="sr-only">
              For example, SyncLab upgrades zod from 3.23.8 to 4.1.0, replaces a retired model, and moves an API call to
              a renamed parameter, each time opening a pull request.
            </p>
          </figure>
        </div>
      </div>
    </section>
  );
}
