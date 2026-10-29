import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

async function scrollHeroProgress(page: Page, progress: number) {
  await page.locator("[data-hero-chapter]").evaluate((element, value) => {
    const distance = element.getBoundingClientRect().height - window.innerHeight;
    window.scrollTo({ top: distance * value, behavior: "instant" });
  }, progress);
}

/** sRGB channel sum. Settled header ink (#252a31) is about 128; white is 765. */
async function headerInkSum(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return 765;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return 765;
    context.fillStyle = getComputedStyle(header).color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return red + green + blue;
  });
}

/** Names exposed to assistive tech. Playwright's role engine does not treat `inert` as hidden. */
async function accessibilityNames(page: Page, pattern: RegExp) {
  const session = await page.context().newCDPSession(page);
  const tree = await session.send("Accessibility.getFullAXTree");
  return tree.nodes
    .filter((node) => pattern.test(node.name?.value ?? "") && node.ignored !== true)
    .map((node) => node.name?.value ?? "");
}

async function scrollProof(page: Page, progress: number) {
  const proof = page.getByRole("region", { name: "A verified fix" });
  await proof.evaluate((element, value) => {
    const surface = element.firstElementChild as HTMLElement;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80 + (element.getBoundingClientRect().height - surface.offsetHeight) * value, behavior: "instant" });
  }, progress);
  return proof;
}


test("shows visitors the landing page, and signing in opens the dashboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Code breaks. You keep shipping.");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Detect" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("link", { name: "How it works" }).first().click();
  await expect(page.getByRole("region", { name: "How it works" })).toBeInViewport();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("region", { name: "How it works" }).locator("video")).toHaveCount(0);

  await page.getByRole("link", { name: "Continue with GitHub" }).first().click();
  await page.waitForURL("/dashboard");
  await expect(page.getByText("Sample data.")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("lets a signed-in user open the home page and return there from the dashboard", async ({ page }) => {
  await signIn(page, "/dashboard");
  await expect(page.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "octo-e2e" })).toBeVisible();
  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Code breaks. You keep shipping.");
  const account = page.getByRole("banner").getByRole("button", { name: "octo-e2e" });
  await expect(account).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: /Log in/ })).toHaveCount(0);
  await account.click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});

test("shows a signed-out visitor an API migration on the dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Sample data.")).toBeVisible();
  await expect(page.getByRole("table")).toContainText("claude-sonnet-4-5-20250929");
  await expect(page.getByRole("table")).toContainText("claude-sonnet-5-5");
});

test("forwards old dashboard links that used to live at /", async ({ page }) => {
  await page.goto("/?status=FAILED");
  await expect(page).toHaveURL("/dashboard?status=FAILED");
  await expect(page.getByRole("table")).toContainText("Failed");
});

test("explores the five stages through the same architectural illustration", async ({ page }) => {
  await page.goto("/");
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await expect(how.getByRole("img")).toHaveAccessibleName(/provider monitoring highlighted/);
  await expect(how.getByRole("tabpanel")).toContainText("Provider notice");
  await how.getByRole("tab", { name: "Locate" }).click();
  await expect(how.getByRole("img")).toHaveAccessibleName(/affected source files highlighted/);
  await expect(how.getByRole("tabpanel")).toContainText("src/summarize.ts");
  await how.getByRole("tab", { name: "Refactor" }).click();
  await expect(how.getByRole("img")).toHaveAccessibleName(/isolated migration sandbox highlighted/);
  await how.getByRole("tab", { name: "Verify" }).click();
  await expect(how.getByRole("tabpanel")).toContainText("13 example checks passed");
  await how.getByRole("tab", { name: "Review" }).click();
  await expect(how.getByRole("tabpanel")).toContainText("human review next");
  await expect(how.getByRole("tabpanel")).toContainText("Illustrative architecture and data");
  await expect(how.locator("video")).toHaveCount(0);

  const hero = page.locator("[data-workspace-hero]");
  await expect(hero.locator("img")).toHaveAttribute("src", /hero-office-start/);
  const heroSection = page.getByRole("region", { name: "Code breaks. You keep shipping." });
  await expect(heroSection.getByRole("link")).toHaveCount(0);
  await expect(heroSection).not.toContainText("Dependency and API migrations");
  await expect(heroSection).not.toContainText("From failed check to reviewed fix");
  await expect(hero.locator("video")).not.toHaveAttribute("autoplay");
});

