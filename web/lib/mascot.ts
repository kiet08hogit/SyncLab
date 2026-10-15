// The SyncLab pup: a friendly flat-cartoon dog on a brand-blue tile. The
// sidebar mark and the favicon both render from this one definition.

export const MASCOT_COLORS = {
  tile: "#2c63ff",
  fur: "#fde8cf",
  ear: "#4b2e26",
  patch: "#5e4037",
  feature: "#3a221c",
  shine: "#ffffff",
  collar: "#0b1014",
  arrow: "#2c63ff",
} as const;

type Color = keyof typeof MASCOT_COLORS;

export type MascotShape =
  | { kind: "path"; d: string; fill?: Color; stroke?: Color; width?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill: Color; rotate?: number };

/** Drawn on a 64x64 canvas, back to front. The head group is tilted for a curious, listening pose. */
export const MASCOT_BODY: MascotShape[] = [
  { kind: "path", d: "M23.5 40 C24 50 23 59 21.5 64 L45.5 64 C43.5 58 42 50 42.5 40 Z", fill: "fur" },
  { kind: "path", d: "M42 50 C47 51.5 52 56 54 64 L45 64 C44 59 42.5 55 42 50 Z", fill: "patch" },
  // Collar with a square tag carrying the upgrade arrow: the one detail that makes this SyncLab's dog.
  { kind: "path", d: "M23.6 50.5 Q33 54.5 42.6 50.5 L42.8 54.2 Q33 58.2 23.4 54.2 Z", fill: "collar" },
  { kind: "path", d: "M29.5 55 H36.5 V62 H29.5 Z", fill: "shine" },
  { kind: "path", d: "M33 56.4 L35.4 59 H33.9 V60.8 H32.1 V59 H30.6 Z", fill: "arrow" },
];

export const MASCOT_HEAD: MascotShape[] = [
  { kind: "ellipse", cx: 32, cy: 33, rx: 17.5, ry: 16.5, fill: "fur" },
  { kind: "ellipse", cx: 40.5, cy: 28.5, rx: 7.6, ry: 9.2, fill: "patch", rotate: -24 },
  {
    kind: "path",
    d: "M18.5 19 C10.5 22.5 4.5 35.5 6 44.5 C7 50.5 14.5 52 17.5 47 C20 42.5 18.5 30 20.5 21 Z",
    fill: "ear",
  },
  {
    kind: "path",
    d: "M44 17.5 C52.5 19 60.5 29.5 59.5 39.5 C59 45.5 52.5 47.5 49.5 42.5 C47 38 47.5 27 44 17.5 Z",
    fill: "ear",
  },
  { kind: "ellipse", cx: 25.5, cy: 33.5, rx: 2.5, ry: 3.2, fill: "feature" },
  { kind: "ellipse", cx: 40.5, cy: 31, rx: 2.5, ry: 3.2, fill: "feature" },
  { kind: "ellipse", cx: 24.7, cy: 32.3, rx: 0.85, ry: 0.85, fill: "shine" },
  { kind: "ellipse", cx: 39.7, cy: 29.8, rx: 0.85, ry: 0.85, fill: "shine" },
  { kind: "ellipse", cx: 33, cy: 38.6, rx: 3.1, ry: 2.1, fill: "feature" },
  { kind: "path", d: "M29.8 43 Q33.3 45.8 36.8 42.4", stroke: "feature", width: 1.7 },
];

export const MASCOT_TILT = "rotate(-8 32 34)";

/** The same artwork as a standalone SVG document, for the favicon. */
export function mascotSvg(): string {
  const render = (shape: MascotShape) => {
    if (shape.kind === "ellipse") {
      const rotate = shape.rotate ? ` transform="rotate(${shape.rotate} ${shape.cx} ${shape.cy})"` : "";
      return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" fill="${MASCOT_COLORS[shape.fill]}"${rotate}/>`;
    }
    const paint = shape.stroke
      ? `fill="none" stroke="${MASCOT_COLORS[shape.stroke]}" stroke-width="${shape.width}" stroke-linecap="round"`
      : `fill="${MASCOT_COLORS[shape.fill!]}"`;
    return `<path d="${shape.d}" ${paint}/>`;
  };
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `<rect width="64" height="64" fill="${MASCOT_COLORS.tile}"/>`,
    ...MASCOT_BODY.map(render),
    `<g transform="${MASCOT_TILT}">`,
    ...MASCOT_HEAD.map(render),
    `</g></svg>`,
  ].join("");
}
