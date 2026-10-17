import { execFileSync } from "node:child_process";

import { expect, signIn, sql, test } from "./fixtures";

function queuedInRedis(): number {
  return Number(
    execFileSync("docker", ["exec", process.env.E2E_REDIS_CONTAINER!, "redis-cli", "LLEN", "bull:migration-queue:wait"], {
      encoding: "utf8",
    }).trim(),
  );
}

async function startMigration(page: import("@playwright/test").Page) {
  await page.getByRole("combobox", { name: "Repository" }).click();
  await page.getByRole("option", { name: "acme/web" }).click();

  await page.getByRole("combobox", { name: "Dependency" }).click();
  // Read from the repository's package.json, dev dependencies included.
  await expect(page.getByRole("option")).toHaveText([/next/, /vitest/, /zod/]);
  await page.getByRole("option", { name: /zod/ }).click();

  await page.getByRole("combobox", { name: "Target version" }).click();
  // Stable releases from the registry, newest first; the beta is left out.
  await expect(page.getByRole("option")).toHaveText([/4\.1\.0/, /4\.0\.0/, /3\.23\.8/]);
  await page.getByRole("option", { name: /4\.1\.0/ }).click();

  await page.getByRole("button", { name: "Start migration" }).click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
}

test("starts a migration from the form and opens its queued job", async ({ page }) => {
  await signIn(page, "/migrations/new");
  await startMigration(page);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("zod");
  await expect(page.getByRole("list", { name: "Waiting for a worker" })).toBeVisible();

  const id = page.url().split("/").at(-1);
  expect(sql(`SELECT r.full_name, j.dependency_name, j.target_version, j.status FROM migration_jobs j JOIN repositories r ON r.id = j.repository_id WHERE j.id = '${id}'`)).toBe(
    "acme/web|zod|4.1.0|QUEUED",
  );
  expect(queuedInRedis()).toBe(1);
});

test("starting the same migration again opens the existing job", async ({ page }) => {
  await signIn(page, "/migrations/new");
  await startMigration(page);
  const first = page.url();

  await page.goto("/migrations/new");
  await startMigration(page);
  expect(page.url()).toBe(first);
  expect(sql("SELECT count(*) FROM migration_jobs")).toBe("1");
  expect(queuedInRedis()).toBe(1);
});
