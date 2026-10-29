import { glow } from "@remotion/effects/glow";
import { AbsoluteFill, CanvasImage, createEffect, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";

/** Extract the actual display light, feathered inside its perspective bezel. */
const screenEmission = createEffect<Record<string, never>, null>({
  type: "com.synclab.screenEmission",
  label: "screenEmission()",
  documentationLink: null,
  backend: "2d",
  calculateKey: () => "screen-emission-v1",
  setup: () => null,
  apply: ({ source, target, width, height }) => {
    const context = target.getContext("2d");
    if (!context) throw new Error("Monitor emission needs a 2D canvas.");
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const polygon = [[.299, .238], [.763, .235], [.761, .724], [.301, .723]].map(([x, y]) => [x * width, y * height]);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        let distance = Infinity;
        for (let edge = 0; edge < polygon.length; edge++) {
          const [ax, ay] = polygon[edge], [bx, by] = polygon[(edge + 1) % polygon.length];
          distance = Math.min(distance, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay));
        }
        const feather = Math.max(0, Math.min(1, distance / (width * .008)));
        const luminance = (pixels.data[offset] * .2126 + pixels.data[offset + 1] * .7152 + pixels.data[offset + 2] * .0722) / 255;
        // Terminal blacks contribute no light. The glyphs themselves emit it.
        const light = Math.max(0, Math.min(1, (luminance - .065) / .32));
        pixels.data[offset] = Math.round(248 * feather * light);
        pixels.data[offset + 1] = Math.round(249 * feather * light);
        pixels.data[offset + 2] = Math.round(246 * feather * light);
        // An opaque black light pass blends away with screen compositing and
        // avoids amplifying transparent RGB values in the bloom convolution.
        pixels.data[offset + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
  },
  cleanup: () => undefined,
  schema: {},
  validateParams: () => undefined,
});

export function MonitorGleam() {
  const frame = useCurrentFrame();
  const ramp = (range: [number, number], output: [number, number]) => interpolate(frame, range, output, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const emission = ramp([96, 130], [0, 1]);
  return (
    <>
      <AbsoluteFill style={{ opacity: emission, mixBlendMode: "screen" }}>
        <CanvasImage src={staticFile("videos/hero-office-monitor.png")} style={{ width: "100%", height: "100%" }} effects={[
          screenEmission(),
          glow({ radius: 5, intensity: ramp([96, 133], [0, 1.2]), threshold: .02 }),
        ]} />
      </AbsoluteFill>
      {/* Separate Gaussian passes keep broad optical bloom smooth at large radii. */}
      <AbsoluteFill style={{ opacity: ramp([104, 138], [0, 1]), mixBlendMode: "screen", filter: `blur(${ramp([104, 138], [12, 48])}px) brightness(${ramp([104, 138], [1, 5])})` }}>
        <CanvasImage src={staticFile("videos/hero-office-monitor.png")} style={{ width: "100%", height: "100%" }} effects={[screenEmission()]} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: ramp([111, 141], [0, 1]), mixBlendMode: "screen", filter: `blur(${ramp([111, 141], [45, 200])}px) brightness(${ramp([111, 141], [1, 16])})` }}>
        <CanvasImage src={staticFile("videos/hero-office-monitor.png")} style={{ width: "100%", height: "100%" }} effects={[screenEmission()]} />
      </AbsoluteFill>
      {/* Whiten the lens only after the bloom has grown beyond the bezel. */}
      <AbsoluteFill style={{ background: "#fcfcfa", opacity: ramp([130, 143], [0, 1]) }} />
    </>
  );
}
