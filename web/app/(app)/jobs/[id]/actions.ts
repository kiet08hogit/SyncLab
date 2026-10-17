"use server";

import { refresh } from "next/cache";

import { ApiUnauthorizedError, createMigration, fetchJob } from "@/lib/api";
import { getSession } from "@/lib/session";

export interface RetryJobState {
  error: string | null;
}

const SESSION_EXPIRED = "Your GitHub session expired. Sign in again to retry this migration.";

/**
 * Starting the same migration again is how the API retries one: it moves a
 * FAILED job back to QUEUED instead of creating a second job. The job is read
 * back through the API first, so the request can only retry a job the user can
 * already see, with that job's own repository, dependency, and version.
 */
export async function retryJob(jobId: string): Promise<RetryJobState> {
  const session = await getSession();
  if (!session) return { error: SESSION_EXPIRED };

  try {
    const job = await fetchJob(session.accessToken, jobId);
    if (!job) return { error: "This migration was not found, or you no longer have access to it." };
    // Already retried, from another tab or by a new trigger: just show where it is.
    if (job.status !== "FAILED") {
      refresh();
      return { error: null };
    }

    const result = await createMigration(session.accessToken, {
      repoFullName: job.repository.fullName,
      dependencyName: job.dependencyName,
      targetVersion: job.targetVersion,
    });
    if ("error" in result) return { error: result.error };
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return { error: SESSION_EXPIRED };
    return { error: "The SyncLab API could not be reached. Check that the gateway is running." };
  }

  refresh();
  return { error: null };
}
