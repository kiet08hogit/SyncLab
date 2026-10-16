// Mirrors the Prisma models and constants in server/api. BigInt columns arrive
// as strings because JSON cannot carry them.

export const JOB_STATUSES = ["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type LogStep =
  "STARTED" | "CLONE" | "INSTALL" | "UPGRADE" | "CHANGELOG" | "REFACTOR" | "TEST" | "PR" | "SKIPPED" | "FAILED";

/** The sandbox stages a migration moves through, in order. */
export const PIPELINE_STAGES = ["CLONE", "INSTALL", "UPGRADE", "CHANGELOG", "REFACTOR", "TEST", "PR"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface Repository {
  id: string;
  githubRepoId: string;
  fullName: string;
  installationId: string;
  createdAt: string;
}

export interface ExecutionLog {
  id: string;
  jobId: string;
  step: LogStep;
  output: string | null;
  createdAt: string;
}

export interface MigrationJob {
  id: string;
  repositoryId: string;
  dependencyName: string;
  targetVersion: string;
  status: JobStatus;
  pullRequestUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobWithRepository extends MigrationJob {
  repository: Repository;
  /** Steps reached so far, oldest first. Enough to draw the pipeline track. */
  steps: LogStep[];
}

export interface JobDetail extends JobWithRepository {
  executionLogs: ExecutionLog[];
}

/** A repository the signed-in user can reach, with SyncLab's job totals for it. */
export interface RepositorySummary {
  githubRepoId: string;
  fullName: string;
  installationId: string;
  /** null when the API could not tell, which only happens for service callers. */
  private: boolean | null;
  jobCount: number;
  completed: number;
  failed: number;
  active: number;
  lastActivityAt: string | null;
}
