import type { Page } from "@playwright/test";

import { expect, seedJob, signIn, test } from "./fixtures";

// Layout bugs that only show in a real browser: stage labels running into
// each other in narrow tracks, and pages wider than a phone screen.

const WIDTHS = [390, 768, 1024, 1280, 1440];

function seed() {
  for (const [index, dependency] of ["next", "express"].entries()) {
    seedJob({
      id: `33333333-3333-4333-8333-00000000000${index + 1}`,
      repo: index === 0 ? "acme/web" : "acme/api",
      dependency,
      version: "1.0.0",
      status: "IN_PROGRESS",
      createdAgo: 5,
      logs: [
        { step: "STARTED", output: "Starting", ago: 5 },
        { step: "CLONE", output: "[exit 0]\nCloning", ago: 4 },
        { step: "CHANGELOG", output: "Notes", ago: 4 },
        { step: "INSTALL", output: "[exit 0]\nadded", ago: 3 },
      ],
    });
  }
}

/** Pairs of stage labels in the same track whose rendered text overlaps. */
function overlappingLabels(page: Page) {
  return page.evaluate(() => {
    const visible = (node: Text) => {
      const element = node.parentElement!;
      if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return null;
      // Screen-reader-only text sits in a box clipped to 1px, though the text itself measures full size.
      for (let box: Element | null = element; box && box.tagName !== "LI"; box = box.parentElement) {
        const clipped = getComputedStyle(box).overflow === "hidden" && box.getBoundingClientRect().width <= 1;
        if (clipped) return null;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };
    const overlaps: string[] = [];
    for (const track of document.querySelectorAll("ol[aria-label]")) {
      const labels: Array<{ text: string; rect: DOMRect }> = [];
      for (const item of track.querySelectorAll(":scope > li")) {
        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
          const rect = node.textContent?.trim() ? visible(node) : null;
          if (rect) labels.push({ text: node.textContent!.trim(), rect });
        }
      }
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const [a, b] = [labels[i].rect, labels[j].rect];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            overlaps.push(`${labels[i].text} / ${labels[j].text}`);
          }
        }
      }
    }
    return overlaps;
  });
}

for (const width of WIDTHS) {
  test(`pipeline labels never overlap and nothing scrolls sideways at ${width}px`, async ({ page }) => {
    seed();
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/jobs/33333333-3333-4333-8333-000000000001"]) {
      await signIn(page, path);
      await expect(page.locator("ol[aria-label]").first()).toBeVisible();
      expect(await overlappingLabels(page), `${path} at ${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} at ${width}px`).toBeLessThanOrEqual(width);
    }
  });
}
