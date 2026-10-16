import type { GithubPullRequestPayload } from './webhook.types';

export type DependencyUpdate =
  | {
      kind: 'update';
      bot: 'dependabot' | 'renovate';
      dependencyName: string;
      targetVersion: string;
    }
  | { kind: 'ignored'; reason: string };

const BOTS = { 'dependabot[bot]': 'dependabot', 'renovate[bot]': 'renovate' } as const;

// Opening is the signal. "synchronize" is the bot rebasing the same update,
// and a newer version arrives as a new pull request.
const ACTIONS = new Set(['opened', 'reopened']);

// npm package names: optional @scope/, then lowercase URL-safe characters.
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// "Bump lodash from 4.17.20 to 4.17.21", optionally prefixed by a
// conventional-commit scope and suffixed by " in /packages/web".
const DEPENDABOT_TITLE = /\bbump (\S+) from \S+ to v?(\S+?)(?: in (\S+))?$/i;
// "Update dependency lodash to v4.17.21". Renovate shortens a major update to
// "v5", in which case the exact version comes from the body's change table.
const RENOVATE_TITLE = /\bupdate dependency (\S+) to v?(\S+)$/i;
// A change table cell such as "`4.17.20` -> `4.17.21`".
const CHANGE_CELL = /`v?[^`]+`\s*(?:->|→)\s*`v?([^`]+)`/;

function exactVersionFromBody(
  body: string | null | undefined,
  dependencyName: string,
): string | null {
  for (const line of (body ?? '').split('\n')) {
    if (!line.includes(dependencyName)) continue;
    const version = line.match(CHANGE_CELL)?.[1];
    if (version && EXACT_VERSION.test(version)) return version;
  }
  return null;
}

/**
 * Reads a Dependabot or Renovate pull request as "upgrade this npm dependency
 * to this version". Anything SyncLab cannot act on safely is ignored with a
 * reason: grouped updates, other ecosystems, subdirectories (the worker only
 * upgrades the root package.json), and pull requests from forks or people.
 */
export function parseDependencyUpdate(
  event: string | undefined,
  payload: GithubPullRequestPayload,
): DependencyUpdate {
  const ignored = (reason: string): DependencyUpdate => ({ kind: 'ignored', reason });

  if (event !== 'pull_request')
    return ignored(`event "${event ?? 'unknown'}" is not a pull request`);
  if (!ACTIONS.has(payload.action ?? ''))
    return ignored(`pull request action "${payload.action}" is not opened`);

  const pr = payload.pull_request;
  const login = pr?.user?.login ?? '';
  const bot = BOTS[login as keyof typeof BOTS];
  if (!bot || pr?.user?.type !== 'Bot')
    return ignored(`pull request author "${login}" is not Dependabot or Renovate`);
  // A fork can name its account anything; only the repository's own branches count.
  if (pr?.head?.repo?.full_name !== payload.repository?.full_name) {
    return ignored('pull request comes from a fork');
  }

  // Strips Renovate's " [security]" and " (major)" style suffixes.
  const title = (pr?.title ?? '').trim().replace(/(\s+(\[[^\]]*\]|\([^)]*\)))+$/, '');
  let dependencyName: string | undefined;
  let targetVersion: string | null | undefined;

  if (bot === 'dependabot') {
    if (!pr?.head?.ref?.startsWith('dependabot/npm_and_yarn/')) {
      return ignored('Dependabot pull request is not an npm update');
    }
    const match = title.match(DEPENDABOT_TITLE);
    if (!match) return ignored('Dependabot title does not name a single dependency');
    if (match[3] && match[3] !== '/')
      return ignored(`update is in ${match[3]}, not the repository root`);
    [, dependencyName, targetVersion] = match;
  } else {
    const match = title.match(RENOVATE_TITLE);
    if (!match) return ignored('Renovate title does not name a single dependency');
    [, dependencyName, targetVersion] = match;
    if (!EXACT_VERSION.test(targetVersion)) {
      targetVersion = exactVersionFromBody(pr?.body, dependencyName);
    }
  }

  if (!dependencyName || !PACKAGE_NAME.test(dependencyName)) {
    return ignored(`"${dependencyName}" is not an npm package name`);
  }
  if (!targetVersion || !EXACT_VERSION.test(targetVersion)) {
    return ignored(`could not read an exact target version for ${dependencyName}`);
  }
  return { kind: 'update', bot, dependencyName, targetVersion };
}
