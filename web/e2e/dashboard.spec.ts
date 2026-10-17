import { addLog, expect, seedJob, signIn, sql, test } from "./fixtures";

const RUNNING = "11111111-1111-4111-8111-000000000001";

test.beforeEach(() => {
  seedJob({
    id: RUNNING,
    dependency: "next",
    version: "15.1.0",
    status: "IN_PROGRESS",
    createdAgo: 6,
    logs: [
      { step: "STARTED", output: "Starting migration for acme/web", ago: 6 },
      { step: "CLONE", output: "[exit 0]\nCloning into '/workspace/repo'...", ago: 5 },
      { step: "CHANGELOG", output: "Read release notes for next 15.1.0", ago: 5 },
    ],
  });
  seedJob({ id: "11111111-1111-4111-8111-000000000002", repo: "acme/api", dependency: "express", version: "5.1.0", status: "QUEUED", createdAgo: 2 });
  seedJob({
    id: "11111111-1111-4111-8111-000000000003",
    dependency: "zod",
    version: "4.1.0",
    status: "COMPLETED",
    pullRequestUrl: "https://github.com/acme/web/pull/7",
    createdAgo: 90,
  });
  seedJob({ id: "11111111-1111-4111-8111-000000000004", dependency: "vitest", version: "3.0.0", status: "FAILED", error: "npm test failed", createdAgo: 120 });
});

test("shows the signed-in user's jobs with counts, running cards, and the table", async ({ page }) => {
  await signIn(page, "/dashboard");

  const filter = page.getByRole("navigation", { name: "Filter by status" });
  await expect(filter.getByRole("link", { name: /All jobs/ })).toContainText("4");
  for (const status of ["Running", "Queued", "Completed", "Failed"]) {
    await expect(filter.getByRole("link", { name: new RegExp(status) })).toContainText("1");
  }

  const running = page.getByRole("region", { name: "Running now" });
  await expect(running.getByText("next")).toBeVisible();
  await expect(running.getByRole("list", { name: /Running install \(stage 3 of 8\)/ })).toBeVisible();

  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(page.getByText("Sample data.")).toHaveCount(0);
});

test("filters by status and search, with the filter in the URL", async ({ page }) => {
  await signIn(page, "/dashboard");
  await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /Failed/ }).click();
  await expect(page).toHaveURL(/\?status=FAILED/);
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("table")).toContainText("vitest");

  await page.goto("/dashboard");
  await page.getByRole("searchbox", { name: "Search jobs" }).fill("acme/api");
  await page.getByRole("searchbox", { name: "Search jobs" }).press("Enter");
  await expect(page).toHaveURL(/q=acme%2Fapi/);
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("table")).toContainText("express");
});

test("moves a finished job out of Running now without a reload", async ({ page }) => {
  await signIn(page, "/dashboard");
  const running = page.getByRole("region", { name: "Running now" });
  await expect(running).toBeVisible();
  await page.evaluate(() => ((window as { notReloaded?: boolean }).notReloaded = true));

  for (const step of ["INSTALL", "BASELINE", "UPGRADE", "REFACTOR", "TEST", "PR"]) {
    addLog(RUNNING, { step, output: "[exit 0]\nok", ago: 0 });
  }
  sql(`UPDATE migration_jobs SET status = 'COMPLETED', pull_request_url = 'https://github.com/acme/web/pull/8', updated_at = now() WHERE id = '${RUNNING}'`);

  await expect(running).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /Completed/ })).toContainText("2");
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);
});
