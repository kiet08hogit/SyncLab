import { expect, signIn, test } from "./fixtures";

// The API change monitor page. Until the API serves the monitor's routes, a
// signed-in visitor sees the samples too, with a notice saying why; the API
// these tests run is the real one, so that is the path they take signed in.

const WIDTHS = [390, 768, 1024, 1440];

test.describe("API changes, signed out", () => {
  test("shows the sample monitor and says it is sample data", async ({ page }) => {
    await page.goto("/api-changes");

    await expect(page.getByRole("heading", { level: 1, name: "API changes" })).toBeVisible();
    await expect(page.getByText("Sign in with GitHub to see the changes SyncLab's monitor has found.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Anthropic" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "OpenAI" })).toBeVisible();
    // A source whose last fetch failed says so.
    await expect(page.getByText("Last check failed.")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(7);
    await expect(page.getByRole("button", { name: "Check now" })).toBeDisabled();
  });

  test("filters by provider and status through the URL, and clears back to everything", async ({ page }) => {
    await page.goto("/api-changes");

    await page.getByRole("navigation", { name: "Filter by provider" }).getByRole("link", { name: "OpenAI" }).click();
    await expect(page).toHaveURL(/\/api-changes\?provider=openai$/);
    await expect(page.getByRole("row")).toHaveCount(4);
    await expect(page.getByRole("cell", { name: "Anthropic", exact: true })).toHaveCount(0);

    await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: "Confirmed" }).click();
    await expect(page).toHaveURL(/provider=openai&status=confirmed/);
    await expect(page.getByText("No changes match these filters")).toBeVisible();

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/api-changes$/);
    await expect(page.getByRole("row")).toHaveCount(7);
  });

  test("narrows to one kind from a change's kind label, and removes that filter again", async ({ page }) => {
    await page.goto("/api-changes");

    await page.getByRole("link", { name: "Endpoint removed" }).first().click();
    await expect(page).toHaveURL(/kind=endpoint_removed/);
    await expect(page.getByRole("row")).toHaveCount(3);

    await page.getByRole("link", { name: /Remove the kind filter/ }).click();
    await expect(page).toHaveURL(/\/api-changes$/);
    await expect(page.getByRole("row")).toHaveCount(7);
  });

  for (const width of WIDTHS) {
    test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/api-changes");
      await expect(page.getByRole("heading", { level: 3, name: "Anthropic" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});

test.describe("API changes, signed in to an API without the monitor", () => {
  test("falls back to the samples, says why, and explains why it cannot check now", async ({ page }) => {
    await signIn(page, "/api-changes");

    await expect(page.getByText("does not run the change monitor yet")).toBeVisible();
    await expect(page.getByText("Sign in with GitHub to see the changes")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check now" })).toBeDisabled();
    await expect(page.getByText("Available once the API runs the change monitor.")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(7);
  });
});

test("the sidebar links to the API changes page and marks it current there", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "API changes" }).click();
  await expect(page).toHaveURL(/\/api-changes$/);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "API changes" }),
  ).toHaveAttribute("aria-current", "page");
});