test("scrolls from the white debugging scene to the blue review scene without toggles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const proof = await scrollProof(page, 0);
  await expect(proof.getByRole("img")).toHaveAccessibleName(/manually debugging/);
  await expect(proof).toContainText("11 / 13");
  await expect(proof.getByRole("button")).toHaveCount(0);
  await scrollProof(page, .95);
  await expect(proof.getByRole("img")).toHaveAccessibleName(/calmly reviewing/);
  await expect(proof).toContainText("13 / 13");
  await expect(proof).toContainText("Proposed diff ready");
  await expect(proof).toContainText("Human review required");
  await expect(proof).toContainText("not a recorded production run");
  await expect(proof.locator('img[src*="engineer-pointcloud-blue-clean"]')).toHaveCount(1);
  await scrollProof(page, 0);
  await expect(proof).toContainText("11 / 13");
});

test("supports keyboard navigation through the walkthrough", async ({ page }) => {
  await page.goto("/");
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await how.getByRole("tab", { name: "Detect" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(how.getByRole("tab", { name: "Locate" })).toBeFocused();
  await expect(how.getByRole("tabpanel")).toContainText("src/summarize.ts");
  await page.keyboard.press("End");
  await expect(how.getByRole("tab", { name: "Review" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(how.getByRole("tab", { name: "Detect" })).toBeFocused();
});

test("arrow keys leave the stage scroll selected, even when focus is still on an earlier tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#how");
  const how = page.getByRole("region", { name: "How it works", exact: true });
  const detect = how.getByRole("tab", { name: "Detect", exact: true });
  const review = how.getByRole("tab", { name: "Review", exact: true });
  const verify = how.getByRole("tab", { name: "Verify", exact: true });
  await detect.focus();
  await how.evaluate((element) => {
    const surface = element.firstElementChild as HTMLElement;
    const distance = element.getBoundingClientRect().height - surface.offsetHeight;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80 + distance * 0.92, behavior: "instant" });
  });
  await expect(review).toHaveAttribute("aria-selected", "true");
  await expect(detect).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(detect).toHaveAttribute("aria-selected", "true");
  await expect(detect).toBeFocused();
  await how.evaluate((element) => {
    const surface = element.firstElementChild as HTMLElement;
    const distance = element.getBoundingClientRect().height - surface.offsetHeight;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80 + distance * 0.92, behavior: "instant" });
  });
  await expect(review).toHaveAttribute("aria-selected", "true");
  await expect(detect).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(verify).toHaveAttribute("aria-selected", "true");
  await expect(verify).toBeFocused();
});

test("hides faded hero copy only while it still covers the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1, name: "Code breaks. You keep shipping." });
  const copy = page.locator("[data-hero-copy]");
  const description = page.locator("[data-hero-description]");
  await expect(heading).toBeVisible();
  expect(await copy.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  expect(await description.evaluate((element) => (element as HTMLElement).inert)).toBe(false);

  await scrollHeroProgress(page, 0.45);
  await expect.poll(() => copy.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await expect.poll(() => description.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  expect(await copy.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  })).toBe(true);
  expect(await description.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  })).toBe(true);
  await expect.poll(() => accessibilityNames(page, /Code breaks\. You keep shipping\.|When a model retires/)).toEqual([]);

  const how = page.getByRole("region", { name: "How it works", exact: true });
  await how.evaluate((element) => {
    const surface = element.firstElementChild as HTMLElement;
    const distance = element.getBoundingClientRect().height - surface.offsetHeight;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80 + distance * 0.5, behavior: "instant" });
  });
  await expect.poll(() => copy.evaluate((element) => element.getBoundingClientRect().bottom <= 0)).toBe(true);
  await expect.poll(() => description.evaluate((element) => element.getBoundingClientRect().bottom <= 0)).toBe(true);
  await expect.poll(() => copy.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await expect.poll(() => description.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await expect(heading).toHaveText("Code breaks. You keep shipping.");
});

