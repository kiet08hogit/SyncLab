export const MIGRATION_QUEUE = 'migration-queue';
export const MIGRATION_JOB_NAME = 'process-migration';

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
  INSTALL: 'INSTALL',
  CHANGELOG: 'CHANGELOG',
  REFACTOR: 'REFACTOR',
  TEST: 'TEST',
  PR: 'PR',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
} as const;

export type LogStep = (typeof LogStep)[keyof typeof LogStep];

export interface MigrationJobData {
  jobId: string;
  repoUrl: string;
}
