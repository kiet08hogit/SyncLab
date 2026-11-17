import { execFileSync } from "node:child_process";
import { test, expect, signIn } from "./fixtures";
import { API_PORT } from "./ports";
import { USER_TOKEN } from "./stub";

function redis(...args: string[]) {
  return execFileSync("docker", ["exec", process.env.E2E_REDIS_CONTAINER!, "redis-cli", ...args], { encoding: "utf8" }).trim();
}

test("protects infrastructure metrics and offers sign-in without sample data", async ({ page, request }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "Sign in to view operations" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Operations metrics" })).toHaveCount(0);
  expect((await request.get(`http://localhost:${API_PORT}/operations`)).status()).toBe(401);
  expect((await request.get(`http://localhost:${API_PORT}/metrics`)).status()).toBe(401);
  await signIn(page, "/operations", "viewer");
  await expect(page.getByRole("heading", { name: "Operations access required" })).toBeVisible();
  for (const endpoint of ["operations", "metrics"]) {
    const response = await request.get(`http://localhost:${API_PORT}/${endpoint}`, { headers: { Authorization: "Bearer e2e-viewer-token" } });
    expect(response.status()).toBe(403);
  }
});

test("shows shared worker telemetry, queue state, Prometheus metrics, and live updates", async ({ page, request }) => {
  redis("HSET", "synclab:operations:v1", "creation_count", "4", "creation_seconds", "2", "creation_failed", "1", "tokens_input", "1200", "tokens_output", "300");
  // Model a paused queue and retained failed job using BullMQ's own Redis state.
  redis("HSET", "bull:scan-queue:meta", "paused", "1");
  redis("LPUSH", "bull:scan-queue:paused", "test-paused-job");
  redis("ZADD", "bull:migration-queue:failed", "1", "test-failed-job");
  await signIn(page, "/operations");
  const metrics = page.getByRole("region", { name: "Operations metrics" });
  await expect(metrics).toContainText("1,500");
  await expect(metrics).toContainText("0.50s");
  await expect(page.getByRole("article", { name: "Repository scans" })).toContainText("Paused");
  await expect(page.getByText("Review paused queues and recorded failures")).toBeVisible();
  const scrape = await request.get(`http://localhost:${API_PORT}/metrics`, { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
  expect(scrape.ok()).toBe(true);
  expect(scrape.headers()["content-type"]).toContain("text/plain");
  expect(scrape.headers()["cache-control"]).toBe("no-store");
  expect(await scrape.text()).toContain('synclab_llm_tokens_total{direction="input"} 1200');
  expect(await scrape.text()).toContain('synclab_queue_paused{queue="scan-queue"} 1');
  redis("HINCRBY", "synclab:operations:v1", "tokens_input", "100");
  await expect(metrics).toContainText("1,600", { timeout: 12_000 });
  await page.getByRole("link", { name: "Operations", exact: true }).click();
  await expect(page.getByRole("link", { name: "Operations", exact: true })).toHaveAttribute("aria-current", "page");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(metrics).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/private/tmp/synclab-operations-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 812, height: 375 });
  await expect(metrics).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/private/tmp/synclab-operations-dark.png", fullPage: true });
});

test("shows a clear zero-usage state before the first instrumented run", async ({ page }) => {
  await signIn(page, "/operations");
  await expect(page.getByRole("region", { name: "Operations metrics" })).toContainText("No samples");
  await expect(page.getByText("Queues accepting work", { exact: true })).toBeVisible();
});
