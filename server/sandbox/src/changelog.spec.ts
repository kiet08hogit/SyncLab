import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Octokit } from '@octokit/rest';
import { fetchReleaseNotes, parseGithubRepo } from './changelog.js';

describe('parseGithubRepo', () => {
  it('understands the repository shapes npm records', () => {
    const expected = { owner: 'lodash', repo: 'lodash' };

    for (const url of [
      'git+https://github.com/lodash/lodash.git',
      'https://github.com/lodash/lodash',
      'git://github.com/lodash/lodash.git',
      'git+ssh://git@github.com/lodash/lodash.git',
      'git@github.com:lodash/lodash.git',
      'github:lodash/lodash',
      'lodash/lodash',
    ]) {
      assert.deepEqual(parseGithubRepo(url), expected, url);
    }
  });

  it('keeps dots that are part of the repository name', () => {
    assert.deepEqual(parseGithubRepo('https://github.com/vercel/next.js.git'), {
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('rejects missing and non-GitHub repositories', () => {
    for (const url of [
      undefined,
      '',
      'https://gitlab.com/acme/widgets.git',
      'gitlab:acme/widgets',
      'bitbucket:acme/widgets',
      'widgets',
    ]) {
      assert.equal(parseGithubRepo(url), undefined, String(url));
    }
  });
});

interface Call {
  url: string;
  init?: RequestInit;
}

describe('fetchReleaseNotes', () => {
  const originalFetch = globalThis.fetch;
  const octokit = new Octokit({ auth: 'ghs_test', baseUrl: 'https://github.test/api' });
  let calls: Call[];
  let packument: (name: string) => Response;
  let releases: Record<string, Response | (() => Response)>;

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  beforeEach(() => {
    calls = [];
    packument = () => json(200, { repository: { url: 'git+https://github.com/acme/widgets.git' } });
    releases = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, init });

      if (url.startsWith('https://registry.npmjs.org/')) {
        return packument(decodeURIComponent(url.slice('https://registry.npmjs.org/'.length)));
      }

      const match = /^https:\/\/github\.test\/api\/repos\/([^/]+)\/([^/]+)\/releases\/tags\/(.+)$/.exec(url);
      if (match) {
        const release = releases[`${match[1]}/${match[2]}@${decodeURIComponent(match[3])}`];
        if (release) {
          return typeof release === 'function' ? release() : release;
        }
        return json(404, { message: 'Not Found' });
      }

      throw new Error(`unexpected request to ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the body of the release tagged with the bare version', async () => {
    releases['acme/widgets@2.0.0'] = json(200, { body: '## Breaking\n- removed foo()' });

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), '## Breaking\n- removed foo()');
  });

  it('falls back to the v-prefixed tag', async () => {
    releases['acme/widgets@v2.0.0'] = json(200, { body: 'v-tagged notes' });

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), 'v-tagged notes');
    assert.deepEqual(
      calls.filter((call) => call.url.includes('/releases/tags/')).map((call) => call.url.split('/').pop()),
      ['2.0.0', 'v2.0.0'],
    );
  });

  it('accepts a target version that already carries a v', async () => {
    releases['acme/widgets@2.0.0'] = json(200, { body: 'bare notes' });

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', 'v2.0.0'), 'bare notes');
  });

  it('skips a release with an empty body', async () => {
    releases['acme/widgets@2.0.0'] = json(200, { body: '   \n' });
    releases['acme/widgets@v2.0.0'] = json(200, { body: 'the real notes' });

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), 'the real notes');
  });

  it('looks up scoped packages with an encoded name', async () => {
    let requested: string | undefined;
    packument = (name) => {
      requested = name;
      return json(200, { repository: 'github:angular/angular' });
    };
    releases['angular/angular@17.0.0'] = json(200, { body: 'angular notes' });

    assert.equal(await fetchReleaseNotes(octokit, '@angular/core', '17.0.0'), 'angular notes');
    assert.equal(requested, '@angular/core');
    assert.ok(calls[0].url.endsWith('/%40angular%2Fcore'));
  });

  it('gives up quietly when the package is not on the registry', async () => {
    packument = () => json(404, { error: 'Not found' });

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), undefined);
    assert.equal(calls.length, 1);
  });

  it('gives up quietly when the registry is unreachable', async () => {
    packument = () => {
      throw new TypeError('fetch failed');
    };

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), undefined);
  });

  it('gives up quietly when the package is not hosted on GitHub', async () => {
    packument = () => json(200, { repository: { url: 'https://gitlab.com/acme/widgets.git' } });

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), undefined);
    assert.equal(calls.length, 1);
  });

  it('gives up quietly when the package declares no repository', async () => {
    packument = () => json(200, {});

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), undefined);
  });

  it('returns nothing when neither tag has a release', async () => {
    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), undefined);
  });

  it('treats a failing GitHub API like a missing release', async () => {
    releases['acme/widgets@2.0.0'] = () => json(500, { message: 'Server Error' });
    releases['acme/widgets@v2.0.0'] = () => {
      throw new TypeError('fetch failed');
    };

    assert.equal(await fetchReleaseNotes(octokit, 'widgets', '2.0.0'), undefined);
  });
});
