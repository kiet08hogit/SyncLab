import { ScanTrigger } from '../common/constants';
import { parseScanTrigger } from './scan-trigger';
import type { GithubWebhookPayload } from './webhook.types';

const INSTALLATION = { id: 42 };

describe('parseScanTrigger', () => {
  it('scans every repository of a new installation', () => {
    expect(
      parseScanTrigger('installation', {
        action: 'created',
        installation: INSTALLATION,
        repositories: [
          { id: 1, full_name: 'acme/api' },
          { id: 2, full_name: 'acme/web' },
        ],
      }),
    ).toEqual({
      kind: 'scan',
      trigger: ScanTrigger.INSTALLATION,
      installationId: 42n,
      repositories: [
        { githubRepoId: 1n, fullName: 'acme/api', repoUrl: 'https://github.com/acme/api.git' },
        { githubRepoId: 2n, fullName: 'acme/web', repoUrl: 'https://github.com/acme/web.git' },
      ],
    });
  });

  it('scans only the repositories added to an installation', () => {
    expect(
      parseScanTrigger('installation_repositories', {
        action: 'added',
        installation: INSTALLATION,
        repositories_added: [{ id: 3, full_name: 'acme/worker' }],
      }),
    ).toMatchObject({
      kind: 'scan',
      repositories: [{ githubRepoId: 3n, fullName: 'acme/worker' }],
    });
  });

  it('ignores installation events that add nothing to scan', () => {
    const cases: Array<[string, GithubWebhookPayload]> = [
      [
        'installation',
        {
          action: 'deleted',
          installation: INSTALLATION,
          repositories: [{ id: 1, full_name: 'acme/api' }],
        },
      ],
      ['installation_repositories', { action: 'removed', installation: INSTALLATION }],
      ['installation', { action: 'created', installation: INSTALLATION, repositories: [] }],
      ['installation', { action: 'created', repositories: [{ id: 1, full_name: 'acme/api' }] }],
    ];
    for (const [event, payload] of cases) {
      expect(parseScanTrigger(event, payload)).toMatchObject({ kind: 'ignored' });
    }
  });

  describe('push', () => {
    const repository = {
      id: 7,
      full_name: 'acme/api',
      clone_url: 'https://github.com/acme/api.git',
      default_branch: 'main',
    };

    it('scans a push to the default branch', () => {
      expect(
        parseScanTrigger('push', {
          ref: 'refs/heads/main',
          after: 'b'.repeat(40),
          repository,
          installation: INSTALLATION,
        }),
      ).toEqual({
        kind: 'scan',
        trigger: ScanTrigger.PUSH,
        installationId: 42n,
        repositories: [
          { githubRepoId: 7n, fullName: 'acme/api', repoUrl: 'https://github.com/acme/api.git' },
        ],
      });
    });

    it('ignores pushes to other branches and tags', () => {
      for (const ref of ['refs/heads/feature', 'refs/tags/v1.0.0', 'refs/heads/main-old']) {
        expect(
          parseScanTrigger('push', { ref, repository, installation: INSTALLATION }),
        ).toMatchObject({ kind: 'ignored' });
      }
    });

    it('ignores a push that deletes the default branch', () => {
      expect(
        parseScanTrigger('push', {
          ref: 'refs/heads/main',
          deleted: true,
          after: '0'.repeat(40),
          repository,
          installation: INSTALLATION,
        }),
      ).toEqual({ kind: 'ignored', reason: 'push deleted the default branch' });
    });
  });
});
