import { ScanTrigger } from '../common/constants';
import type { GithubWebhookPayload } from './webhook.types';

export const SCAN_EVENTS = ['installation', 'installation_repositories', 'push'] as const;

export interface RepositoryToScan {
  githubRepoId: bigint;
  fullName: string;
  repoUrl: string;
}

export type ScanTriggerResult =
  | {
      kind: 'scan';
      trigger: ScanTrigger;
      installationId: bigint;
      repositories: RepositoryToScan[];
    }
  | { kind: 'ignored'; reason: string };

const DELETED_REF = /^0+$/;

function cloneUrl(fullName: string): string {
  return `https://github.com/${fullName}.git`;
}

/**
 * Which repositories a webhook asks SyncLab to scan. A new installation, or a
 * repository added to one, is scanned so the registry starts out complete;
 * after that, only a push to the default branch changes what the repository
 * calls in production.
 */
export function parseScanTrigger(
  event: string | undefined,
  payload: GithubWebhookPayload,
): ScanTriggerResult {
  const installationId = payload.installation?.id;
  if (!installationId) {
    return { kind: 'ignored', reason: 'payload has no installation.id' };
  }

  if (event === 'installation' || event === 'installation_repositories') {
    const expectedAction = event === 'installation' ? 'created' : 'added';
    if (payload.action !== expectedAction) {
      return {
        kind: 'ignored',
        reason: `${event} action ${payload.action ?? 'none'} needs no scan`,
      };
    }

    const listed = event === 'installation' ? payload.repositories : payload.repositories_added;
    const repositories = (listed ?? []).flatMap((repository) =>
      repository.id && repository.full_name
        ? [
            {
              githubRepoId: BigInt(repository.id),
              fullName: repository.full_name,
              repoUrl: cloneUrl(repository.full_name),
            },
          ]
        : [],
    );

    if (repositories.length === 0) {
      return { kind: 'ignored', reason: `${event} lists no repositories` };
    }

    return {
      kind: 'scan',
      trigger: ScanTrigger.INSTALLATION,
      installationId: BigInt(installationId),
      repositories,
    };
  }

  if (event === 'push') {
    const repository = payload.repository;
    if (!repository?.id || !repository.full_name || !repository.default_branch) {
      return {
        kind: 'ignored',
        reason: 'push payload is missing the repository or its default branch',
      };
    }
    if (payload.ref !== `refs/heads/${repository.default_branch}`) {
      return { kind: 'ignored', reason: `${payload.ref ?? 'push'} is not the default branch` };
    }
    if (payload.deleted || (payload.after && DELETED_REF.test(payload.after))) {
      return { kind: 'ignored', reason: 'push deleted the default branch' };
    }

    return {
      kind: 'scan',
      trigger: ScanTrigger.PUSH,
      installationId: BigInt(installationId),
      repositories: [
        {
          githubRepoId: BigInt(repository.id),
          fullName: repository.full_name,
          repoUrl: repository.clone_url ?? cloneUrl(repository.full_name),
        },
      ],
    };
  }

  return { kind: 'ignored', reason: `${event ?? 'unknown'} events do not trigger a scan` };
}
