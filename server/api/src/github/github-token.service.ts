import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Configuration, GithubConfig } from '../config/configuration';

type CreateAppAuth = typeof import('@octokit/auth-app').createAppAuth;

function toBadGateway(error: unknown): never {
  throw new BadGatewayException('GitHub request failed', { cause: error });
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

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
    let token: string;
    if (github.appId && github.privateKey) {
      const createAppAuth = await this.loadCreateAppAuth();
      const auth = createAppAuth({
        appId: github.appId,
        privateKey: github.privateKey,
      });
      const { token: appJwt } = await auth({ type: 'app' }).catch(toBadGateway);

      const installation = await this.githubGet<{ id: number }>(
        github.apiUrl,
        `/repos/${fullName}/installation`,
        appJwt,
        `The GitHub App is not installed on ${fullName}`,
      );
      installationId = BigInt(installation.id);
      token = await this.getInstallationToken(installationId).catch(toBadGateway);
    } else {
      token = await this.getInstallationToken(installationId);
    }

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

  /**
   * Whether the repository's root package.json declares the dependency, which
   * is the only manifest the worker upgrades. A missing or unreadable
   * package.json declares nothing.
   */
  async declaresRootDependency(
    installationId: bigint,
    fullName: string,
    dependencyName: string,
  ): Promise<boolean> {
    const github: GithubConfig = this.config.get('github', { infer: true });
    const token = await this.getInstallationToken(installationId).catch(toBadGateway);
    const response = await fetch(`${github.apiUrl}/repos/${fullName}/contents/package.json`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }).catch(toBadGateway);

    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `GitHub GET /repos/${fullName}/contents/package.json failed with status ${response.status}`,
      );
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(await response.text());
    } catch {
      return false;
    }
    return DEPENDENCY_FIELDS.some((field) => {
      const section = (manifest as Record<string, unknown> | null)?.[field];
      return (
        typeof section === 'object' && section !== null && Object.hasOwn(section, dependencyName)
      );
    });
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
    }).catch(toBadGateway);

    if (response.status === 404) {
      throw new NotFoundException(notFoundMessage);
    }
    if (!response.ok) {
      throw new BadGatewayException(`GitHub GET ${path} failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
