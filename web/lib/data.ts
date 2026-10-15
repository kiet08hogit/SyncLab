import "server-only";

import { connection } from "next/server";

import type {
  ExecutionLog,
  JobDetail,
  JobStatus,
  JobWithRepository,
  LogStep,
  MigrationJob,
  Repository,
  RepositorySummary,
} from "@/lib/types";

// The API has no read endpoints yet, so every getter below serves sample data
// shaped exactly like the Prisma models. Swapping in real requests only means
// rewriting these functions; nothing that renders them has to change.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const repositories: Repository[] = [
  repo("6b1f0c2e-4a51-4c1e-9d0a-1f3e2b7c9a10", "48213377", "northwind/checkout-service", "51234001", 21 * 24 * HOUR),
  repo("0d8e4b6a-2f7c-4e93-8a51-7c2d9e1b3f42", "48213491", "northwind/storefront", "51234001", 21 * 24 * HOUR),
  repo("a3c9e1f4-7b2d-4f60-b8e5-2d4a6c8e0b17", "50991204", "northwind/billing-worker", "51234001", 9 * 24 * HOUR),
  repo("f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b", "61002387", "kiet08hogit/SyncLab", "58810452", 3 * 24 * HOUR),
];

interface JobSeed {
  id: string;
  repo: number;
  dependencyName: string;
  targetVersion: string;
  status: JobStatus;
  createdAgo: number;
  logs: Array<[LogStep, string | null]>;
  pr?: number;
  error?: string;
}