test("keeps filled header actions light and text links on the dark ink", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const github = header.getByRole("link", { name: "Continue with GitHub" });
  const how = header.getByRole("link", { name: "How it works" });

  await scrollHeroProgress(page, 0.98);
  await expect.poll(() => header.evaluate((element) => Number(element.style.getPropertyValue("--nav-light")))).toBeGreaterThan(0.8);
  await expect.poll(() => header.evaluate((element) => Number(element.style.getPropertyValue("--nav-fill")))).toBe(0);
  // The header color transitions for 200ms. Wait until the ink is actually dark, and read the link with the button in one turn.
  await expect.poll(async () => {
    const sum = await headerInkSum(page);
    const matched = await page.evaluate(() => {
      const header = document.querySelector("header");
      const how = header?.querySelector("nav a[href='#how']");
      const github = header?.querySelector("nav a[href^='/auth/github']");
      if (!header || !how || !github) return false;
      const ink = getComputedStyle(header).color;
      return getComputedStyle(how).color === ink && getComputedStyle(github).color === "rgb(255, 255, 255)";
    });
    return matched && sum < 320;
  }).toBe(true);

  await page.getByRole("region", { name: "How it works", exact: true }).evaluate((element) => {
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80, behavior: "instant" });
  });
  await expect(header).toHaveAttribute("data-surface", "paper");
  await expect.poll(async () => {
    const sum = await headerInkSum(page);
    const matched = await page.evaluate(() => {
      const header = document.querySelector("header");
      const how = header?.querySelector("nav a[href='#how']");
      const github = header?.querySelector("nav a[href^='/auth/github']");
      if (!header || !how || !github) return false;
      const ink = getComputedStyle(header).color;
      return getComputedStyle(how).color === ink && getComputedStyle(github).color === "rgb(255, 255, 255)";
    });
    return matched && sum < 320;
  }).toBe(true);
});

test("keeps the signed-in account label on the header ink", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "/");
  const header = page.getByRole("banner");
  const account = header.getByRole("button", { name: "octo-e2e" });
  await scrollHeroProgress(page, 0.98);
  await expect.poll(() => header.evaluate((element) => Number(element.style.getPropertyValue("--nav-light")))).toBeGreaterThan(0.8);
  // The header color transitions for 200ms. Wait until that ink is dark, and compare the account in the same turn.
  await expect.poll(async () => {
    const sum = await headerInkSum(page);
    const matched = await page.evaluate(() => {
      const header = document.querySelector("header");
      const account = header?.querySelector("button[aria-haspopup='menu']");
      if (!header || !account) return false;
      return getComputedStyle(account).color === getComputedStyle(header).color;
    });
    return matched && sum < 320;
  }).toBe(true);
  const ink = await header.evaluate((element) => getComputedStyle(element).color);
  expect(ink).not.toBe("rgb(255, 255, 255)");
  expect(await account.evaluate((element) => getComputedStyle(element).color)).toBe(ink);
  await account.click();
  const signOut = page.getByRole("menuitem", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  expect(await signOut.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 255, 255)");
});

