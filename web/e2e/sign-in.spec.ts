import { expect, LOGIN, signIn, test } from "./fixtures";

test("signs in through GitHub, lists the installation, and signs out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sample data.")).toBeVisible();

  await page.getByRole("link", { name: "Continue with GitHub" }).first().click();
  await page.waitForURL("/");
  await expect(page.getByText("Sample data.")).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByText(LOGIN)).toBeVisible();
  await expect(page.getByText("acme", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Continue with GitHub" }).first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Sample data.")).toBeVisible();
});

test("returns to the page that asked for sign-in", async ({ page }) => {
  await signIn(page, "/migrations/new");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
