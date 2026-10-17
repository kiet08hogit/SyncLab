"use server";

import { redirect } from "next/navigation";

import { ApiUnauthorizedError, createMigration } from "@/lib/api";
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

  let result: Awaited<ReturnType<typeof createMigration>>;
  // The API holds the user to the repositories their installations reach, and
  // answers 404 for any other repository.
  try {
    result = await createMigration(session.accessToken, { repoFullName, dependencyName, targetVersion });
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) {
      return { error: "Your GitHub session expired. Sign in again to start a migration." };
    }
    return { error: "The SyncLab API could not be reached. Check that the gateway is running." };
  }
  if ("error" in result) return { error: result.error };

  redirect(`/jobs/${result.id}`);
}