test("holds still for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const hero = page.locator("[data-workspace-hero]");
  await expect(hero).toHaveAttribute("data-motion", "reduced");
  await expect(hero.locator("video")).not.toHaveAttribute("src");
  await expect(hero.locator("[data-hero-fallback]")).toHaveCSS("opacity", "1");
  await expect(hero.locator("img")).toHaveAttribute("src", /hero-office-start/);
  const proof = page.getByRole("region", { name: "A verified fix" });
  await expect(proof).toHaveAttribute("data-pinned", "false");
  await expect(proof.locator("img")).toHaveCount(2);
  await expect(proof.locator("[data-engineer-reveal]")).toHaveCSS("mask-image", "none");
  await page.getByRole("tab", { name: "Refactor" }).click();
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await expect(how).toHaveAttribute("data-pinned", "false");
  expect(await how.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test("scrolling advances the workflow while its illustration stays pinned", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#how");
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await expect(how).toHaveAttribute("data-pinned", "true");
  await how.evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80, behavior: "instant" }));
  await expect(how.getByRole("tab", { name: "Detect", exact: true })).toHaveAttribute("aria-selected", "true");
  const before = await how.getByRole("img").boundingBox();
  await page.mouse.move(1200, 450);
  await page.mouse.wheel(0, 900);
  await expect(how.getByRole("tab", { name: "Refactor", exact: true })).toHaveAttribute("aria-selected", "true");
  const during = await how.getByRole("img").boundingBox();
  expect(Math.abs(during!.y - before!.y)).toBeLessThan(2);
  await expect(page.getByRole("banner")).toHaveAttribute("data-surface", "paper");
  await page.mouse.wheel(0, -900);
  await expect(how.getByRole("tab", { name: "Detect", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.mouse.wheel(0, 3200);
  await expect(how.getByRole("img")).not.toBeInViewport();
});

test("the supplied hero segment scrubs into a reversible monitor gleam and walkthrough", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const hero = page.locator("[data-workspace-hero]");
  const box = await hero.boundingBox();
  expect(box!.x).toBe(0);
  expect(box!.width).toBe(1920);
  expect(box!.y).toBe(0);
  const description = await page.locator("[data-hero-description]").boundingBox();
  expect(description!.x).toBeGreaterThan(1920 / 2);
  expect(description!.y).toBeGreaterThan(1080 / 2);
  expect(description!.y + description!.height).toBeLessThan(1080);
  const header = page.getByRole("banner");
  expect(await header.evaluate(element => getComputedStyle(element).backgroundColor)).toMatch(/(?:0\)|\/ 0\))/);
  await expect(page.locator("[data-landing]")).toHaveAttribute("data-smooth-scroll", "true");
  await expect(hero).toHaveAttribute("data-video-ready", "true");
  const film = hero.locator("video");
  expect(await film.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await expect(film).toHaveAttribute("src", "/videos/hero-office-gleam-v2.mp4");
  const travel = await page.locator("[data-hero-chapter]").evaluate(element => (element.getBoundingClientRect().height - window.innerHeight) * .90);
  await page.mouse.move(1600, 450);
  await page.mouse.wheel(0, travel);
  await expect.poll(() => hero.evaluate(element => Number((element as HTMLElement).style.getPropertyValue("--hero-gleam")))).toBeGreaterThan(.1);
  await expect.poll(() => film.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(5);
  await page.mouse.wheel(0, -travel);
  await expect.poll(() => film.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeLessThan(.1);
  await expect.poll(() => hero.evaluate(element => Number((element as HTMLElement).style.getPropertyValue("--hero-gleam")))).toBe(0);
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "How it works" }).click();
  await expect(page.locator("[data-story-paper]")).toHaveCSS("opacity", "1");
  await expect(header).toHaveAttribute("data-surface", "paper");
  await expect(how.getByRole("tab", { name: "Detect", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => film.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(5.8);
});

test("keeps the entrance still and walkthrough when the video cannot load", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/videos/hero-office-gleam-v2.mp4", route => route.abort());
  await page.goto("/");
  const hero = page.locator("[data-workspace-hero]");
  await expect(hero).toHaveAttribute("data-video-ready", "false");
  await expect(hero.locator("[data-hero-fallback]")).toHaveCSS("opacity", "1");
  await expect.poll(() => hero.locator("img").evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await how.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80, behavior: "instant" }));
  await expect(page.locator("[data-story-paper]")).toHaveCSS("opacity", "1");
  await expect(how.getByRole("tab", { name: "Detect", exact: true })).toBeVisible();
});

