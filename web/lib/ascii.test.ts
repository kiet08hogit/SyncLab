import { describe, expect, it } from "vitest";

import { cellPart, depth, hash, pick, pupPart, rippleEnergy, scramble } from "@/lib/ascii";
import { MASCOT_COLORS } from "@/lib/mascot";

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe("pupPart", () => {
  it("names each mascot color", () => {
    expect(pupPart(...rgb(MASCOT_COLORS.fur))).toBe("fur");
    expect(pupPart(...rgb(MASCOT_COLORS.ear))).toBe("ear");
    expect(pupPart(...rgb(MASCOT_COLORS.patch))).toBe("patch");
    expect(pupPart(...rgb(MASCOT_COLORS.feature))).toBe("face");
    expect(pupPart(...rgb(MASCOT_COLORS.collar))).toBe("collar");
    expect(pupPart(...rgb(MASCOT_COLORS.shine))).toBe("tag");
    expect(pupPart(...rgb(MASCOT_COLORS.arrow))).toBe("arrow");
  });

  it("matches near colors to the closest part", () => {
    expect(pupPart(250, 228, 205)).toBe("fur");
  });
});

describe("cellPart", () => {
  it("draws nothing for an empty cell", () => {
    expect(cellPart([])).toBeNull();
  });

  it("takes the majority, so a stray edge pixel does not win", () => {
    expect(cellPart(["fur", "fur", "fur", "ear", "face"])).toBe("fur");
  });

  it("lets the face win with a small share, so small eyes survive", () => {
    expect(cellPart(["fur", "fur", "fur", "fur", "fur", "face", "face", "face"])).toBe("face");
  });
});

describe("depth", () => {
  const disc = (x: number, y: number) => x * x + y * y <= 25;

  it("is 1 deep inside a shape and falls toward its outline", () => {
    expect(depth(disc, 0, 0)).toBe(1);
    expect(depth(disc, 5, 0)).toBeLessThan(0.7);
    expect(depth(disc, 5, 0)).toBeGreaterThan(0);
  });
});

describe("rippleEnergy", () => {
  it("peaks on the wave front and fades either side", () => {
    expect(rippleEnergy(100, 100, 50, 0, 1000)).toBe(1);
    expect(rippleEnergy(125, 100, 50, 0, 1000)).toBeCloseTo(0.5);
    expect(rippleEnergy(160, 100, 50, 0, 1000)).toBe(0);
  });

  it("fades as the ripple ages and stops when it ends", () => {
    expect(rippleEnergy(100, 100, 50, 500, 1000)).toBeLessThan(0.5);
    expect(rippleEnergy(100, 100, 50, 1000, 1000)).toBe(0);
  });
});

describe("scramble", () => {
  const noise = (i: number) => hash(i, 1);

  it("starts at the old version and settles on the new one", () => {
    expect(scramble("^3.23.8", "^4.1.0", 0, noise)).toBe("^3.23.8");
    expect(scramble("^3.23.8", "^4.1.0", 1, noise)).toBe("^4.1.0");
  });

  it("keeps the start the two lines share still", () => {
    const line = scramble("max_tokens: 1024,", "max_completion_tokens: 1024,", 0.01, noise, "x");
    expect(line.startsWith("max_")).toBe(true);
    expect(line.slice(4)).toMatch(/^x+$/);
  });

  it("settles left to right, with version-like noise after", () => {
    const halfway = scramble("^3.23.8", "^4.1.0", 0.5, noise);
    expect(halfway.startsWith("^4.")).toBe(true);
    expect(halfway).toMatch(/^[\^0-9.]+$/);
  });
});

describe("hash and pick", () => {
  it("are stable and stay in range", () => {
    expect(hash(3, 4)).toBe(hash(3, 4));
    expect(hash(3, 4)).not.toBe(hash(4, 3));
    expect(pick("abc", 0)).toBe("a");
    expect(pick("abc", 0.999)).toBe("c");
    expect(pick("abc", 1)).toBe("c");
  });
});
