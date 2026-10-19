import { expect, seedChange, signIn, sql, test } from "./fixtures";
import { VIEWER_LOGIN } from "./stub";

// The API change monitor page. The API these tests run is the real one, with
// the monitor's routes but no worker, so signed in, its sources are never
// checked and it has found no changes unless a test seeds one. The stub's
// user is a monitor admin; its viewer is not.

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
    // Samples are never reviewable.
    await expect(page.getByRole("button", { name: /^(Confirm|Dismiss)$/ })).toHaveCount(0);
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

test.describe("API changes, signed in", () => {
  test("shows the monitor's own providers instead of the samples, and can check now", async ({ page }) => {
    await signIn(page, "/api-changes");

    await expect(page.getByRole("heading", { level: 3, name: "Anthropic" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "OpenAI" })).toBeVisible();
    await expect(page.getByText("No breaking changes found yet")).toBeVisible();
    await expect(page.getByText("does not run the change monitor yet")).toHaveCount(0);
    await expect(page.getByText("Sign in with GitHub to see the changes")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check now" })).toBeEnabled();
  });

  const CHANGE = {
    id: "5b0f3c2e-8d41-4a7e-9c16-2f7d0e9a4b83",
    provider: "anthropic" as const,
    field: "claude-haiku-3-20240307",
    evidence: "December 1, 2026 | claude-haiku-3-20240307 | claude-haiku-5",
  };
  const status = () => sql(`SELECT status FROM breaking_changes WHERE id = '${CHANGE.id}'`);

  test("an admin confirms a detected change, then dismisses it", async ({ page }) => {
    seedChange({ ...CHANGE, status: "detected" });
    await signIn(page, "/api-changes");

    const row = page.getByRole("row").filter({ hasText: CHANGE.field });
    const review = row.getByRole("group", { name: `Review ${CHANGE.field}` });
    await expect(row.getByText("Detected", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(review.getByRole("button")).toHaveText(["Confirm", "Dismiss"]);

    await review.getByRole("button", { name: "Confirm" }).click();
    await expect(row.getByText("Confirmed", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(review.getByRole("button")).toHaveText(["Dismiss"]);
    expect(status()).toBe("confirmed");

    await review.getByRole("button", { name: "Dismiss" }).click();
    await expect(row.getByText("Dismissed", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(review.getByRole("button")).toHaveText(["Confirm"]);
    expect(status()).toBe("dismissed");
    await expect(row.getByRole("alert")).toHaveCount(0);
  });

  test("confirming a change that was just deleted says it no longer exists", async ({ page }) => {
    seedChange({ ...CHANGE, status: "detected" });
    await signIn(page, "/api-changes");
    sql(`DELETE FROM breaking_changes WHERE id = '${CHANGE.id}'`);

    await page.getByRole("row").filter({ hasText: CHANGE.field }).getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "This change no longer exists." })).toBeVisible();
    await expect(page.getByText("No breaking changes found yet")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: CHANGE.field })).toHaveCount(0);
  });

  test("a user who is not a monitor admin sees the change without review actions", async ({ page }) => {
    seedChange({ ...CHANGE, status: "detected" });
    await signIn(page, "/settings", "viewer");
    await expect(page.getByText(`@${VIEWER_LOGIN}`)).toBeVisible();
    await page.goto("/api-changes");

    const row = page.getByRole("row").filter({ hasText: CHANGE.field });
    await expect(row.getByText("Detected", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Confirm|Dismiss)$/ })).toHaveCount(0);
  });

  for (const width of WIDTHS) {
    test(`review actions fit without sideways scrolling at ${width}px`, async ({ page }) => {
      seedChange({ ...CHANGE, status: "detected" });
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, "/api-changes");
      await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});

test("the sidebar links to the API changes page and marks it current there", async ({ page }) => {
  // The dashboard, since / is the landing page, which has no sidebar.
  await page.goto("/dashboard");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "API changes" }).click();
  await expect(page).toHaveURL(/\/api-changes$/);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "API changes" }),
  ).toHaveAttribute("aria-current", "page");
});