test("compact screens use normal scrolling with manual stage controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/#how");
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await expect(how).toHaveAttribute("data-pinned", "false");
  await how.getByRole("tab", { name: "Verify", exact: true }).click();
  await expect(how.getByRole("tabpanel")).toContainText("13 example checks passed");
  expect((await how.boundingBox())!.height).toBeLessThan(1800);
});

test("the narrow preview pane keeps the pinned story and controls in view", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await page.goto("/#how");
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await expect(how).toHaveAttribute("data-pinned", "true");
  await how.getByRole("tab", { name: "Verify", exact: true }).click();
  const picture = await how.getByRole("img").boundingBox();
  const evidence = await how.getByRole("tabpanel").boundingBox();
  expect(picture!.y).toBeGreaterThanOrEqual(80);
  expect(picture!.height).toBeGreaterThan(150);
  expect(evidence!.y + evidence!.height).toBeLessThanOrEqual(800);
  await expect(how.getByRole("tabpanel")).toContainText("13 example checks passed");
});

test("the frame marker travels along the perimeter and returns when scrolling back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const how = page.getByRole("region", { name: "How it works", exact: true });
  await how.getByRole("tab", { name: "Detect", exact: true }).click();
  const marker = how.locator("[data-frame-marker]");
  const frame = await how.locator("[data-chapter-frame]").boundingBox();
  const first = await marker.boundingBox();
  await page.mouse.move(1200, 450);
  await page.mouse.wheel(0, 900);
  await expect(how.getByRole("tab", { name: "Refactor", exact: true })).toHaveAttribute("aria-selected", "true");
  const moved = await marker.boundingBox();
  expect(moved!.x - first!.x).toBeGreaterThan(100);
  expect(moved!.x + moved!.width / 2).toBeGreaterThanOrEqual(frame!.x - 2);
  expect(moved!.x + moved!.width / 2).toBeLessThanOrEqual(frame!.x + frame!.width + 2);
  expect(moved!.y + moved!.height / 2).toBeGreaterThanOrEqual(frame!.y - 2);
  expect(moved!.y + moved!.height / 2).toBeLessThanOrEqual(frame!.y + frame!.height + 2);
  await page.mouse.wheel(0, -900);
  await expect(how.getByRole("tab", { name: "Detect", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => Math.abs((await marker.boundingBox())!.x - first!.x)).toBeLessThan(2);
});

test("scrolling brings the capability diagrams into focus in order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const capabilities = page.getByRole("region", { name: "Find and fix" });
  await capabilities.getByRole("button", { name: "01 / Monitor", exact: true }).click();
  const cards = capabilities.getByRole("article");
  await expect(cards.nth(0)).toHaveAttribute("data-revealed", "true");
  await expect(cards.nth(1).locator("[data-capability-illustration]")).toHaveCSS("filter", "blur(3px)");
  await page.mouse.move(1200, 450);
  await page.mouse.wheel(0, 450);
  await expect(cards.nth(1)).toHaveAttribute("data-revealed", "true");
  await expect(cards.nth(1).locator("[data-capability-illustration]")).toHaveCSS("filter", "none");
  await expect(cards.nth(3)).toHaveAttribute("data-revealed", "false");
  await capabilities.getByRole("button", { name: "04 / Review", exact: true }).click();
  await expect(cards.nth(3).locator("[data-capability-illustration]")).toHaveCSS("filter", "none");
});