const seeds: JobSeed[] = [
  {
    id: "c41a9e07-5d2b-4f8e-a1c3-9b7d6e5f4a01",
    repo: 1,
    dependencyName: "next",
    targetVersion: "v15.1.0",
    status: "IN_PROGRESS",
    createdAgo: 6 * MINUTE,
    logs: [
      ["STARTED", "Starting migration for northwind/storefront"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 4,812 objects, done."],
      ["INSTALL", "[exit 0]\nadded 1,204 packages in 38s\nnext@15.1.0 installed (was 14.2.18)"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for next v15.0.0 → v15.1.0 (3 releases, 41 breaking-change mentions)."],
    ],
  },
  {
    id: "8f2b6d1a-3e4c-4a7b-9c0d-1e2f3a4b5c02",
    repo: 0,
    dependencyName: "express",
    targetVersion: "v5.1.0",
    status: "IN_PROGRESS",
    createdAgo: 2 * MINUTE,
    logs: [
      ["STARTED", "Starting migration for northwind/checkout-service"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 2,147 objects, done."],
    ],
  },
  {
    id: "4e6b8d0f-2a4c-4e8a-b1d3-5f7a9c1e3b10",
    repo: 3,
    dependencyName: "@nestjs/core",
    targetVersion: "v11.1.0",
    status: "IN_PROGRESS",
    createdAgo: 14 * MINUTE,
    logs: [
      ["STARTED", "Starting migration for kiet08hogit/SyncLab"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 598 objects, done."],
      ["INSTALL", "[exit 0]\nchanged 6 packages in 12s"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for @nestjs/core v11.0.0 → v11.1.0 (2 releases, no breaking changes)."],
      ["REFACTOR", "Attempt 1/3 using gemini-2.5-flash\n429 Too Many Requests: quota exceeded, retry in 60s"],
      ["FAILED", "model call failed on src/app.module.ts: 429 Too Many Requests: quota exceeded, retry in 60s"],
      ["STARTED", "Starting migration for kiet08hogit/SyncLab"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 598 objects, done."],
    ],
  },
  {
    id: "b7d9f1a3-5c7e-4a9b-8d1f-3a5c7e9b1d11",
    repo: 2,
    dependencyName: "ioredis",
    targetVersion: "v5.6.1",
    status: "FAILED",
    createdAgo: 7 * HOUR,
    error: "Installation token request failed: the GitHub App is no longer installed on northwind/billing-worker.",
    logs: [
      ["STARTED", "Starting migration for northwind/billing-worker"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 1,388 objects, done."],
      ["INSTALL", "[exit 0]\nchanged 1 package in 5s"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for ioredis v5.4.2 → v5.6.1 (4 releases, no breaking changes)."],
      ["REFACTOR", "Attempt 1/3 using gemini-2.5-flash\n429 Too Many Requests: quota exceeded, retry in 60s"],
      ["FAILED", "model call failed on src/queue/redis.ts: 429 Too Many Requests: quota exceeded, retry in 60s"],
      [
        "FAILED",
        "Installation token request failed: the GitHub App is no longer installed on northwind/billing-worker.",
      ],
    ],
  },
  {
    id: "2a7c5e9b-1d3f-4b6a-8e0c-4f2d6b8a0c03",
    repo: 2,
    dependencyName: "bullmq",
    targetVersion: "v5.34.0",
    status: "QUEUED",
    createdAgo: 1 * MINUTE,
    logs: [],
  },
  {
    id: "5e1d3b7f-9a2c-4e6d-b0f8-3c5a7e9b1d04",
    repo: 1,
    dependencyName: "tailwindcss",
    targetVersion: "v4.0.0",
    status: "COMPLETED",
    createdAgo: 3 * HOUR,
    pr: 412,
    logs: [
      ["STARTED", "Starting migration for northwind/storefront"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 4,790 objects, done."],
      ["INSTALL", "[exit 0]\nadded 9 packages, removed 14 packages in 11s"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for tailwindcss v3.4.17 → v4.0.0 (1 release, CSS-first configuration)."],
      [
        "REFACTOR",
        'Moved theme from tailwind.config.js into @theme in app/globals.css.\nReplaced @tailwind directives with @import "tailwindcss".\nUpdated 7 files: shadow-sm → shadow-xs, ring → ring-3.',
      ],
      ["TEST", "[exit 0]\nTest Suites: 48 passed, 48 total\nTests:       312 passed, 312 total\nTime:        41.8 s"],
      ["PR", "Opened https://github.com/northwind/storefront/pull/412 from synclab/tailwindcss-v4-0-0"],
    ],
  },
  {
    id: "9b3f7a1c-5e2d-4c8b-a6f0-7d1e3b5c9a05",
    repo: 0,
    dependencyName: "zod",
    targetVersion: "v4.0.0",
    status: "FAILED",
    createdAgo: 5 * HOUR,
    error: "Tests failed after refactor: 3 of 186 tests failed in src/validation/order.spec.ts",
    logs: [
      ["STARTED", "Starting migration for northwind/checkout-service"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 2,139 objects, done."],
      ["INSTALL", "[exit 0]\nadded 1 package, changed 1 package in 6s"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for zod v3.24.1 → v4.0.0 (1 release, error customization API changed)."],
      ["REFACTOR", "Rewrote 11 schemas: .errorMap() → error param, z.string().email() → z.email()."],
      [
        "TEST",
        '[exit 1]\nFAIL src/validation/order.spec.ts\n  ● order schema › rejects a negative quantity\n    Expected message: "Quantity must be positive"\n    Received message: "Too small: expected number to be >0"\n\nTest Suites: 1 failed, 23 passed, 24 total\nTests:       3 failed, 183 passed, 186 total',
      ],
      ["FAILED", "Tests failed after refactor: 3 of 186 tests failed in src/validation/order.spec.ts"],
    ],
  },
  {
    id: "1c8e2a6d-4b0f-4e3a-9d7c-5a1b3c8e2d06",
    repo: 3,
    dependencyName: "prisma",
    targetVersion: "v7.9.1",
    status: "COMPLETED",
    createdAgo: 9 * HOUR,
    pr: 18,
    logs: [
      ["STARTED", "Starting migration for kiet08hogit/SyncLab"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 612 objects, done."],
      ["INSTALL", "[exit 0]\nchanged 2 packages in 9s"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for prisma v7.8.0 → v7.9.1 (2 releases, no breaking changes)."],
      ["REFACTOR", "No code changes required; updated @prisma/client and @prisma/adapter-pg in lockstep."],
      ["TEST", "[exit 0]\nTest Suites: 6 passed, 6 total\nTests:       41 passed, 41 total"],
      ["PR", "Opened https://github.com/kiet08hogit/SyncLab/pull/18 from synclab/prisma-v7-9-1"],
    ],
  },
  {
    id: "7d4a0e8c-2b6f-4a1d-8c3e-9f5b7d1a3e07",
    repo: 2,
    dependencyName: "pg",
    targetVersion: "v8.22.0",
    status: "FAILED",
    createdAgo: 26 * HOUR,
    error:
      "Clone failed: installation token was rejected (HTTP 401). Reinstall the GitHub App on northwind/billing-worker.",
    logs: [
      ["STARTED", "Starting migration for northwind/billing-worker"],
      [
        "CLONE",
        "[exit 128]\nremote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/northwind/billing-worker.git/'",
      ],
      [
        "FAILED",
        "Clone failed: installation token was rejected (HTTP 401). Reinstall the GitHub App on northwind/billing-worker.",
      ],
    ],
  },
  {
    id: "3f9c1e5a-7d2b-4f0e-b4a8-6c2e0a4f8b08",
    repo: 0,
    dependencyName: "typescript",
    targetVersion: "v5.7.3",
    status: "COMPLETED",
    createdAgo: 2 * 24 * HOUR,
    pr: 1287,
    logs: [
      ["STARTED", "Starting migration for northwind/checkout-service"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 2,101 objects, done."],
      ["INSTALL", "[exit 0]\nchanged 1 package in 4s"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for typescript v5.6.3 → v5.7.3 (3 releases)."],
      ["REFACTOR", "Fixed 4 new errors from stricter checks on never-initialized variables."],
      ["TEST", "[exit 0]\nTest Suites: 24 passed, 24 total\nTests:       186 passed, 186 total"],
      ["PR", "Opened https://github.com/northwind/checkout-service/pull/1287 from synclab/typescript-v5-7-3"],
    ],
  },
  {
    id: "6a2e8c4f-0b7d-4d1a-a9e3-2f8c4a6e0b09",
    repo: 1,
    dependencyName: "react",
    targetVersion: "v19.0.0",
    status: "COMPLETED",
    createdAgo: 4 * 24 * HOUR,
    pr: 398,
    logs: [
      ["STARTED", "Starting migration for northwind/storefront"],
      ["CLONE", "[exit 0]\nCloning into '/workspace/repo'...\nresolved 4,655 objects, done."],
      ["INSTALL", "[exit 0]\nchanged 4 packages in 14s"],
      ["UPGRADE", "[exit 0]\nUpgraded the dependency to the target version with --ignore-scripts."],
      ["CHANGELOG", "Fetched release notes for react v18.3.1 → v19.0.0 (1 release, 12 removed APIs)."],
      ["REFACTOR", "Replaced forwardRef in 19 components with ref as a prop; removed 3 propTypes declarations."],
      ["TEST", "[exit 0]\nTest Suites: 48 passed, 48 total\nTests:       309 passed, 309 total"],
      ["PR", "Opened https://github.com/northwind/storefront/pull/398 from synclab/react-v19-0-0"],
    ],
  },
];

function repo(
  id: string,
  githubRepoId: string,
  fullName: string,
  installationId: string,
  createdAgo: number,
): Repository {
  return { id, githubRepoId, fullName, installationId, createdAt: ago(createdAgo) };
}

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function build(seed: JobSeed): JobDetail {
  const repository = repositories[seed.repo];
  // Spread the log rows across the job's lifetime so their timestamps read
  // like a real run: about 40 seconds per step.
  const executionLogs: ExecutionLog[] = seed.logs.map(([step, output], index) => ({
    id: `${seed.id.slice(0, 8)}-log-${index}`,
    jobId: seed.id,
    step,
    output,
    createdAt: ago(seed.createdAgo - (index + 1) * 40_000),
  }));
  const lastLog = executionLogs.at(-1);

  const job: MigrationJob = {
    id: seed.id,
    repositoryId: repository.id,
    dependencyName: seed.dependencyName,
    targetVersion: seed.targetVersion,
    status: seed.status,
    pullRequestUrl: seed.pr ? `https://github.com/${repository.fullName}/pull/${seed.pr}` : null,
    errorMessage: seed.error ?? null,
    createdAt: ago(seed.createdAgo),
    updatedAt: lastLog?.createdAt ?? ago(seed.createdAgo),
  };

  return { ...job, repository, steps: executionLogs.map((log) => log.step), executionLogs };
}

function allJobs(): JobDetail[] {
  return seeds.map(build).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJobs(
  filter: { status?: JobStatus; repository?: string; query?: string } = {},
): Promise<JobWithRepository[]> {
  await connection();
  const query = filter.query?.trim().toLowerCase();

  return allJobs()
    .filter((job) => !filter.status || job.status === filter.status)
    .filter((job) => !filter.repository || job.repository.fullName === filter.repository)
    .filter(
      (job) =>
        !query ||
        job.dependencyName.toLowerCase().includes(query) ||
        job.repository.fullName.toLowerCase().includes(query) ||
        job.targetVersion.toLowerCase().includes(query),
    );
}

export async function getJob(id: string): Promise<JobDetail | null> {
  await connection();
  return allJobs().find((job) => job.id === id) ?? null;
}

export async function getStatusCounts(): Promise<Record<JobStatus, number>> {
  await connection();
  const counts: Record<JobStatus, number> = { QUEUED: 0, IN_PROGRESS: 0, COMPLETED: 0, FAILED: 0 };
  for (const job of allJobs()) {
    counts[job.status] += 1;
  }
  return counts;
}

export async function getRepositories(): Promise<RepositorySummary[]> {
  await connection();
  const jobs = allJobs();

  return repositories
    .map((repository) => {
      const own = jobs.filter((job) => job.repositoryId === repository.id);
      return {
        ...repository,
        jobCount: own.length,
        completed: own.filter((job) => job.status === "COMPLETED").length,
        failed: own.filter((job) => job.status === "FAILED").length,
        active: own.filter((job) => job.status === "QUEUED" || job.status === "IN_PROGRESS").length,
        lastActivityAt:
          own
            .map((job) => job.updatedAt)
            .sort()
            .at(-1) ?? null,
      };
    })
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
}
