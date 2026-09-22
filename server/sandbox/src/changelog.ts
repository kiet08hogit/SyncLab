import { Octokit } from '@octokit/rest';

const REGISTRY_URL = 'https://registry.npmjs.org';

interface Packument {
  repository?: string | { url?: string };
}

function repositoryUrl(packument: Packument): string | undefined {
  const repository = packument.repository;
  return typeof repository === 'string' ? repository : repository?.url;
}

/**
 * npm records repositories in a handful of shapes: "git+https://...git",
 * "git://...", "github:owner/repo", or a bare "owner/repo".
 */
export function parseGithubRepo(url: string | undefined): { owner: string; repo: string } | undefined {
  if (!url) {
    return undefined;
  }

  const match =
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url) ??
    /^(?:github:)?([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);

  if (!match) {
    return undefined;
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * Both "18.0.0" and "v18.0.0" are common tag styles and the job only carries one.
 */
function tagCandidates(targetVersion: string): string[] {
  const bare = targetVersion.replace(/^v/, '');
  return [bare, `v${bare}`];
}

async function findRepo(dependencyName: string): Promise<{ owner: string; repo: string } | undefined> {
  const response = await fetch(`${REGISTRY_URL}/${encodeURIComponent(dependencyName)}`);
  if (!response.ok) {
    return undefined;
  }

  return parseGithubRepo(repositoryUrl((await response.json()) as Packument));
}

/**
 * Best effort by design. Release notes sharpen the prompt but a migration
 * without them is still worth attempting, so every failure returns undefined
 * rather than throwing.
 */
export async function fetchReleaseNotes(
  octokit: Octokit,
  dependencyName: string,
  targetVersion: string,
): Promise<string | undefined> {
  const target = await findRepo(dependencyName).catch(() => undefined);
  if (!target) {
    return undefined;
  }

  for (const tag of tagCandidates(targetVersion)) {
    const release = await octokit.repos
      .getReleaseByTag({ owner: target.owner, repo: target.repo, tag })
      .catch(() => undefined);

    if (release?.data.body?.trim()) {
      return release.data.body;
    }
  }

  return undefined;
}
