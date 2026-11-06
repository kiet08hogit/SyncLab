import { expect, seedChange, signIn, sql, test } from "./fixtures";

const CHANGE_ID = "5b0f3c2e-8d41-4a7e-9c16-2f7d0e9a4b83";
const SCAN_ID = "6c1f3c2e-8d41-4a7e-9c16-2f7d0e9a4b84";
const JOB_ID = "7d2f3c2e-8d41-4a7e-9c16-2f7d0e9a4b85";

test("shows a repository's scanned calls, impacts, migration and live monitor metrics", async ({ page }) => {
  seedChange({
    id: CHANGE_ID,
    provider: "anthropic",
    field: "claude-3-5-haiku-20241022",
    evidence: "December 1, 2026 | claude-3-5-haiku-20241022 | claude-haiku-4-5",
    status: "confirmed",
  });
  sql(`
    UPDATE breaking_changes SET detected_at = now() - interval '2 hours' WHERE id = '${CHANGE_ID}';
    INSERT INTO repositories (github_repo_id, full_name, installation_id)
    VALUES (9001, 'acme/web', 501);
    INSERT INTO repository_scans (id, repository_id, trigger, status, commit_sha)
    SELECT '${SCAN_ID}', id, 'manual', 'COMPLETED', 'abcdef0123456789abcdef0123456789abcdef01'
    FROM repositories WHERE github_repo_id = 9001;
    INSERT INTO api_usages (scan_id, provider_id, file, line, style, method, operation, params, model_ids, dynamic)
    SELECT '${SCAN_ID}', id, 'src/claude.ts', 24, 'sdk', 'beta.messages.stream', 'POST /v1/messages',
      ARRAY['model', 'messages'], ARRAY['claude-3-5-haiku-20241022'], false
    FROM api_providers WHERE slug = 'anthropic';
    INSERT INTO api_impacts (breaking_change_id, repository_id, confidence, files)
    SELECT '${CHANGE_ID}', id, 'confirmed', ARRAY['src/claude.ts']
    FROM repositories WHERE github_repo_id = 9001;
    INSERT INTO migration_jobs (id, repository_id, kind, breaking_change_id, status, pull_request_url)
    SELECT '${JOB_ID}', id, 'api_change', '${CHANGE_ID}', 'COMPLETED', 'https://github.com/acme/web/pull/9'
    FROM repositories WHERE github_repo_id = 9001;
    INSERT INTO execution_logs (job_id, step, output, created_at)
    VALUES ('${JOB_ID}', 'PR', 'Pushed branch and opened https://github.com/acme/web/pull/9', now() - interval '1 hour');
  `);

  await signIn(page, "/repositories/9001");
  await expect(page.getByRole("heading", { level: 1, name: "acme/web" })).toBeVisible();
  await expect(page.getByText("src/claude.ts:24")).toBeVisible();
  await expect(page.getByText("claude-3-5-haiku-20241022")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Migration completed/ })).toHaveAttribute("href", `/jobs/${JOB_ID}`);
  await expect(page.getByRole("link", { name: /Pull request/ })).toHaveAttribute("href", "https://github.com/acme/web/pull/9");
  await expect(page.getByText("abcdef0")).toBeVisible();

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }

  await page.goto("/api-changes");
  await expect(page.getByRole("heading", { name: "Monitor metrics" })).toBeVisible();
  await expect(page.getByText("1 API migration PR measured")).toBeVisible();
  await expect(page.getByText("1h 0m")).toBeVisible();

  await page.goto("/repositories/9002");
  await expect(page.getByText("Run a scan to find Anthropic and OpenAI calls.")).toBeVisible();
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(page.getByText("Scan queued.")).toBeVisible();
  await expect(page.getByText(/queued/).first()).toBeVisible();
});
