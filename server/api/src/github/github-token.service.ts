import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Configuration, GithubConfig } from '../config/configuration';

type CreateAppAuth = typeof import('@octokit/auth-app').createAppAuth;

export interface GithubRepositoryInfo {
  githubRepoId: bigint;
  installationId: bigint;
  fullName: string;
  cloneUrl: string;
}

@Injectable()
export class GithubTokenService {
  private readonly logger = new Logger(GithubTokenService.name);
  private createAppAuthPromise?: Promise<CreateAppAuth>;

  constructor(private readonly config: ConfigService<Configuration, true>) {}

  /**
   * @octokit/auth-app is ESM-only and this package compiles to CommonJS, so it
   * has to be pulled in with a dynamic import.
   */
  private loadCreateAppAuth(): Promise<CreateAppAuth> {
    this.createAppAuthPromise ??= import('@octokit/auth-app').then(
      (module) => module.createAppAuth,
    );
    return this.createAppAuthPromise;
  }

  /**
   * Prefers a GitHub App installation token, which is scoped to one repository
   * and expires in an hour. Falls back to a Personal Access Token so the
   * sandbox can be exercised locally before an App exists.
   */
  async getInstallationToken(installationId: bigint): Promise<string> {
    const github: GithubConfig = this.config.get('github', { infer: true });

    if (github.appId && github.privateKey && installationId > 0n) {
      const createAppAuth = await this.loadCreateAppAuth();
      const auth = createAppAuth({
        appId: github.appId,
        privateKey: github.privateKey,
      });

      const result = await auth({
        type: 'installation',
        installationId: Number(installationId),
      });

      return result.token;
    }

    if (github.token) {
      this.logger.warn(
        'Falling back to GITHUB_TOKEN. Configure GITHUB_APP_ID and GITHUB_PRIVATE_KEY before running against repositories you do not own.',
      );
      return github.token;
    }

    throw new Error(
      'No GitHub credentials available. Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY, or GITHUB_TOKEN for local development.',
    );
  }

  /**
   * Resolves what a Repository row needs when there is no webhook payload to
   * read it from. With only GITHUB_TOKEN configured the installation id is 0,
   * which getInstallationToken already treats as "use the token".
   */
  async lookupRepository(fullName: string): Promise<GithubRepositoryInfo> {
    const github: GithubConfig = this.config.get('github', { infer: true });

    let installationId = 0n;
    if (github.appId && github.privateKey) {
      const createAppAuth = await this.loadCreateAppAuth();
      const auth = createAppAuth({
        appId: github.appId,
        privateKey: github.privateKey,
      });
      const { token: appJwt } = await auth({ type: 'app' });

      const installation = await this.githubGet<{ id: number }>(
        github.apiUrl,
        `/repos/${fullName}/installation`,
        appJwt,
        `The GitHub App is not installed on ${fullName}`,
      );
      installationId = BigInt(installation.id);
    }

    const token = await this.getInstallationToken(installationId);
    const repo = await this.githubGet<{ id: number; full_name: string; clone_url: string }>(
      github.apiUrl,
      `/repos/${fullName}`,
      token,
      `Repository ${fullName} was not found or is not accessible`,
    );

    return {
      githubRepoId: BigInt(repo.id),
      installationId,
      fullName: repo.full_name,
      cloneUrl: repo.clone_url,
    };
  }

  private async githubGet<T>(
    apiUrl: string,
    path: string,
    token: string,
    notFoundMessage: string,
  ): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.status === 404) {
      throw new NotFoundException(notFoundMessage);
    }
    if (!response.ok) {
      throw new BadGatewayException(`GitHub GET ${path} failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
