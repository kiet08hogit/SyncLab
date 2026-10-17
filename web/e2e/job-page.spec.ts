import { addLog, expect, seedJob, signIn, sql, test } from "./fixtures";

const FAILED = "22222222-2222-4222-8222-000000000001";
const RUNNING = "22222222-2222-4222-8222-000000000002";

const installOutput = `[exit 0]\n${Array.from({ length: 180 }, (_, i) => `npm http fetch GET 200 https://registry.npmjs.org/pkg-${i + 1}`).join("\n")}\nadded 180 packages in 9s`;
const testOutput = `[exit 1]\n${Array.from({ length: 30 }, (_, i) => `  PASS src/module-${i + 1}.test.ts`).join("\n")}\n  FAIL src/schema.test.ts\n    TypeError: z.string(...).nonempty is not a function`;

function seedFailed() {
  seedJob({
    id: FAILED,
    dependency: "zod",
    version: "4.1.0",
    status: "FAILED",
    error: "npm test failed after 3 refactor attempts",
    createdAgo: 20,
    logs: [
      { step: "STARTED", output: "Starting migration for acme/web", ago: 20 },
      { step: "CLONE", output: "[exit 0]\nCloning into '/workspace/repo'...", ago: 19 },
      { step: "CHANGELOG", output: "Read release notes for zod 4.1.0", ago: 19 },
      { step: "INSTALL", output: installOutput, ago: 18 },
      { step: "BASELINE", output: "[exit 0]\nTests: 31 passed", ago: 18 },
      { step: "UPGRADE", output: "[exit 0]\nzod@4.1.0", ago: 18 },
      { step: "REFACTOR", output: "Rewrote 3 files", ago: 17 },
      { step: "TEST", output: testOutput, ago: 16 },
      { step: "FAILED", output: "npm test failed after 3 refactor attempts", ago: 16 },
    ],
  });
}

const logRow = (page: import("@playwright/test").Page, step: string) =>
  page.getByRole("region", { name: "Execution log" }).getByRole("listitem").filter({ hasText: new RegExp(`^${step}`) });

test("retries a failed job, which goes back to the queue as the same job", async ({ page }) => {
  seedFailed();
  await signIn(page, `/jobs/${FAILED}`);
  await expect(page.getByText("Migration failed")).toBeVisible();
  await expect(page.getByRole("list", { name: "Failed at test (stage 7 of 8)" })).toBeVisible();

  await page.getByRole("button", { name: "Retry migration" }).click();

  await expect(page.getByRole("list", { name: "Waiting for a worker" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry migration" })).toHaveCount(0);
  await expect(page.getByText("Migration failed")).toHaveCount(0);
  expect(sql(`SELECT status, error_message IS NULL FROM migration_jobs WHERE id = '${FAILED}'`)).toBe("QUEUED|t");
  expect(sql("SELECT count(*) FROM migration_jobs")).toBe("1");
});

test("folds long output to its tail, opens a failed step in full, and copies output", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  seedFailed();
  await signIn(page, `/jobs/${FAILED}`);

  const install = logRow(page, "INSTALL");
  await expect(install.locator("pre")).toHaveText(/added 180 packages in 9s$/);
  await expect(install.locator("pre")).not.toContainText(/pkg-1(?!\d)/);
  await install.getByRole("button", { name: "Show 169 earlier lines" }).click();
  await expect(install.locator("pre")).toContainText(/pkg-1(?!\d)/);

  const failedTest = logRow(page, "TEST");
  await expect(failedTest.locator("pre")).toContainText("PASS src/module-1.test.ts");
  await expect(failedTest.getByRole("button", { name: "Show only the last 12 lines" })).toBeVisible();

  await logRow(page, "CLONE").getByRole("button", { name: "Copy output" }).click();
  await expect(logRow(page, "CLONE").getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Cloning into '/workspace/repo'...");
});

test("follows a running job to its pull request without a reload", async ({ page }) => {
  seedJob({
    id: RUNNING,
    dependency: "next",
    version: "15.1.0",
    status: "IN_PROGRESS",
    createdAgo: 4,
    logs: [
      { step: "STARTED", output: "Starting migration for acme/web", ago: 4 },
      { step: "CLONE", output: "[exit 0]\nCloning", ago: 3 },
      { step: "CHANGELOG", output: "Read release notes", ago: 3 },
    ],
  });
  await signIn(page, `/jobs/${RUNNING}`);
  await expect(page.getByRole("list", { name: "Running install (stage 3 of 8)" })).toBeVisible();
  await page.evaluate(() => ((window as { notReloaded?: boolean }).notReloaded = true));

  addLog(RUNNING, { step: "INSTALL", output: "[exit 0]\nadded 12 packages", ago: 0 });
  addLog(RUNNING, { step: "BASELINE", output: "[exit 0]\nTests: 4 passed", ago: 0 });
  await expect(page.getByRole("list", { name: "Running upgrade (stage 5 of 8)" })).toBeVisible({ timeout: 15_000 });

  for (const step of ["UPGRADE", "REFACTOR", "TEST", "PR"]) addLog(RUNNING, { step, output: "[exit 0]\nok", ago: 0 });
  sql(`UPDATE migration_jobs SET status = 'COMPLETED', pull_request_url = 'https://github.com/acme/web/pull/12', updated_at = now() WHERE id = '${RUNNING}'`);
  await expect(page.getByRole("link", { name: /Open pull request #12/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("list", { name: "All stages passed" })).toBeVisible();
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);
});

test("shows a sample job to a signed-out visitor, without a retry button", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /Failed/ }).click();
  await page.getByRole("table").getByRole("link").first().click();
  await expect(page.getByText("Migration failed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry migration" })).toHaveCount(0);
});
