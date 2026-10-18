import "server-only";

import type {
  ApiChange,
  ApiChangeDecision,
  ApiChangeFilter,
  ApiProviderSummary,
  ExecutionLog,
  JobDetail,
  JobStatus,
  JobWithRepository,
  MigrationJob,
  Repository,
  RepositorySummary,
} from "@/lib/types";

// The NestJS gateway in server/api. Every call carries the signed-in user's
// GitHub token, and the API itself limits the answer to repositories that
// user's installations reach.

const API_URL = process.env.SYNCLAB_API_URL ?? "http://localhost:3000";

/** The API no longer accepts the token, so the user has to sign in again. */
export class ApiUnauthorizedError extends Error {}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
    cache: "no-store",
  });
  if (response.status === 401) throw new ApiUnauthorizedError(await errorMessage(response));
  return response;
}

/** Nest answers errors as `{ message }`, where message may be a list of validation errors. */
async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
  return message || `The SyncLab API answered ${response.status}`;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export async function listJobs(
  token: string,
  filter: { status?: JobStatus; repository?: string; query?: string },
): Promise<JobWithRepository[]> {
  const search = new URLSearchParams();
  if (filter.status) search.set("status", filter.status);
  if (filter.repository) search.set("repo", filter.repository);
  if (filter.query) search.set("q", filter.query);
  return json(await request(token, `/migrations?${search}`));
}

export async function countJobs(token: string): Promise<Record<JobStatus, number>> {
  return json(await request(token, "/migrations/counts"));
}

export async function listRepositories(token: string): Promise<RepositorySummary[]> {
  return json(await request(token, "/repositories"));
}

type ApiJob = MigrationJob & { repository: Repository; executionLogs: ExecutionLog[] };

export async function fetchJob(token: string, id: string): Promise<JobDetail | null> {
  const response = await request(token, `/migrations/${encodeURIComponent(id)}`);
  // 404 also covers a job outside the user's repositories; 400 is an id that is not a UUID.
  if (response.status === 404 || response.status === 400) return null;
  const job = await json<ApiJob>(response);
  return { ...job, steps: job.executionLogs.map((log) => log.step) };
}

export async function createMigration(
  token: string,
  input: { repoFullName: string; dependencyName: string; targetVersion: string },
): Promise<{ id: string } | { error: string }> {
  const response = await request(token, "/migrations", { method: "POST", body: JSON.stringify(input) });
  if (!response.ok) return { error: await errorMessage(response) };
  return { id: ((await response.json()) as { id: string }).id };
}

/** The API answers 404 for every monitor route until it runs the change monitor. */
export class MonitorUnavailableError extends Error {}

async function monitor<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await request(token, path, init);
  if (response.status === 404) throw new MonitorUnavailableError(await errorMessage(response));
  return json(response);
}

export async function listApiProviders(token: string): Promise<ApiProviderSummary[]> {
  return monitor(token, "/api-providers");
}

export async function listApiChanges(token: string, filter: ApiChangeFilter): Promise<ApiChange[]> {
  const search = new URLSearchParams();
  if (filter.provider) search.set("provider", filter.provider);
  if (filter.status) search.set("status", filter.status);
  if (filter.kind) search.set("kind", filter.kind);
  return monitor(token, `/api-changes?${search}`);
}

/** Fetches every watched source now instead of waiting for the schedule. */
export async function pollApiProviders(token: string): Promise<{ queued: boolean }> {
  return monitor(token, "/api-providers/poll", { method: "POST" });
}

/**
 * Confirms or dismisses a change. Not through monitor(), since a 404 here
 * means the change is gone rather than that the API has no monitor.
 */
export async function reviewApiChange(
  token: string,
  id: string,
  decision: ApiChangeDecision,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const response = await request(token, `/api-changes/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
  if (!response.ok) return { ok: false, status: response.status, error: await errorMessage(response) };
  return { ok: true };
}
