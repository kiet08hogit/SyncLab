import { MASCOT_COLORS } from "@/lib/mascot";

// The landing hero redraws the mascot as a field of characters. These helpers
// are the parts that do not need a canvas, so they can be tested on their own.

export type PupPart = "fur" | "patch" | "ear" | "face" | "tag" | "arrow" | "collar";

const PARTS: Array<[PupPart, string]> = [
  ["fur", MASCOT_COLORS.fur],
  ["ear", MASCOT_COLORS.ear],
  ["patch", MASCOT_COLORS.patch],
  ["collar", MASCOT_COLORS.collar],
  ["tag", MASCOT_COLORS.shine],
  ["arrow", MASCOT_COLORS.arrow],
];

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const PALETTE = PARTS.map(([part, hex]) => [part, rgb(hex)] as const);

/**
 * Which part of the pup a sampled pixel belongs to, by the nearest mascot
 * color. The eyes, nose and mouth (the darkest brown) are the face.
 */
export function pupPart(r: number, g: number, b: number): PupPart {
  const [fr, fg, fb] = rgb(MASCOT_COLORS.feature);
  let best: PupPart = "face";
  let distance = (r - fr) ** 2 + (g - fg) ** 2 + (b - fb) ** 2;
  for (const [part, [pr, pg, pb]] of PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < distance) [best, distance] = [part, d];
  }
  return best;
}

/** A stable pseudo-random number in [0, 1) for a cell, so the field does not shimmer at random. */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374_761_393 + y * 668_265_263 + seed * 2_147_483_647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
}

/** For fur and the patch, ordered light to dense: edge cells take the start, the middle the end. */
export const GLYPHS: Record<PupPart, string> = {
  fur: ".:-=+*#%@",
  patch: ".:-=+*#%@",
  ear: ".::;",
  face: "@",
  collar: "=",
  tag: "#",
  arrow: "^",
};

/** Characters a ripple swaps in as it passes: the stuff of a version number. */
export const RIPPLE_GLYPHS = "0123456789.^~";

/** Faint background specks, densest at the start of the string. */
export const DUST = "..··:";

export function pick(set: string, value: number): string {
  return set[Math.min(set.length - 1, Math.floor(value * set.length))];
}

/**
 * How strongly a ripple lights a point: 1 on the wave front, falling to 0 a
 * band's width either side, and fading out as the ripple ages.
 */
export function rippleEnergy(distance: number, radius: number, band: number, age: number, life: number): number {
  if (age < 0 || age >= life) return 0;
  const front = 1 - Math.abs(distance - radius) / band;
  return front <= 0 ? 0 : front * (1 - age / life) ** 1.5;
}

/**
 * A line of code partway through a rewrite. The start it shares with the new
 * line stays put, the rest settles left to right into the new line, and what
 * has not settled yet is noise from `alphabet`.
 */
export function scramble(
  from: string,
  to: string,
  progress: number,
  noise: (index: number) => number,
  alphabet = "0123456789.",
): string {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  const length = Math.round(from.length + (to.length - from.length) * Math.min(1, progress * 1.5));
  const settled = shared + Math.floor(progress * (to.length - shared));
  let out = "";
  for (let i = 0; i < length; i++) out += i < settled ? to[i] : pick(alphabet, noise(i));
  return out;
}

/**
 * How deep inside the pup a cell sits, from 0 at the outline to 1 well inside:
 * the share of its neighbors within `radius` cells that are pup too. Shading
 * fur by it makes the flat artwork read as rounded.
 */
export function depth(isPup: (x: number, y: number) => boolean, x: number, y: number, radius = 2): number {
  let inside = 0;
  let total = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      total++;
      if (isPup(x + dx, y + dy)) inside++;
    }
  }
  return inside / total;
}

/**
 * The part a cell shows, from the parts of the pixels sampled inside it. The
 * majority wins, which keeps anti-aliased edges (fur blended with ear reads
 * as the face color) from scattering stray eyes; the face wins with a
 * smaller share, so the small eyes and nose survive.
 */
export function cellPart(samples: PupPart[]): PupPart | null {
  if (samples.length === 0) return null;
  const counts = new Map<PupPart, number>();
  for (const part of samples) counts.set(part, (counts.get(part) ?? 0) + 1);
  if ((counts.get("face") ?? 0) >= 3) return "face";
  counts.delete("face");
  let best: PupPart | null = null;
  let most = 0;
  for (const [part, count] of counts) if (count > most) [best, most] = [part, count];
  return best ?? "face";
}
