import { expect, signIn, sql, test } from "./fixtures";

const SCAN = "55555555-5555-4555-8555-000000000001";

function seedScan() {
  sql(`INSERT INTO repositories (github_repo_id, full_name, installation_id) VALUES (9001, 'acme/web', 501);
    INSERT INTO repository_scans (id, repository_id, trigger, status, commit_sha)
    SELECT '${SCAN}', id, 'push', 'COMPLETED', 'abcdef1234567890' FROM repositories WHERE github_repo_id = 9001;
    INSERT INTO api_usages (scan_id, provider_id, file, line, style, method, operation, params, model_ids, dynamic)
    SELECT '${SCAN}', id, 'src/client.ts', 24, 'sdk', 'messages.create', 'POST /v1/messages',
      ARRAY['model','messages'], ARRAY['sample-model'], true FROM api_providers WHERE slug = 'anthropic';`);
}

test("opens repository calls from the list and preserves the migration filter", async ({ page }) => {
  seedScan();
  await signIn(page, "/repositories");
  await page.getByRole("link", { name: /acme\/web/ }).click();
  await expect(page).toHaveURL(/\/repositories\/9001$/);
  await expect(page.getByText("src/client.ts:24")).toBeVisible();
  await expect(page.getByText("POST /v1/messages", { exact: true })).toBeVisible();
  await expect(page.getByText("sample-model", { exact: true })).toBeVisible();
  await expect(page.getByText(/Dynamic values/)).toBeVisible();
  await expect(page.getByText("Sample data.")).toHaveCount(0);
  await page.getByRole("link", { name: "View migration jobs" }).click();
  await expect(page).toHaveURL(/\/dashboard\?repo=acme%2Fweb/);
});

test("retains the last completed results after a failed rescan", async ({ page }) => {
  seedScan();
  sql(`INSERT INTO repository_scans (repository_id, trigger, status, error_message, created_at)
    SELECT id, 'push', 'FAILED', 'Clone failed', now() + interval '1 minute' FROM repositories WHERE github_repo_id = 9001`);
  await signIn(page, "/repositories/9001");
  await expect(page.getByText("Latest scan: failed")).toBeVisible();
  await expect(page.getByText("Clone failed", { exact: true })).toBeVisible();
  await expect(page.getByText(/has not replaced these results/)).toBeVisible();
  await expect(page.getByText("src/client.ts:24")).toBeVisible();
});

test("distinguishes an unscanned repository from a completed empty scan", async ({ page }) => {
  await signIn(page, "/repositories/9001");
  await expect(page.getByText("No scans yet", { exact: true })).toBeVisible();
  seedScan();
  sql("DELETE FROM api_usages");
  await page.reload();
  await expect(page.getByText(/No supported API calls were detected/)).toBeVisible();
});

test("does not reveal inaccessible repositories", async ({ page }) => {
  await signIn(page, "/repositories/9999");
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
});

test("sample usage remains readable on a small screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/repositories/48213491");
  await expect(page.getByText("Sample data.")).toBeVisible();
  await expect(page.getByText("src/ai/client.ts:24")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
