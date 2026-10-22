// Mirrors the Prisma models and constants in server/api. BigInt columns arrive
// as strings because JSON cannot carry them.

export const JOB_STATUSES = ["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type LogStep =
  | "STARTED"
  | "CLONE"
  | "CHANGELOG"
  | "INSTALL"
  | "BASELINE"
  | "UPGRADE"
  | "REFACTOR"
  | "TEST"
  | "PR"
  | "SKIPPED"
  | "FAILED";

/**
 * The sandbox stages a migration moves through, in the order the worker logs
 * them: prepare logs CLONE and CHANGELOG, then install, the baseline test run
 * on the current version, the upgrade, refactor, test and publish.
 */
export const PIPELINE_STAGES = [
  "CLONE",
  "CHANGELOG",
  "INSTALL",
  "BASELINE",
  "UPGRADE",
  "REFACTOR",
  "TEST",
  "PR",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * An API change keeps the SDK the repository has and carries its own brief,
 * so it reads no release notes and runs no upgrade.
 */
export const API_CHANGE_PIPELINE_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.filter(
  (stage) => stage !== "CHANGELOG" && stage !== "UPGRADE",
);

export type MigrationKind = "dependency" | "api_change";

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

/** What an api_change job migrates off. */
export interface MigrationChange {
  id: string;
  provider: ApiProvider;
  kind: ApiChangeKind;
  operation: string | null;
  field: string | null;
  replacement: string | null;
  effectiveAt: string | null;
}

export interface MigrationJob {
  id: string;
  repositoryId: string;
  kind: MigrationKind;
  /** Set for a dependency job only. */
  dependencyName: string | null;
  targetVersion: string | null;
  breakingChangeId: string | null;
  /** Set for an api_change job only. */
  breakingChange: MigrationChange | null;
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

// The API change monitor, as documented under "Monitoring endpoints" in
// infra/Architecture/05 - Self-Maintaining API.md. Both the API and the
// dashboard build against these shapes.

export const API_PROVIDERS = ["anthropic", "openai"] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const API_CHANGE_STATUSES = ["detected", "confirmed", "dismissed"] as const;
export type ApiChangeStatus = (typeof API_CHANGE_STATUSES)[number];

export const API_CHANGE_KINDS = [
  "model_retired",
  "param_removed",
  "param_renamed",
  "param_now_required",
  "enum_value_removed",
  "endpoint_removed",
  "behavior_changed",
] as const;
export type ApiChangeKind = (typeof API_CHANGE_KINDS)[number];

/** Phase 6a watches only `deprecations`; 6b adds the rest. */
export type ApiSourceKind = "deprecations" | "spec" | "release_notes" | "sdk_changelog";

export interface ApiSnapshotRef {
  id: string;
  contentHash: string;
  fetchedAt: string;
}

export interface ApiSource {
  kind: ApiSourceKind;
  url: string;
  /** The last fetch, successful or not. */
  lastCheckedAt: string | null;
  /** The last fetch's error, or null when it succeeded. */
  lastError: string | null;
  /** The last fetch whose content changed, or null before the first one. */
  latestSnapshot: ApiSnapshotRef | null;
}

/** One entry of `GET /api-providers`. */
export interface ApiProviderSummary {
  slug: ApiProvider;
  sources: ApiSource[];
  changeCounts: Record<ApiChangeStatus, number>;
}

/** One entry of `GET /api-changes`, newest first. */
export interface ApiChange {
  id: string;
  provider: ApiProvider;
  kind: ApiChangeKind;
  /**
   * The endpoint a change names. An endpoint removal read from a deprecations
   * page names only the path, such as `/v1/edits`, since the page gives no method.
   */
  operation: string | null;
  /** The model a retirement names, or the parameter a change names. */
  field: string | null;
  replacement: string | null;
  /** A calendar date, `YYYY-MM-DD`. */
  effectiveAt: string | null;
  /** The heading the evidence sits under. */
  section: string | null;
  /** The verbatim line of the snapshot the change was read from. */
  evidence: string;
  status: ApiChangeStatus;
  source: { kind: ApiSourceKind; url: string };
  snapshotId: string;
  detectedAt: string;
  updatedAt: string;
  /** Whether the caller may confirm or dismiss it: only monitor admins may. */
  canReview: boolean;
}

export type ApiChangeDecision = "confirm" | "dismiss";

export interface ApiChangeFilter {
  provider?: ApiProvider;
  status?: ApiChangeStatus;
  kind?: ApiChangeKind;
}
