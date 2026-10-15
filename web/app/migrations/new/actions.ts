"use server";

import { redirect } from "next/navigation";

import { createMigration } from "@/lib/api";
import { getAccessibleRepositories, GithubUnauthorizedError } from "@/lib/github";
import { isPackageName } from "@/lib/npm";
import { getSession } from "@/lib/session";

export interface StartMigrationState {
  error: string | null;
}

const VERSION = /^\d+\.\d+\.\d+$/;

export async function startMigration(_previous: StartMigrationState, form: FormData): Promise<StartMigrationState> {
  const session = await getSession();
  if (!session) return { error: "Your GitHub session expired. Sign in again to start a migration." };

  const repoFullName = String(form.get("repository") ?? "");
  const dependencyName = String(form.get("dependency") ?? "");
  const targetVersion = String(form.get("version") ?? "");
  if (!repoFullName || !dependencyName || !targetVersion) {
    return { error: "Pick a repository, a dependency, and a target version." };
  }
  if (!isPackageName(dependencyName) || !VERSION.test(targetVersion)) {
    return { error: "That dependency or version is not valid." };
  }

  // The API trusts its bearer token, so this is where a user is held to the
  // repositories their own GitHub access reaches.
  try {
    const repositories = await getAccessibleRepositories(session.accessToken);
    if (!repositories.some((repository) => repository.fullName === repoFullName)) {
      return { error: `SyncLab is not installed on ${repoFullName}, or you no longer have access to it.` };
    }
  } catch (error) {
    if (error instanceof GithubUnauthorizedError) {
      return { error: "Your GitHub session expired. Sign in again to start a migration." };
    }
    throw error;
  }

  let result: Awaited<ReturnType<typeof createMigration>>;
  try {
    result = await createMigration({ repoFullName, dependencyName, targetVersion });
  } catch {
    return { error: "The SyncLab API could not be reached. Check that the gateway is running." };
  }
  if ("error" in result) return { error: result.error };

  redirect(`/jobs/${result.id}`);
}
