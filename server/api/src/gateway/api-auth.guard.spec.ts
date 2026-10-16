import { UnauthorizedException } from '@nestjs/common';
import { ApiAuthGuard, isValidBearerToken } from './api-auth.guard';

const TOKEN = 'a-test-migrations-token';

describe('isValidBearerToken', () => {
  it('accepts the configured token', () => {
    expect(isValidBearerToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it('rejects a different token', () => {
    expect(isValidBearerToken('Bearer wrong-token', TOKEN)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isValidBearerToken(undefined, TOKEN)).toBe(false);
  });

  it('rejects a header without the Bearer scheme', () => {
    expect(isValidBearerToken(TOKEN, TOKEN)).toBe(false);
    expect(isValidBearerToken(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it('rejects a token of the wrong length without throwing', () => {
    expect(() => isValidBearerToken('Bearer abc', TOKEN)).not.toThrow();
    expect(isValidBearerToken('Bearer abc', TOKEN)).toBe(false);
  });

  it('rejects everything when no token is configured', () => {
    expect(isValidBearerToken('Bearer ', '')).toBe(false);
  });
});

describe('ApiAuthGuard', () => {
  const USER = {
    login: 'octocat',
    repositories: new Map([
      [42n, { githubRepoId: 42n, fullName: 'acme/widgets', installationId: 7n, private: true }],
    ]),
  };

  function setup(configured: string | undefined, authorization?: string) {
    const config = { get: () => configured };
    const githubUsers = { resolve: jest.fn().mockResolvedValue(USER) };
    const request: { caller?: unknown; header: (name: string) => string | undefined } = {
      header: (name) => (name === 'authorization' ? authorization : undefined),
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    const guard = new ApiAuthGuard(config as never, githubUsers as never);
    return { run: () => guard.canActivate(context as never), request, githubUsers };
  }

  it('treats MIGRATIONS_API_TOKEN as a service caller without asking GitHub', async () => {
    const { run, request, githubUsers } = setup(TOKEN, `Bearer ${TOKEN}`);

    await expect(run()).resolves.toBe(true);
    expect(request.caller).toEqual({ kind: 'service' });
    expect(githubUsers.resolve).not.toHaveBeenCalled();
  });

  it('resolves any other bearer token to a GitHub user and their repositories', async () => {
    const { run, request, githubUsers } = setup(TOKEN, 'Bearer ghu_user-token');

    await expect(run()).resolves.toBe(true);
    expect(githubUsers.resolve).toHaveBeenCalledWith('ghu_user-token');
    expect(request.caller).toEqual({ kind: 'user', ...USER });
  });

  it('still accepts user tokens when no service token is configured', async () => {
    const { run, request } = setup(undefined, 'Bearer ghu_user-token');

    await expect(run()).resolves.toBe(true);
    expect(request.caller).toMatchObject({ kind: 'user', login: 'octocat' });
  });

  it.each([
    ['a missing header', undefined],
    ['an empty bearer token', 'Bearer '],
    ['another scheme', `Basic ${TOKEN}`],
  ])('rejects %s without asking GitHub', async (_case, authorization) => {
    const { run, githubUsers } = setup(TOKEN, authorization);

    await expect(run()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(githubUsers.resolve).not.toHaveBeenCalled();
  });

  it('rejects a token GitHub does not accept', async () => {
    const { run, githubUsers } = setup(TOKEN, 'Bearer revoked');
    githubUsers.resolve.mockRejectedValue(new UnauthorizedException());

    await expect(run()).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
