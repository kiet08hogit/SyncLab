import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { GithubTokenService } from './github-token.service';
import type { GithubConfig } from '../config/configuration';

const auth = jest.fn((options: { type: string }) =>
  Promise.resolve({ token: options.type === 'app' ? 'app-jwt' : 'installation-token' }),
);

const API_URL = 'https://api.github.test';
const REPO = {
  id: 42,
  full_name: 'Acme/Widgets',
  clone_url: 'https://github.com/Acme/Widgets.git',
};

function jsonResponse(status: number, body: unknown = {}) {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) };
}

function service(github: Partial<GithubConfig>) {
  const config = { get: () => ({ apiUrl: API_URL, ...github }) };
  const svc = new GithubTokenService(config as never);
  // @octokit/auth-app is loaded with a dynamic import that jest cannot run.
  jest
    .spyOn(svc as unknown as { loadCreateAppAuth: () => Promise<unknown> }, 'loadCreateAppAuth')
    .mockResolvedValue(() => auth);
  return svc;
}

describe('GithubTokenService.getInstallationToken', () => {
  beforeEach(() => {
    auth.mockClear();
  });

  it('exchanges the App credentials for an installation token', async () => {
    await expect(
      service({ appId: '1', privateKey: 'key', token: 'pat' }).getInstallationToken(7n),
    ).resolves.toBe('installation-token');

    expect(auth).toHaveBeenCalledWith({ type: 'installation', installationId: 7 });
  });

  it('falls back to GITHUB_TOKEN when no App is configured', async () => {
    await expect(service({ token: 'pat' }).getInstallationToken(7n)).resolves.toBe('pat');
    expect(auth).not.toHaveBeenCalled();
  });

  it('uses GITHUB_TOKEN for installation id 0 even when an App is configured', async () => {
    await expect(
      service({ appId: '1', privateKey: 'key', token: 'pat' }).getInstallationToken(0n),
    ).resolves.toBe('pat');
    expect(auth).not.toHaveBeenCalled();
  });

  it('does not use a half-configured App', async () => {
    await expect(service({ appId: '1', token: 'pat' }).getInstallationToken(7n)).resolves.toBe(
      'pat',
    );
    expect(auth).not.toHaveBeenCalled();
  });

  it('fails when there are no credentials at all', async () => {
    await expect(service({}).getInstallationToken(7n)).rejects.toThrow(
      'No GitHub credentials available',
    );
  });

  it('propagates a failed token exchange', async () => {
    auth.mockRejectedValueOnce(new Error('401 Bad credentials'));

    await expect(
      service({ appId: '1', privateKey: 'key' }).getInstallationToken(7n),
    ).rejects.toThrow('401 Bad credentials');
  });
});

describe('GithubTokenService.lookupRepository', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    auth.mockClear();
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('finds the installation with the App JWT, then reads the repo with its token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 7 }))
      .mockResolvedValueOnce(jsonResponse(200, REPO));

    await expect(
      service({ appId: '1', privateKey: 'key' }).lookupRepository('acme/widgets'),
    ).resolves.toEqual({
      githubRepoId: 42n,
      installationId: 7n,
      fullName: 'Acme/Widgets',
      cloneUrl: 'https://github.com/Acme/Widgets.git',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${API_URL}/repos/acme/widgets/installation`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer app-jwt' }) as unknown,
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${API_URL}/repos/acme/widgets`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer installation-token' }) as unknown,
      }),
    );
    expect(auth).toHaveBeenCalledWith({ type: 'installation', installationId: 7 });
  });

  it('uses installation id 0 and GITHUB_TOKEN when no App is configured', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, REPO));

    await expect(service({ token: 'pat' }).lookupRepository('acme/widgets')).resolves.toMatchObject(
      { githubRepoId: 42n, installationId: 0n },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/repos/acme/widgets`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer pat' }) as unknown,
      }),
    );
    expect(auth).not.toHaveBeenCalled();
  });

  it('reports a repo the App is not installed on as not found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404));

    await expect(
      service({ appId: '1', privateKey: 'key' }).lookupRepository('acme/widgets'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a missing repo as not found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404));

    await expect(service({ token: 'pat' }).lookupRepository('acme/nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports other GitHub failures as a bad gateway', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500));

    await expect(service({ token: 'pat' }).lookupRepository('acme/widgets')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('reports an unreachable GitHub as a bad gateway', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(service({ token: 'pat' }).lookupRepository('acme/widgets')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('reports a failed App JWT signing as a bad gateway without calling GitHub', async () => {
    auth.mockRejectedValueOnce(new Error('invalid private key'));

    await expect(
      service({ appId: '1', privateKey: 'key' }).lookupRepository('acme/widgets'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails without calling GitHub when there are no credentials at all', async () => {
    await expect(service({}).lookupRepository('acme/widgets')).rejects.toThrow(
      'No GitHub credentials available',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed installation token exchange as a bad gateway', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 7 }));
    auth
      .mockResolvedValueOnce({ token: 'app-jwt' })
      .mockRejectedValueOnce(new Error('403 Forbidden'));

    await expect(
      service({ appId: '1', privateKey: 'key' }).lookupRepository('acme/widgets'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
