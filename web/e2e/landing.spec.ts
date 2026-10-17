import { expect, signIn, test } from "./fixtures";

test("shows visitors the landing page, and signing in opens the dashboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Breaking changes, fixed for you.");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  // The product preview is the dashboard's own Running now cards, with sample jobs.
  await expect(page.getByRole("region", { name: "The dashboard" }).getByRole("heading", { name: "Running now" })).toBeVisible();

  await page.getByRole("link", { name: "How it works" }).first().click();
  await expect(page.getByRole("region", { name: "How it works" })).toBeInViewport();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("region", { name: "How it works" }).locator("ol > li")).toHaveCount(8);

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

test("migrates a dependency, then an API call, and announces each pull request", async ({ page }) => {
  await page.goto("/");
  // The hero's migration card, the first figure on the page.
  const card = page.locator("figure").first();
  await expect(card).toContainText("package.json");
  await expect(card).toContainText('"zod": "^3.23.8"');
  await expect(card).toContainText("pull request opened", { timeout: 10_000 });
  await expect(card).toContainText('"zod": "^4.1.0"');
  // Then a provider change: a retired model in the code that calls it.
  await expect(card).toContainText("model retired", { timeout: 10_000 });
  await expect(card).toContainText('model: "chat-large-2024-06"');
  await expect(card).toContainText('model: "chat-large-2026-04"', { timeout: 10_000 });
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

test("answers questions in the FAQ and links onward from the footer", async ({ page }) => {
  await page.goto("/");
  const faq = page.getByRole("region", { name: "FAQ" });
  const answer = faq.getByText(/^Two kinds\./);
  await expect(answer).toBeHidden();
  await faq.getByText("What kinds of breaking changes does it fix?").click();
  await expect(answer).toBeVisible();
  await faq.getByText("What kinds of breaking changes does it fix?").click();
  await expect(answer).toBeHidden();

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
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "How it works" }).click();
  await expect(page.getByRole("region", { name: "How it works" })).toBeInViewport();

  // A client-side navigation: Next keeps the landing page mounted but hidden.
  await page.getByRole("region", { name: "The dashboard" }).getByRole("link", { name: /Open the sample dashboard/ }).click();
  await page.waitForURL("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Migrations" })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(errors).toEqual([]);
  // The dashboard keeps its own light page background, not the landing page's.
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(255, 255, 255)");

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Breaking changes, fixed for you.");
});
