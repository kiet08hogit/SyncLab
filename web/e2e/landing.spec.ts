import { expect, signIn, test } from "./fixtures";

test("shows visitors the landing page, and signing in opens the dashboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upgrades that open their own pull requests.");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  // The product preview is the dashboard's own Running now cards, with sample jobs.
  await expect(page.getByRole("region", { name: "The dashboard" }).getByRole("heading", { name: "Running now" })).toBeVisible();

  await page.getByRole("link", { name: "How it works" }).first().click();
  await expect(page).toHaveURL(/#how$/);
  await expect(page.getByRole("region", { name: "How it works" }).getByRole("listitem")).toHaveCount(8);

  await page.getByRole("link", { name: "Continue with GitHub" }).first().click();
  await page.waitForURL("/dashboard");
  await expect(page.getByText("Sample data.")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sends a signed-in user straight to the dashboard", async ({ page }) => {
  await signIn(page, "/settings");
  await page.goto("/");
  await expect(page).toHaveURL("/dashboard");
});

test("forwards old dashboard links that used to live at /", async ({ page }) => {
  await page.goto("/?status=FAILED");
  await expect(page).toHaveURL("/dashboard?status=FAILED");
  await expect(page.getByRole("table")).toContainText("Failed");
});

test("upgrades the package.json line and announces the pull request", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("figure", { hasText: "package.json" });
  await expect(card).toContainText('"zod": "^3.23.8"');
  await expect(card).toContainText("pull request opened", { timeout: 10_000 });
  await expect(card).toContainText('"zod": "^4.1.0"');
  // Then on to the next dependency.
  await expect(card).toContainText('"next": "^14.2.5"', { timeout: 10_000 });
});

test("holds still for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.locator("figure", { hasText: "package.json" });
  await expect(card).toContainText('"zod": "^4.1.0"');
  await expect(card).toContainText("pull request opened");
  await page.waitForTimeout(6_000);
  await expect(card).toContainText('"zod": "^4.1.0"');
});

for (const width of [390, 768, 1024, 1440]) {
  test(`fits ${width}px without sideways scrolling, with the pup clear of the copy`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("canvas")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // The canvas draws the pup into an empty slot; the headline must not sit inside it.
    const slot = await page.locator("[data-pup-slot]").boundingBox();
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
    const overlaps =
      slot!.x < heading!.x + heading!.width &&
      heading!.x < slot!.x + slot!.width &&
      slot!.y < heading!.y + heading!.height &&
      heading!.y < slot!.y + slot!.height;
    expect(overlaps).toBe(false);
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