test("the engineer scene reveals continuously with scroll while the room stays fixed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const proof = page.getByRole("region", { name: "A verified fix" });
  await scrollProof(page, 0);
  await expect.poll(() => proof.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const before = await proof.getByRole("img").boundingBox();
  await proof.evaluate(element => {
    const surface = element.firstElementChild as HTMLElement;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80 + (element.getBoundingClientRect().height - surface.offsetHeight) * .5, behavior: "instant" });
  });
  await expect.poll(() => proof.evaluate(element => Number((element as HTMLElement).style.getPropertyValue("--proof-mix")))).toBeGreaterThan(.45);
  const mix = await proof.evaluate(element => Number((element as HTMLElement).style.getPropertyValue("--proof-mix")));
  expect(mix).toBeLessThan(.55);
  const revealedImage = proof.locator("[data-engineer-reveal]");
  await expect(revealedImage).toHaveCSS("opacity", "1");
  expect(await revealedImage.evaluate(element => getComputedStyle(element).maskImage)).toContain("linear-gradient");
  const middle = await proof.getByRole("img").boundingBox();
  expect(Math.abs(middle!.y - before!.y)).toBeLessThan(2);
  await scrollProof(page, .95);
  await expect.poll(() => proof.evaluate(element => Number((element as HTMLElement).style.getPropertyValue("--proof-mix")))).toBe(1);
});

for (const width of [320, 360, 390, 768, 1024, 1440]) {
  test(`fits ${width}px without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("[data-workflow-showcase]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const header = page.locator("header").first();
    const wordmark = await header.getByText("SyncLab", { exact: true }).boundingBox();
    const action = await header.getByRole("link", { name: "Continue with GitHub" }).boundingBox();
    expect(action!.x - (wordmark!.x + wordmark!.width)).toBeGreaterThanOrEqual(12);
    expect(action!.x + action!.width).toBeLessThanOrEqual(width);
  });
}

test("keeps the app around a page that does not exist", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Migrations" })).toHaveAttribute(
    "href",
    "/dashboard",
  );
});

test("keeps the focused landing sections and links onward from the footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "FAQ" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "FAQ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Migration queue" })).toHaveCount(0);
  await expect(page.getByText("Your code. Your tests.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toContainText("All rights reserved by SyncLab");
  await expect(page.getByRole("contentinfo")).not.toContainText("opened as pull requests");
  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(footer.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
  await expect(footer.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", "https://github.com/kiet08hogit/SyncLab");
  await page.getByRole("contentinfo").getByRole("link", { name: /Sign in with GitHub/ }).click();
  await page.waitForURL("/dashboard");
});

test("leaves the dashboard intact after a client-side visit, and Back returns to the landing page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("[data-workflow-showcase]")).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "How it works" }).click();
  await expect(page.getByRole("region", { name: "How it works" })).toBeInViewport();

  // A client-side navigation: Next keeps the landing page mounted but hidden.
  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Dashboard" }).click();
  await page.waitForURL("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Migrations" })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(errors).toEqual([]);
  // The dashboard keeps its own light page background, not the landing page's.
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(255, 255, 255)");

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Code breaks. You keep shipping.");
});

test("plays the intro once, and not again on Back", async ({ page }) => {
  await page.goto("/");
  const root = page.locator("[data-landing]");
  await expect(root).toHaveAttribute("data-intro", "playing");
  const firstWord = page.getByRole("heading", { level: 1 }).locator(".intro-word").first();
  expect(await firstWord.evaluate((element) => getComputedStyle(element).animationName)).toBe("landing-rise");
  await expect(root).toHaveAttribute("data-intro", "done", { timeout: 5_000 });

  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Dashboard" }).click();
  await page.waitForURL("/dashboard");
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(root).toHaveAttribute("data-intro", "done");
  expect(await firstWord.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

test("skips the intro for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const firstWord = page.getByRole("heading", { level: 1 }).locator(".intro-word").first();
  expect(await firstWord.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});
