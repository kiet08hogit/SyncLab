export const MIGRATION_QUEUE = 'migration-queue';
export const MIGRATION_JOB_NAME = 'process-migration';
export const SCAN_QUEUE = 'scan-queue';
export const SCAN_JOB_NAME = 'scan-repository';
export const API_MONITOR_QUEUE = 'api-monitor-queue';
export const API_MONITOR_JOB_NAME = 'poll-api-sources';

export const BreakingChangeStatus = {
  DETECTED: 'detected',
  CONFIRMED: 'confirmed',
  DISMISSED: 'dismissed',
} as const;

export type BreakingChangeStatus = (typeof BreakingChangeStatus)[keyof typeof BreakingChangeStatus];

export const MigrationKind = {
  DEPENDENCY: 'dependency',
  API_CHANGE: 'api_change',
} as const;

export type MigrationKind = (typeof MigrationKind)[keyof typeof MigrationKind];

/** A behavior_changed change has no code fix to make, so it is reported and never migrated. */
export const REPORTED_ONLY_KIND = 'behavior_changed';

export function isMigratableKind(kind: string): boolean {
  return kind !== REPORTED_ONLY_KIND;
}

/** Shared by every path that queues a migration, so all of them retry it the same way. */
export const MIGRATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 120_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export const JobStatus = {
  QUEUED: 'QUEUED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/**
 * Step names for ExecutionLog rows, matching the lifecycle described in
 * infra/Architecture/02 - Database & Queue.md.
 */
export const LogStep = {
  STARTED: 'STARTED',
  CLONE: 'CLONE',
  CHANGELOG: 'CHANGELOG',
  INSTALL: 'INSTALL',
  BASELINE: 'BASELINE',
  UPGRADE: 'UPGRADE',
  REFACTOR: 'REFACTOR',
  TEST: 'TEST',
  VALIDATE: 'VALIDATE',
  PR: 'PR',
  SCAN: 'SCAN',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
} as const;

export type LogStep = (typeof LogStep)[keyof typeof LogStep];

export interface MigrationJobData {
  jobId: string;
  repoUrl: string;
}

/** What made SyncLab scan a repository. */
export const ScanTrigger = {
  INSTALLATION: 'installation',
  PUSH: 'push',
  MANUAL: 'manual',
} as const;

export type ScanTrigger = (typeof ScanTrigger)[keyof typeof ScanTrigger];

export interface ScanJobData {
  scanId: string;
  repoUrl: string;
}
