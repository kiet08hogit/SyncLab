import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { Browser, Page } from "@playwright/test";

import { expect, seedChange, signIn, sql, test } from "./fixtures";
import { WEB_PORT } from "./ports";

// Review paths the main API-changes spec does not click: dismiss then confirm
// the other way, a 403 that must stay on its row, a revoked token (API 401),
// and a second row whose buttons stay disabled while the first review is in flight.

// The same secret global-setup.ts gives the web server. Tests seal a cookie the
// running app will accept, then hand the API a token the GitHub stub rejects.
const SESSION_SECRET = "e2e-session-secret";
const SESSION_COOKIE = "synclab_session";
const FORBIDDEN = "Only monitor admins can confirm or dismiss changes.";
const GONE = "This change no longer exists.";
const EXPIRED = "Your GitHub session expired. Sign in again to review this change.";

function sealSession(token: string): string {
  const secret = createHash("sha256").update(SESSION_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const body = Buffer.concat([
    cipher.update(
      JSON.stringify({
        accessToken: token,
        expiresAt: Date.now() + 60 * 60_000,
        login: "octo-e2e",
        name: "Octo E2E",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      }),
      "utf8",
    ),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function readSealedToken(sealed: string): string | null {
  const secret = createHash("sha256").update(SESSION_SECRET).digest();
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", secret, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    const session = JSON.parse(body.toString("utf8")) as { accessToken?: string; expiresAt?: number };
    return session.expiresAt && session.expiresAt > Date.now() ? (session.accessToken ?? null) : null;
  } catch {
    return null;
  }
}

async function replaceSession(page: Page, value: string) {
  const current = (await page.context().cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
  if (!current) throw new Error("expected a synclab_session cookie");
  await page.context().addCookies([{ ...current, value }]);
}

async function viewerSession(browser: Browser): Promise<string> {
  const context = await browser.newContext({ baseURL: `http://localhost:${WEB_PORT}` });
  const page = await context.newPage();
  try {
    await signIn(page, "/api-changes", "viewer");
    const cookie = (await context.cookies()).find((item) => item.name === SESSION_COOKIE);
    if (!cookie) throw new Error("viewer session cookie missing");
    return cookie.value;
  } finally {
    await context.close();
  }
}

const statusOf = (id: string) => sql(`SELECT status FROM breaking_changes WHERE id = '${id}'`);

test("an admin dismisses a detected change, then confirms that dismissed change", async ({ page }) => {
  const change = {
    id: "6c1a4d3f-9e52-4b8f-8d27-3a8e1f0b5c94",
    provider: "anthropic" as const,
    field: "claude-3-haiku-20240307",
    evidence: "March 7, 2026 | claude-3-haiku-20240307 retired",
    status: "detected" as const,
  };
  seedChange(change);
  await signIn(page, "/api-changes");

  const row = page.getByRole("row").filter({ hasText: change.field });
  const review = row.getByRole("group", { name: `Review ${change.field}` });
  await expect(review.getByRole("button")).toHaveText(["Confirm", "Dismiss"]);

  await review.getByRole("button", { name: "Dismiss" }).click();
  await expect(row.getByText("Dismissed", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(review.getByRole("button")).toHaveText(["Confirm"]);
  expect(statusOf(change.id)).toBe("dismissed");

  await review.getByRole("button", { name: "Confirm" }).click();
  await expect(row.getByText("Confirmed", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(review.getByRole("button")).toHaveText(["Dismiss"]);
  expect(statusOf(change.id)).toBe("confirmed");
  await expect(row.getByRole("alert")).toHaveCount(0);
});

test("a review in flight disables every row and shows the busy label", async ({ page }) => {
  const first = {
    id: "7d2b5e40-af63-4c90-9e38-4b9f2a1c6d05",
    provider: "anthropic" as const,
    field: "claude-sonnet-4-20250514",
    evidence: "May 14, 2026 | claude-sonnet-4 retired",
    status: "detected" as const,
  };
  const second = {
    id: "8e3c6f51-b074-4da1-af49-5c0a3b2d7e16",
    provider: "openai" as const,
    field: "gpt-4-0314",
    evidence: "March 14, 2026 | gpt-4-0314 retired",
    status: "detected" as const,
  };
  seedChange(first);
  seedChange(second);
  await signIn(page, "/api-changes");

  const rowA = page.getByRole("row").filter({ hasText: first.field });
  const rowB = page.getByRole("row").filter({ hasText: second.field });
  await expect(rowA.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await expect(rowB.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();

  let held = 0;
  let releaseHold!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  await page.route("**/api-changes**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      held += 1;
      await hold;
    }
    await route.continue();
  });

  const submitted = rowA.getByRole("button", { name: "Confirm", exact: true }).click({ noWaitAfter: true });
  try {
    await expect(rowA.getByRole("button", { name: "Confirming…" })).toBeVisible();
    await expect(rowA.getByRole("button", { name: "Dismiss", exact: true })).toBeDisabled();
    await expect(rowB.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await expect(rowB.getByRole("button", { name: "Dismiss", exact: true })).toBeDisabled();
  } finally {
    releaseHold();
  }
  await submitted;

  await expect(rowA.getByText("Confirmed", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(rowB.getByRole("button", { name: "Confirm", exact: true })).toBeEnabled();
  await expect(rowB.getByRole("button", { name: "Dismiss", exact: true })).toBeEnabled();
  expect(held).toBe(1);
  expect(statusOf(first.id)).toBe("confirmed");
  expect(statusOf(second.id)).toBe("detected");
});

test("a 403 stays on the row, and hiding that row with a filter does not turn it into a removed banner", async ({
  page,
  browser,
}) => {
  const change = {
    id: "9f4d7062-c185-4eb2-b05a-6d1b4c3e8f27",
    provider: "anthropic" as const,
    field: "claude-opus-4-20250514",
    evidence: "May 14, 2026 | claude-opus-4 retired",
    status: "detected" as const,
  };
  seedChange(change);
  await signIn(page, "/api-changes");
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();

  // The page rendered confirm for an admin. Swap in a non-admin session before
  // the click, which is when the API answers 403 and the refresh drops canReview.
  await replaceSession(page, await viewerSession(browser));
  const row = page.getByRole("row").filter({ hasText: change.field });
  await row.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect(row.getByRole("alert")).toHaveText(FORBIDDEN);
  await expect(page.getByRole("button", { name: /^(Confirm|Dismiss)$/ })).toHaveCount(0);
  await expect(row.getByText("Detected", { exact: true }).filter({ visible: true })).toBeVisible();
  expect(statusOf(change.id)).toBe("detected");

  await page.getByRole("navigation", { name: "Filter by provider" }).getByRole("link", { name: "OpenAI" }).click();
  await expect(page.getByText("No changes match these filters")).toBeVisible();
  // The route announcer is also an alert, so match the review copy itself.
  await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
  await expect(page.getByText(GONE)).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: FORBIDDEN })).toHaveCount(0);
  expect(statusOf(change.id)).toBe("detected");
});

test("a revoked GitHub token shows the session-expired message and leaves the change detected", async ({ page }) => {
  const change = {
    id: "a05e8173-d296-4fc3-816b-7e2c5d4f9038",
    provider: "anthropic" as const,
    field: "claude-3-opus-20240229",
    evidence: "February 29, 2026 | claude-3-opus retired",
    status: "detected" as const,
  };
  seedChange(change);
  await signIn(page, "/api-changes");
  const row = page.getByRole("row").filter({ hasText: change.field });
  await expect(row.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();

  const sealed = sealSession("e2e-revoked-token");
  expect(readSealedToken(sealed)).toBe("e2e-revoked-token");
  await replaceSession(page, sealed);
  await row.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect(row.getByRole("alert")).toHaveText(EXPIRED);
  await expect(row.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await expect(row.getByText("Detected", { exact: true }).filter({ visible: true })).toBeVisible();
  expect(statusOf(change.id)).toBe("detected");
});
