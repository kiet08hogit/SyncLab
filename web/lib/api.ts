import "server-only";

import type { ExecutionLog, JobDetail, MigrationJob, Repository } from "@/lib/types";

// The NestJS gateway in server/api. Its /migrations routes take the shared
// MIGRATIONS_API_TOKEN, so they are only ever called from the server.

function apiConfig(): { url: string; token: string } | null {
  const token = process.env.MIGRATIONS_API_TOKEN;
  return token ? { url: process.env.SYNCLAB_API_URL ?? "http://localhost:3000", token } : null;
}

export function apiConfigured(): boolean {
  return apiConfig() !== null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const config = apiConfig();
  if (!config) throw new Error("MIGRATIONS_API_TOKEN is not set");
  return fetch(`${config.url}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}`, ...init.headers },
    cache: "no-store",
  });
}

/** Nest answers errors as `{ message }`, where message may be a list of validation errors. */
async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
  return message || `The SyncLab API answered ${response.status}`;
}

export async function createMigration(input: {
  repoFullName: string;
  dependencyName: string;
  targetVersion: string;
}): Promise<{ id: string } | { error: string }> {
  const response = await request("/migrations", { method: "POST", body: JSON.stringify(input) });
  if (!response.ok) return { error: await errorMessage(response) };
  return { id: ((await response.json()) as { id: string }).id };
}

type ApiJob = MigrationJob & { repository: Repository; executionLogs: ExecutionLog[] };

export async function fetchJob(id: string): Promise<JobDetail | null> {
  const response = await request(`/migrations/${encodeURIComponent(id)}`);
  // 400 is the gateway rejecting an id that is not a UUID.
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error(await errorMessage(response));
  const job = (await response.json()) as ApiJob;
  return { ...job, steps: job.executionLogs.map((log) => log.step) };
}
