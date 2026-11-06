"use server";

import { refresh } from "next/cache";
import { listRepositories, scanRepository } from "@/lib/api";
import { getSession } from "@/lib/session";

export async function requestRepositoryScan(githubRepoId: string): Promise<{ error: string | null; queued: boolean }> {
  const session = await getSession();
  if (!session) return { error: "Sign in with GitHub to scan this repository.", queued: false };
  try {
    const repositories = await listRepositories(session.accessToken);
    if (!repositories.some((repository) => repository.githubRepoId === githubRepoId)) {
      return { error: "This repository is no longer accessible.", queued: false };
    }
    const result = await scanRepository(session.accessToken, githubRepoId);
    refresh();
    return { error: null, queued: result.queued };
  } catch {
    return { error: "Could not start the scan. Check that the SyncLab API is running.", queued: false };
  }
}
