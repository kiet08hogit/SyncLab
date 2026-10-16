import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import { GithubUserService } from './github-user.service';

const API = 'https://api.github.test';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Routes GET paths (without the query string) to canned responses. */
function mockGithub(routes: Record<string, (page: number) => Response>) {
  return jest.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const route = routes[url.pathname];
    const page = Number(url.searchParams.get('page') ?? '1');
    return Promise.resolve(route ? route(page) : json({ message: 'Not Found' }, 404));
  });
}

function service() {
  const config = { get: () => ({ apiUrl: API }) };
  return new GithubUserService(config as never);
}

const ONE_PAGE_ROUTES = {
  '/user': () => json({ login: 'octocat' }),
  '/user/installations': (page: number) =>
    json({
      installations:
        page === 1
          ? [
              { id: 1, suspended_at: null },
              { id: 2, suspended_at: '2026-10-01T00:00:00Z' },
            ]
          : [],
    }),
  '/user/installations/1/repositories': () =>
    json({ repositories: [{ id: 42, full_name: 'acme/widgets', private: true }] }),
  '/user/installations/2/repositories': () =>
    json({ repositories: [{ id: 43, full_name: 'legacy/app', private: false }] }),
};

afterEach(() => jest.restoreAllMocks());

describe('GithubUserService', () => {
  it('resolves the user and the repositories of every active installation', async () => {
    mockGithub(ONE_PAGE_ROUTES);

    const user = await service().resolve('ghu_token');

    expect(user.login).toBe('octocat');
    expect([...user.repositories.values()]).toEqual([
      { githubRepoId: 42n, fullName: 'acme/widgets', installationId: 1n, private: true },
    ]);
  });

  it('follows pagination until a short page', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      full_name: `acme/repo-${index + 1}`,
      private: false,
    }));
    mockGithub({
      ...ONE_PAGE_ROUTES,
      '/user/installations/1/repositories': (page) =>
        json({
          repositories:
            page === 1 ? fullPage : [{ id: 101, full_name: 'acme/last', private: false }],
        }),
    });

    const user = await service().resolve('ghu_token');

    expect(user.repositories.size).toBe(101);
    expect(user.repositories.get(101n)?.fullName).toBe('acme/last');
  });

  it('reuses a recent result for the same token', async () => {
    const fetch = mockGithub(ONE_PAGE_ROUTES);
    const users = service();

    await users.resolve('ghu_token');
    const calls = fetch.mock.calls.length;
    await users.resolve('ghu_token');

    expect(fetch.mock.calls.length).toBe(calls);
  });

  it.each([401, 403])('rejects a token GitHub answers %i for', async (status) => {
    mockGithub({ '/user': () => json({ message: 'Bad credentials' }, status) });

    await expect(service().resolve('bad')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not cache a failure', async () => {
    const fetch = mockGithub({ '/user': () => json({}, 500) });
    const users = service();

    await expect(users.resolve('ghu_token')).rejects.toBeInstanceOf(BadGatewayException);
    fetch.mockRestore();
    mockGithub(ONE_PAGE_ROUTES);

    await expect(users.resolve('ghu_token')).resolves.toMatchObject({ login: 'octocat' });
  });
});
