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

describe('GithubTokenService.lookupRepository', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    auth.mockClear();
    global.fetch = fetchMock as never;
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
});
