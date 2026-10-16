import { parseDependencyUpdate } from './dependency-update';
import type { GithubPullRequestPayload } from './webhook.types';

function dependabot(title: string, ref = 'dependabot/npm_and_yarn/x'): GithubPullRequestPayload {
  return {
    action: 'opened',
    pull_request: {
      title,
      user: { login: 'dependabot[bot]', type: 'Bot' },
      head: { ref, repo: { full_name: 'acme/widgets' } },
    },
    repository: { full_name: 'acme/widgets' },
  };
}

function renovate(title: string, body = ''): GithubPullRequestPayload {
  return {
    action: 'opened',
    pull_request: {
      title,
      body,
      user: { login: 'renovate[bot]', type: 'Bot' },
      head: { ref: 'renovate/x', repo: { full_name: 'acme/widgets' } },
    },
    repository: { full_name: 'acme/widgets' },
  };
}

/** A Renovate change table row linking the npm diff for the dependency. */
function npmRow(dependencyPath: string, change = '`1.0.0` -> `2.0.0`') {
  return `| dep | [${change}](https://renovatebot.com/diffs/npm/${dependencyPath}/1.0.0/2.0.0) |`;
}

describe('parseDependencyUpdate', () => {
  it.each([
    ['Bump lodash from 4.17.20 to 4.17.21', 'lodash', '4.17.21'],
    ['build(deps): bump next from 14.2.18 to 15.1.0', 'next', '15.1.0'],
    ['chore(deps-dev): bump @types/node from 20.1.0 to 22.10.2', '@types/node', '22.10.2'],
    ['Bump express from 4.21.2 to 5.0.0 in /', 'express', '5.0.0'],
    ['Bump typescript from 5.6.3 to 5.7.0-beta', 'typescript', '5.7.0-beta'],
  ])('reads Dependabot "%s"', (title, dependencyName, targetVersion) => {
    expect(parseDependencyUpdate('pull_request', dependabot(title))).toEqual({
      kind: 'update',
      bot: 'dependabot',
      dependencyName,
      targetVersion,
    });
  });

  it.each([
    ['Update dependency lodash to v4.17.21', 'lodash', '4.17.21', 'lodash'],
    [
      'chore(deps): update dependency @nestjs/core to v11.1.0',
      '@nestjs/core',
      '11.1.0',
      '@nestjs/core',
    ],
    [
      'chore(deps): update dependency @types/node to v22.10.2',
      '@types/node',
      '22.10.2',
      '%40types%2Fnode',
    ],
    ['fix(deps): update dependency axios to v1.7.9 [security]', 'axios', '1.7.9', 'axios'],
    ['Update dependency zod to 4.0.1 (minor)', 'zod', '4.0.1', 'zod'],
  ])('reads Renovate "%s"', (title, dependencyName, targetVersion, linkPath) => {
    expect(parseDependencyUpdate('pull_request', renovate(title, npmRow(linkPath)))).toEqual({
      kind: 'update',
      bot: 'renovate',
      dependencyName,
      targetVersion,
    });
  });

  it('reads the exact version of a Renovate major update from its change table', () => {
    const body = [
      '| Package | Change | Age |',
      '|---|---|---|',
      '| [express](https://expressjs.com/) | [`4.21.2` -> `5.1.0`](https://renovatebot.com/diffs/npm/express) | ... |',
    ].join('\n');

    expect(
      parseDependencyUpdate('pull_request', renovate('Update dependency express to v5', body)),
    ).toEqual({
      kind: 'update',
      bot: 'renovate',
      dependencyName: 'express',
      targetVersion: '5.1.0',
    });
  });

  it('reads the major update version only from the npm line of the change table', () => {
    const body = [
      '| express | [`4.0.0` -> `9.9.9`](https://renovatebot.com/diffs/pypi/express/4.0.0/9.9.9) |',
      npmRow('express', '`4.21.2` -> `5.1.0`'),
    ].join('\n');

    expect(
      parseDependencyUpdate('pull_request', renovate('Update dependency express to v5', body)),
    ).toMatchObject({ kind: 'update', targetVersion: '5.1.0' });
  });

  it.each([
    ['another event', 'push', dependabot('Bump lodash from 4.17.20 to 4.17.21')],
    [
      'a synchronize',
      'pull_request',
      { ...dependabot('Bump lodash from 4.17.20 to 4.17.21'), action: 'synchronize' },
    ],
    [
      'a person posing with the bot title',
      'pull_request',
      {
        ...dependabot('Bump lodash from 4.17.20 to 4.17.21'),
        pull_request: {
          ...dependabot('x').pull_request,
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          user: { login: 'mallory', type: 'User' },
        },
      },
    ],
    [
      'a fork using the bot login',
      'pull_request',
      {
        ...dependabot('Bump lodash from 4.17.20 to 4.17.21'),
        pull_request: {
          ...dependabot('Bump lodash from 4.17.20 to 4.17.21').pull_request,
          head: { ref: 'dependabot/npm_and_yarn/x', repo: { full_name: 'mallory/widgets' } },
        },
      },
    ],
    [
      'a non-npm Dependabot update',
      'pull_request',
      dependabot('Bump actions/checkout from 3 to 4', 'dependabot/github_actions/x'),
    ],
    [
      'a grouped Dependabot update',
      'pull_request',
      dependabot('Bump the npm_and_yarn group across 1 directory with 3 updates'),
    ],
    [
      'an update in a subdirectory',
      'pull_request',
      dependabot('Bump lodash from 4.17.20 to 4.17.21 in /packages/web'),
    ],
    [
      'a Renovate update of a pip package',
      'pull_request',
      renovate(
        'Update dependency requests to v2.32.3',
        '| requests | [`2.32.2` -> `2.32.3`](https://renovatebot.com/diffs/pypi/requests/2.32.2/2.32.3) |',
      ),
    ],
    [
      'a Renovate update without an npm diff link',
      'pull_request',
      renovate('Update dependency black to v24.1.0'),
    ],
    [
      'a Renovate update whose npm link names another package',
      'pull_request',
      renovate('Update dependency react to v19.0.0', npmRow('react-dom')),
    ],
    ['a grouped Renovate update', 'pull_request', renovate('Update react monorepo to v19')],
    ['a Docker image update', 'pull_request', renovate('Update node Docker tag to v22')],
    [
      'a Renovate major update without a change table',
      'pull_request',
      renovate('Update dependency express to v5', npmRow('express', 'diff')),
    ],
    [
      'a dependency name that is not an npm package',
      'pull_request',
      renovate('Update dependency Foo_Bar to v1.0.0'),
    ],
  ])('ignores %s', (_case, event, payload) => {
    expect(parseDependencyUpdate(event, payload)).toMatchObject({ kind: 'ignored' });
  });
});
