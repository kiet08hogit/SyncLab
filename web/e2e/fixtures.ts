import { execFileSync } from "node:child_process";
import { expect, test as base, type Page } from "@playwright/test";

import { LOGIN, REPOSITORIES } from "./stub";

/** Runs SQL in the test database and returns psql's unaligned rows. */
export function sql(query: string): string {
  return execFileSync("docker", ["exec", process.env.E2E_PG_CONTAINER!, "psql", "-U", "admin", "-d", "synclab", "-v", "ON_ERROR_STOP=1", "-tAc", query], {
    encoding: "utf8",
  }).trim();
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export interface SeedLog {
  step: string;
  output?: string;
  /** Minutes before now. */
  ago: number;
}

/** Inserts a job and its log rows directly, the way the worker would have left them. */
export function seedJob(job: {
  id: string;
  repo?: string;
  dependency: string;
  version: string;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  error?: string;
  pullRequestUrl?: string;
  /** Minutes before now. */
  createdAgo: number;
  logs?: SeedLog[];
}) {
  const repo = REPOSITORIES.find((candidate) => candidate.full_name === (job.repo ?? "acme/web"))!;
  const lastLog = job.logs?.at(-1)?.ago ?? job.createdAgo;
  sql(`
    INSERT INTO repositories (github_repo_id, full_name, installation_id)
    VALUES (${repo.id}, ${quote(repo.full_name)}, 0) ON CONFLICT (github_repo_id) DO NOTHING;
    INSERT INTO migration_jobs (id, repository_id, dependency_name, target_version, status, error_message, pull_request_url, created_at, updated_at)
    SELECT ${quote(job.id)}, id, ${quote(job.dependency)}, ${quote(job.version)}, ${quote(job.status)},
      ${job.error ? quote(job.error) : "NULL"}, ${job.pullRequestUrl ? quote(job.pullRequestUrl) : "NULL"},
      now() - interval '${job.createdAgo} minutes', now() - interval '${lastLog} minutes'
    FROM repositories WHERE github_repo_id = ${repo.id};
  `);
  for (const log of job.logs ?? []) addLog(job.id, log);
}

export function addLog(jobId: string, log: SeedLog) {
  sql(`INSERT INTO execution_logs (job_id, step, output, created_at)
    VALUES (${quote(jobId)}, ${quote(log.step)}, ${log.output === undefined ? "NULL" : quote(log.output)}, now() - interval '${log.ago} minutes')`);
}

/** Signs in through the real OAuth redirect, which the stub approves at once. */
export async function signIn(page: Page, returnTo = "/settings") {
  await page.goto(`/auth/github?returnTo=${encodeURIComponent(returnTo)}`);
  await page.waitForURL((url) => url.pathname === returnTo.split("?")[0]);
}

// A 1x1 transparent PNG, for avatars.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export const test = base.extend<{ cleanSlate: void }>({
  cleanSlate: [
    async ({ page }, use) => {
      sql("TRUNCATE execution_logs, migration_jobs, repositories CASCADE");
      execFileSync("docker", ["exec", process.env.E2E_REDIS_CONTAINER!, "redis-cli", "FLUSHALL"], { stdio: "ignore" });
      // Avatars come from GitHub through Next's image optimizer; keep the suite offline.
      await page.route("**/_next/image**", (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
      await use();
    },
    { auto: true },
  ],
});

export { expect, LOGIN };
