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
  await expect(page.getByText("model, messages", { exact: true })).toBeVisible();
  await expect(page.getByText(/Dynamic values/)).toHaveCount(0);
  await expect(page.getByText("Sample data.")).toHaveCount(0);
  await page.getByRole("link", { name: "View migration jobs" }).click();
  await expect(page).toHaveURL(/\/dashboard\?repo=acme%2Fweb/);
});

test("labels empty models and parameters from whether the call is dynamic", async ({ page }) => {
  sql(`INSERT INTO repositories (github_repo_id, full_name, installation_id) VALUES (9001, 'acme/web', 501);
    INSERT INTO repository_scans (id, repository_id, trigger, status, commit_sha)
    SELECT '${SCAN}', id, 'push', 'COMPLETED', 'abcdef1234567890' FROM repositories WHERE github_repo_id = 9001;
    INSERT INTO api_usages (scan_id, provider_id, file, line, style, method, operation, params, model_ids, dynamic)
    SELECT '${SCAN}', id, 'src/files.ts', 6, 'http', NULL, 'GET /v1/files',
      '{}'::text[], '{}'::text[], false FROM api_providers WHERE slug = 'openai';
    INSERT INTO api_usages (scan_id, provider_id, file, line, style, method, operation, params, model_ids, dynamic)
    SELECT '${SCAN}', id, 'src/request.ts', 11, 'sdk', 'responses.create', 'POST /v1/responses',
      '{}'::text[], '{}'::text[], true FROM api_providers WHERE slug = 'openai';`);
  await signIn(page, "/repositories/9001");
  const staticCall = page.getByRole("listitem").filter({ hasText: "src/files.ts:6" });
  await expect(staticCall.getByText("None detected", { exact: true })).toHaveCount(2);
  await expect(staticCall.getByText("Not statically resolved", { exact: true })).toHaveCount(0);
  const dynamicCall = page.getByRole("listitem").filter({ hasText: "src/request.ts:11" });
  await expect(dynamicCall.getByText("Not statically resolved", { exact: true })).toHaveCount(2);
  await expect(dynamicCall.getByText("None detected", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Dynamic values/)).toHaveCount(0);
});

test("retains the last completed results after a failed rescan", async ({ page }) => {
  seedScan();
  sql(`UPDATE repository_scans SET commit_sha = NULL, updated_at = '2026-01-02T03:04:00Z' WHERE id = '${SCAN}';
    INSERT INTO repository_scans (repository_id, trigger, status, error_message, created_at, updated_at)
    SELECT id, 'push', 'FAILED', 'Clone failed', now() + interval '1 minute', '2026-03-04T05:06:00Z' FROM repositories WHERE github_repo_id = 9001`);
  await signIn(page, "/repositories/9001");
  await expect(page.getByText("Latest scan: failed")).toBeVisible();
  await expect(page.getByText(/^Latest scan updated Mar 4, 2026/)).toBeVisible();
  await expect(page.getByText("Clone failed", { exact: true })).toBeVisible();
  const results = page.getByText(/from the last completed scan/);
  await expect(results).toContainText("finished Jan 2, 2026");
  await expect(results).not.toContainText("Mar 4, 2026");
  await expect(results).not.toContainText("at commit");
  await expect(results).toContainText("has not replaced these results");
  await expect(page.getByText("src/client.ts:24")).toBeVisible();
});

test("reports a pending first scan without asking for another push", async ({ page }) => {
  sql(`INSERT INTO repositories (github_repo_id, full_name, installation_id) VALUES (9001, 'acme/web', 501);
    INSERT INTO repository_scans (repository_id, trigger, status) SELECT id, 'push', 'QUEUED' FROM repositories WHERE github_repo_id = 9001`);
  await signIn(page, "/repositories/9001");
  await expect(page.getByText("Latest scan: queued")).toBeVisible();
  await expect(page.getByText("Usage will appear when the pending scan completes.")).toBeVisible();
  await expect(page.getByText(/Push to the default branch/)).toHaveCount(0);
  sql("UPDATE repository_scans SET status = 'IN_PROGRESS'");
  await page.reload();
  await expect(page.getByText("Latest scan: in progress")).toBeVisible();
  await expect(page.getByText("Usage will appear when the pending scan completes.")).toBeVisible();
  await expect(page.getByText(/Push to the default branch/)).toHaveCount(0);
});

test("distinguishes an unscanned repository from a completed empty scan", async ({ page }) => {
  await signIn(page, "/repositories/9001");
  await expect(page.getByText("No scans yet", { exact: true })).toBeVisible();
  await expect(page.getByText(/Push to the default branch to trigger a scan/)).toBeVisible();
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
