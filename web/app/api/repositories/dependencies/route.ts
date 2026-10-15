import type { NextRequest } from "next/server";

import { getAccessibleRepositories, getDependencies, GithubUnauthorizedError } from "@/lib/github";
import { getSession } from "@/lib/session";

/** Dependencies in a repository's root package.json, for the new-migration form. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in with GitHub first" }, { status: 401 });

  const repo = request.nextUrl.searchParams.get("repo");
  try {
    // Only repositories reachable through an installation, which also keeps
    // an arbitrary string out of the GitHub API path.
    const repositories = await getAccessibleRepositories(session.accessToken);
    const match = repositories.find((repository) => repository.fullName === repo);
    if (!match) return Response.json({ error: "SyncLab is not installed on that repository" }, { status: 404 });

    return Response.json({ dependencies: await getDependencies(session.accessToken, match.fullName) });
  } catch (error) {
    if (error instanceof GithubUnauthorizedError) {
      return Response.json({ error: "Your GitHub session expired. Sign in again." }, { status: 401 });
    }
    throw error;
  }
}
